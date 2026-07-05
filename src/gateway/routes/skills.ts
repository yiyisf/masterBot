import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { resolveCliCommand } from '../../skills/utils.js';
import type { McpServerConfig } from '../../types.js';
import { McpSkillSource } from '../../skills/mcp-source.js';
import { McpRegistryClient } from '../../skills/mcp-registry.js';
import type { GatewayDeps } from '../route-deps.js';

/**
 * 技能相关路由：技能列表/修复、MCP 配置管理、MCP 注册中心、技能生成器。
 * 从 server.ts 拆分而来（P0-4），逻辑与原实现保持一致，仅将 `this.x` 改为 `deps.x`。
 */
export async function registerSkillsRoutes(app: FastifyInstance, deps: GatewayDeps): Promise<void> {
    // List skills (Derived from tools + metadata)
    app.get('/api/skills', async () => {
        const skillReg = deps.agent.getSkillRegistry();
        const tools = await skillReg.getToolDefinitions();

        // Group tools by skill name (prefix before first dot)
        const skillMap = new Map<string, { name: string; actions: string[] }>();

        for (const tool of tools) {
            const [skillName, actionName] = tool.function.name.split('.');
            if (!skillMap.has(skillName)) {
                skillMap.set(skillName, { name: skillName, actions: [] });
            }
            skillMap.get(skillName)?.actions.push(actionName);
        }

        return Array.from(skillMap.values()).map(s => {
            const skillMeta = skillReg.getSkill(s.name)?.metadata;
            return {
                name: s.name,
                version: skillMeta?.version ?? '2.0.0',
                description: skillMeta?.description ?? 'Loaded via Skill Registry 2.0',
                actions: s.actions,
                status: skillMeta?.status ?? 'active',
                loadError: skillMeta?.loadError,
                dependencies: skillMeta?.dependencies,
            };
        });
    });

    // Repair skill: install missing npm deps and hot-reload
    app.post<{ Params: { name: string } }>('/api/skills/:name/repair', async (request, reply) => {
        const { name } = request.params;
        const skillReg = deps.agent.getSkillRegistry();
        const skill = skillReg.getSkill(name);

        if (!skill) {
            reply.status(404);
            return { error: `Skill "${name}" not found` };
        }

        const skillDeps = skill.metadata.dependencies;
        if (!skillDeps || Object.keys(skillDeps).length === 0) {
            reply.status(400);
            return { error: `Skill "${name}" has no declared dependencies` };
        }

        const packages = Object.keys(skillDeps);
        deps.logger.info(`Repairing skill "${name}": installing ${packages.join(', ')}`);

        try {
            await new Promise<void>((resolve, reject) => {
                execFile(
                    resolveCliCommand('npm'),
                    ['install', '--save', ...packages],
                    { cwd: process.cwd() },
                    (err, stdout, stderr) => {
                        if (err) {
                            deps.logger.error(`npm install failed: ${stderr || err.message}`);
                            reject(new Error(stderr || err.message));
                        } else {
                            deps.logger.info(`npm install success: ${stdout}`);
                            resolve();
                        }
                    }
                );
            });

            // Hot-reload skill
            // Find skill directory from local-files source
            const localSource = skillReg.getAllSources()
                .find((s: any) => s.name === 'local-files') as any;

            if (localSource && typeof localSource.getSkill === 'function') {
                // Reload from its original directory by re-finding it
                const skillDirs = (deps.config as any)?.skills?.directories ?? [];
                let reloaded = false;
                for (const dir of skillDirs) {
                    const { join, resolve: resolvePath } = await import('path');
                    const skillDir = resolvePath(join(dir, name));
                    const { existsSync } = await import('fs');
                    if (existsSync(skillDir)) {
                        await localSource.loadSkill(skillDir);
                        reloaded = true;
                        break;
                    }
                }
                if (!reloaded) {
                    deps.logger.warn(`Could not find skill directory for "${name}" to hot-reload`);
                }
            }

            return { success: true, message: `依赖安装成功，技能 "${name}" 已热重载` };
        } catch (err: any) {
            reply.status(500);
            return { error: err.message };
        }
    });

    // --- MCP Management API ---
    const registry = deps.agent.getSkillRegistry();
    const MCP_CONFIG_PATH = path.join(process.cwd(), 'mcp-servers.json');

    // Helper to read MCP config
    const readMcpConfig = async (): Promise<McpServerConfig[]> => {
        try {
            if (!fs.existsSync(MCP_CONFIG_PATH)) return [];
            const content = await fs.promises.readFile(MCP_CONFIG_PATH, 'utf-8');
            return JSON.parse(content);
        } catch (e) {
            deps.logger.error('Failed to read MCP config', e);
            return [];
        }
    };

    // Helper to write MCP config
    const writeMcpConfig = async (config: McpServerConfig[]) => {
        await fs.promises.writeFile(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
    };

    app.get('/api/mcp/config', async () => {
        return await readMcpConfig();
    });

    app.post<{ Body: McpServerConfig }>('/api/mcp/config', async (request, reply) => {
        const configs = await readMcpConfig();
        const newConfig = request.body;

        if (!newConfig.id) newConfig.id = nanoid();

        const index = configs.findIndex(c => c.id === newConfig.id);
        if (index >= 0) {
            // Unregister old source before updating
            const oldConfig = configs[index];
            await registry.unregisterSource(`mcp-${oldConfig.name}`).catch(() => { });
            configs[index] = newConfig;
        } else {
            configs.push(newConfig);
        }

        await writeMcpConfig(configs);

        // Register the new MCP source if enabled
        if (newConfig.enabled) {
            try {
                const source = new McpSkillSource(newConfig, deps.logger);
                await registry.registerSource(source);
            } catch (err) {
                deps.logger.warn(`MCP server "${newConfig.name}" saved but connection failed: ${(err as Error).message}`);
            }
        }

        return { success: true, config: newConfig };
    });

    app.delete<{ Params: { id: string } }>('/api/mcp/config/:id', async (request, reply) => {
        const configs = await readMcpConfig();
        const toDelete = configs.find(c => c.id === request.params.id);

        // Unregister MCP source before removing config
        if (toDelete) {
            await registry.unregisterSource(`mcp-${toDelete.name}`).catch(() => { });
        }

        const newConfigs = configs.filter(c => c.id !== request.params.id);
        await writeMcpConfig(newConfigs);
        return { success: true };
    });

    // --- MCP Registry API ---
    const mcpRegistry = new McpRegistryClient(deps.logger);

    app.get<{ Querystring: { cursor?: string; count?: string } }>('/api/mcp/registry', async (request) => {
        const { cursor, count } = request.query;
        return mcpRegistry.listServers(cursor, count ? parseInt(count) : undefined);
    });

    app.get<{ Querystring: { q: string } }>('/api/mcp/registry/search', async (request) => {
        const { q } = request.query;
        if (!q) return { servers: [] };
        const servers = await mcpRegistry.searchServers(q);
        return { servers };
    });

    app.get<{ Params: { name: string } }>('/api/mcp/registry/:name', async (request) => {
        return mcpRegistry.getServer(request.params.name);
    });

    app.post<{ Body: { name: string; env?: Record<string, string> } }>('/api/mcp/registry/install', async (request, reply) => {
        const { name, env } = request.body;
        if (!name) {
            reply.status(400);
            return { error: 'Missing server name' };
        }

        try {
            const entry = await mcpRegistry.getServer(name);
            const newConfig = mcpRegistry.toMcpConfig(entry, env);

            // Persist to mcp-servers.json
            const configs = await readMcpConfig();
            configs.push(newConfig);
            await writeMcpConfig(configs);

            // Register live
            if (newConfig.enabled) {
                try {
                    const source = new McpSkillSource(newConfig, deps.logger);
                    await registry.registerSource(source);
                } catch (err) {
                    deps.logger.warn(`MCP server "${newConfig.name}" installed but connection failed: ${(err as Error).message}`);
                }
            }

            return { success: true, config: newConfig };
        } catch (err) {
            reply.status(500);
            return { error: (err as Error).message };
        }
    });

    // ===== SKILL GENERATOR =====
    app.post<{ Body: { name: string; description: string; actions: any[] } }>('/api/skills/generate', async (request, reply) => {
        if (!deps.skillGenerator) { reply.status(503); return { error: 'Skill generator not available' }; }
        try {
            const { name, description, actions } = request.body;
            const generated = await deps.skillGenerator.generate({ name, description, actions });
            const dir = await deps.skillGenerator.install(generated);
            // Hot-reload: add skill to existing local-files source to avoid overwriting it
            try {
                const genRegistry = deps.skillRegistry ?? deps.agent.getSkillRegistry();
                const existingLocal = genRegistry.getAllSources()
                    .find((s: any) => s.name === 'local-files' && typeof s.loadSkill === 'function') as any;
                if (existingLocal) {
                    await existingLocal.loadSkill(dir);
                    deps.logger.info(`Hot-reloaded skill "${name}" into existing local-files source`);
                } else {
                    const { LocalSkillSource } = await import('../../skills/loader.js');
                    const tempSource = new LocalSkillSource([dir], deps.logger);
                    await tempSource.initialize();
                    await genRegistry.registerSource(tempSource);
                }
            } catch (err) {
                deps.logger.warn(`Hot-reload failed: ${(err as Error).message}`);
            }
            return { success: true, dir, name };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });
}
