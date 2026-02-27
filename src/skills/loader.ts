import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import type { Skill, SkillAction, Logger, SkillSource, ToolDefinition, SkillContext } from '../types.js';
import { parseSkillMd, SkillRegistry } from './registry.js';

/**
 * 本地文件技能源
 * 负责从文件系统加载技能并作为 Source 提供给 Registry
 */
export class LocalSkillSource implements SkillSource {
    name = 'local-files';
    type = 'local' as const;

    private skills: Map<string, Skill> = new Map();
    private directories: string[];
    private logger: Logger;
    private loadErrors: Map<string, string> = new Map();

    constructor(directories: string[], logger: Logger) {
        this.directories = directories;
        this.logger = logger;
    }

    async initialize(): Promise<void> {
        this.logger.info('Initializing LocalSkillSource...');
        await this.loadFromDirectories(this.directories);
    }

    private async loadFromDirectories(directories: string[]): Promise<void> {
        for (const dir of directories) {
            const resolvedDir = resolve(dir);
            if (!existsSync(resolvedDir)) {
                this.logger.warn(`Skill directory not found: ${resolvedDir}`);
                continue;
            }
            await this.loadDirectory(resolvedDir);
        }
    }

    private async loadDirectory(directory: string): Promise<void> {
        const entries = await readdir(directory, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skillDir = join(directory, entry.name);
            const skillMdPath = join(skillDir, 'SKILL.md');

            if (!existsSync(skillMdPath)) {
                this.logger.debug(`No SKILL.md found in ${skillDir}, skipping`);
                continue;
            }

            try {
                await this.loadSkill(skillDir);
            } catch (error) {
                this.logger.error(`Failed to load skill from ${skillDir}: ${error}`);
            }
        }
    }

    async loadSkill(skillDir: string): Promise<Skill> {
        const skillMdPath = join(skillDir, 'SKILL.md');

        // 解析 SKILL.md
        const parsed = await parseSkillMd(skillMdPath);
        this.logger.debug(`Parsed SKILL.md: ${parsed.metadata.name}`);

        // 加载实现文件
        const indexPath = join(skillDir, 'index.ts');
        const indexJsPath = join(skillDir, 'index.js');

        let implementation: Record<string, unknown> = {};

        if (existsSync(indexPath) || existsSync(indexJsPath)) {
            const modulePath = existsSync(indexJsPath) ? indexJsPath : indexPath;
            try {
                // 动态导入模块
                const moduleUrl = pathToFileURL(modulePath).href;
                implementation = await import(moduleUrl);
            } catch (error) {
                const errMsg = String(error);
                this.logger.warn(`Could not load implementation for ${parsed.metadata.name}: ${errMsg}`);
                const loadError = errMsg.includes('Cannot find module') || errMsg.includes('Cannot find package')
                    ? `依赖包缺失: ${errMsg}`
                    : `加载失败: ${errMsg}`;
                parsed.metadata.loadError = loadError;
                parsed.metadata.status = 'degraded';
                this.loadErrors.set(parsed.metadata.name, loadError);
            }
        }

        // 依赖探测：若 SKILL.md 声明了 dependencies 且尚无 loadError，逐一 probe
        if (parsed.metadata.dependencies && !parsed.metadata.loadError) {
            const missing = await this.checkDependencies(parsed.metadata.dependencies);
            if (missing.length > 0) {
                const loadError = `依赖包缺失，请运行 npm install: ${missing.join(', ')}`;
                parsed.metadata.loadError = loadError;
                parsed.metadata.status = 'degraded';
                this.loadErrors.set(parsed.metadata.name, loadError);
                this.logger.warn(`Skill "${parsed.metadata.name}" missing dependencies: ${missing.join(', ')}`);
            }
        }

        if (!parsed.metadata.status) {
            parsed.metadata.status = 'active';
        }

        // 构建技能对象
        const actions = new Map<string, SkillAction>();

        for (const actionDef of parsed.actions) {
            const handler = (implementation[actionDef.name] as SkillAction['handler'])
                || (implementation.default as Record<string, SkillAction['handler']>)?.[actionDef.name]
                || this.createPlaceholderHandler(actionDef.name, parsed.metadata.name);

            actions.set(actionDef.name, {
                name: actionDef.name,
                description: actionDef.description,
                parameters: Object.fromEntries(
                    Object.entries(actionDef.parameters).map(([k, v]) => [
                        k,
                        {
                            type: v.type as 'string' | 'number' | 'boolean' | 'object' | 'array',
                            description: v.description,
                            required: v.required,
                        },
                    ])
                ),
                handler,
            });
        }

        const skill: Skill = {
            metadata: parsed.metadata,
            actions,
            init: implementation.init as Skill['init'],
            destroy: implementation.destroy as Skill['destroy'],
        };

        // 初始化技能
        if (skill.init) {
            await skill.init();
        }

        // 存入本地 Map
        this.skills.set(skill.metadata.name, skill);
        return skill;
    }

    private createPlaceholderHandler(actionName: string, skillName: string): SkillAction['handler'] {
        const loadError = this.loadErrors.get(skillName);
        return async () => {
            const reason = loadError ? `（原因: ${loadError}）` : '';
            throw new Error(`技能 '${skillName}' 不可用${reason}`);
        };
    }

    /**
     * 检测 npm 依赖是否已安装
     */
    private async checkDependencies(deps: Record<string, string>): Promise<string[]> {
        // Guard: deps must be a plain object (not array). Array means YAML was malformed.
        if (Array.isArray(deps) || typeof deps !== 'object') {
            this.logger.warn(`Invalid dependencies format (expected object mapping, got ${Array.isArray(deps) ? 'array' : typeof deps}). Check SKILL.md YAML.`);
            return [];
        }
        const missing: string[] = [];
        for (const pkg of Object.keys(deps)) {
            try {
                await import(pkg);
            } catch {
                missing.push(pkg);
            }
        }
        return missing;
    }

    /**
     * 获取技能元数据（包含状态和错误信息）
     */
    getSkill(name: string): Skill | undefined {
        return this.skills.get(name);
    }

    /**
     * 重新加载技能
     */
    async reloadSkill(skillDir: string): Promise<Skill> {
        // 直接覆盖即可
        return this.loadSkill(skillDir);
    }

    // --- SkillSource Implementation ---

    async getTools(): Promise<ToolDefinition[]> {
        const tools: ToolDefinition[] = [];

        for (const skill of this.skills.values()) {
            for (const [actionName, action] of skill.actions) {
                tools.push({
                    type: 'function',
                    function: {
                        name: `${skill.metadata.name}.${actionName}`,
                        description: action.description,
                        parameters: {
                            type: 'object',
                            properties: Object.fromEntries(
                                Object.entries(action.parameters).map(([key, param]) => [
                                    key,
                                    {
                                        type: param.type,
                                        description: param.description,
                                    },
                                ])
                            ),
                            required: Object.entries(action.parameters)
                                .filter(([_, p]) => p.required)
                                .map(([k]) => k),
                        },
                    },
                });
            }
        }
        return tools;
    }

    async execute(toolName: string, params: Record<string, unknown>, context: SkillContext): Promise<unknown> {
        const [skillName, actionName] = toolName.split('.');
        const skill = this.skills.get(skillName);
        if (!skill) throw new Error(`Skill ${skillName} not found`);
        const action = skill.actions.get(actionName);
        if (!action) throw new Error(`Action ${actionName} not found`);

        return action.handler(context, params);
    }

    async destroy(): Promise<void> {
        for (const skill of this.skills.values()) {
            if (skill.destroy) await skill.destroy();
        }
        this.skills.clear();
    }
}

/**
 * Legacy Loader Wrapper
 * (For backward compatibility in initialization)
 */
export class SkillLoader {
    private logger: Logger;
    private registry: SkillRegistry;

    constructor(registry: SkillRegistry, logger: Logger) {
        this.registry = registry;
        this.logger = logger;
    }

    async loadFromDirectories(directories: string[]): Promise<void> {
        // 创建一个新的 LocalSource 并注册到 Registry
        const localSource = new LocalSkillSource(directories, this.logger);
        await this.registry.registerSource(localSource);
    }
}
