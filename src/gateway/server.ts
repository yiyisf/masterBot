import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { nanoid } from 'nanoid';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { resolveCliCommand } from '../skills/utils.js';
import { llmFactory } from '../llm/index.js';
import type { Config, ChatRequest, Logger, Message, McpServerConfig } from '../types.js';
import { Agent } from '../core/agent.js';
import { SessionMemoryManager } from '../memory/short-term.js';
import { historyRepository } from '../core/repository.js';
import { taskRepository } from '../core/task-repository.js';
import { McpSkillSource } from '../skills/mcp-source.js';
import { McpRegistryClient } from '../skills/mcp-registry.js';
import { createAuthHook } from './auth.js';
import { db } from '../core/database.js';
import { webhookRepository } from '../core/webhook-repository.js';
import { RunbookEngine } from '../core/runbook-engine.js';

/**
 * Gateway 服务器
 * 提供 HTTP 和 WebSocket 接口
 */
export class GatewayServer {
    private app: FastifyInstance;
    private agent: Agent;
    private sessionManager: SessionMemoryManager;
    private logger: Logger;
    private config: Config;
    private knowledgeGraph?: any;
    private orchestrator?: any;
    private skillGenerator?: any;
    private skillRegistry?: any;
    private connectorManager?: any;
    private scheduler?: any;

    constructor(options: {
        agent: Agent;
        sessionManager: SessionMemoryManager;
        logger: Logger;
        config: Config;
        knowledgeGraph?: any;
        orchestrator?: any;
        skillGenerator?: any;
        skillRegistry?: any;
        connectorManager?: any;
        scheduler?: any;
    }) {
        this.agent = options.agent;
        this.sessionManager = options.sessionManager;
        this.logger = options.logger;
        this.config = options.config;
        this.knowledgeGraph = options.knowledgeGraph;
        this.orchestrator = options.orchestrator;
        this.skillGenerator = options.skillGenerator;
        this.skillRegistry = options.skillRegistry;
        this.connectorManager = options.connectorManager;
        this.scheduler = options.scheduler;

        this.app = Fastify({
            logger: options.config.logging.prettyPrint
                ? { level: options.config.logging.level }
                : false,
        });

        this.setupMiddleware();
        this.setupRoutes();
        this.setupStatic();
    }

    private async setupMiddleware(): Promise<void> {
        await this.app.register(cors, {
            origin: true,
            credentials: true,
        });
        await this.app.register(websocket);

        if (this.config.auth?.enabled) {
            this.app.addHook('onRequest', createAuthHook(this.config.auth, this.logger));
        }
    }

    private async setupStatic(): Promise<void> {
        const distPath = path.join(process.cwd(), 'web/out');
        if (fs.existsSync(distPath)) {
            this.logger.info(`Serving static files from ${distPath}`);
            await this.app.register(fastifyStatic, {
                root: distPath,
                prefix: '/',
                index: 'index.html',
                redirect: true,
            });

            // Handle client-side routing (SPAs fallback to index.html for non-asset routes)
            this.app.setNotFoundHandler((request, reply) => {
                const { url } = request;

                // Don't fallback for API or Files (preventing SyntaxError for missing assets)
                if (url.startsWith('/api') || url.includes('.')) {
                    reply.status(404).send({ error: 'Not Found' });
                    return;
                }

                // Fallback to index.html for unknown routes
                reply.sendFile('index.html');
            });
        } else {
            this.logger.warn(`Static files not found at ${distPath}. Web UI will be unavailable.`);
        }
    }

    private setupRoutes(): void {
        // Health check
        this.app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

        // Chat API (non-streaming)
        this.app.post<{ Body: ChatRequest }>('/api/chat', async (request, reply) => {
            const { message, sessionId = nanoid(), userId, context } = request.body;

            this.logger.info(`Chat request: session=${sessionId}`);

            const memory = this.sessionManager.getSession(sessionId);
            const history = historyRepository.getMessages(sessionId);

            try {
                const { answer, steps } = await this.agent.execute(message, {
                    sessionId,
                    userId,
                    memory,
                    history,
                });

                // Update history
                historyRepository.saveMessage(sessionId, { role: 'user', content: message });
                historyRepository.saveMessage(sessionId, { role: 'assistant', content: answer });

                // Auto-generate title for new sessions (async)
                if ((history?.length || 0) <= 2) {
                    this.agent.generateTitle(message).then(title => {
                        this.logger.info(`Generated title for session ${sessionId}: ${title}`);
                        historyRepository.updateSessionTitle(sessionId, title);
                    }).catch(err => {
                        this.logger.error(`Title generation failed: ${err.message}`);
                    });
                }

                return {
                    sessionId,
                    message: answer,
                    steps,
                };
            } catch (error: any) {
                this.logger.error(`Chat error: ${error.message}`);
                reply.status(500);
                return { error: error.message };
            }
        });

        // Chat API (streaming via SSE)
        this.app.post<{ Body: ChatRequest }>('/api/chat/stream', async (request, reply) => {
            const { message, sessionId = nanoid(), userId, history: clientHistory, attachments } = request.body;

            this.logger.info(`Stream chat request: session=${sessionId}`);

            // Sync with client history if provided (client as source of truth)
            if (clientHistory) {
                // historyRepository.syncHistory(sessionId, clientHistory);
            }

            const memory = this.sessionManager.getSession(sessionId);
            const history = historyRepository.getMessages(sessionId);

            reply.raw.setHeader('Content-Type', 'text/event-stream');
            reply.raw.setHeader('Cache-Control', 'no-cache');
            reply.raw.setHeader('Connection', 'keep-alive');

            const abortController = new AbortController();

            // Listen to response closure instead of request closure to detect client disconnection accurately
            reply.raw.on('close', () => {
                if (!reply.raw.writableFinished) {
                    this.logger.warn(`Stream request interrupted by client (disconnection detected): session=${sessionId}`);
                    abortController.abort();
                }
            });

            let assistantAnswer = '';

            try {
                for await (const step of this.agent.run(message, {
                    sessionId,
                    userId,
                    memory,
                    history,
                    abortSignal: abortController.signal,
                    attachments
                })) {
                    if (step.type === 'answer') {
                        assistantAnswer = step.content;
                    }
                    if (reply.raw.writable) {
                        reply.raw.write(`data: ${JSON.stringify(step)}\n\n`);
                    } else {
                        break;
                    }
                }

                // Persist history after success
                if (!abortController.signal.aborted) {
                    historyRepository.saveMessage(sessionId, {
                        role: 'user',
                        content: message,
                        attachments: attachments
                    });
                    const assistantMsgId = historyRepository.saveMessage(sessionId, {
                        role: 'assistant',
                        content: assistantAnswer
                    });

                    // Send meta chunk with assistant message ID for feedback correlation
                    if (reply.raw.writable && assistantMsgId !== 'duplicate') {
                        reply.raw.write(`data: ${JSON.stringify({ type: 'meta', assistantMessageId: assistantMsgId })}\n\n`);
                    }

                    // Auto-generate title for new sessions (async)
                    if ((history?.length || 0) <= 2) {
                        this.agent.generateTitle(message).then(title => {
                            this.logger.info(`Generated title for session ${sessionId}: ${title}`);
                            historyRepository.updateSessionTitle(sessionId, title);
                        }).catch(err => {
                            this.logger.error(`Title generation failed: ${err.message}`);
                        });
                    }

                    reply.raw.write('data: [DONE]\n\n');
                }
            } catch (error: any) {
                if (error.name === 'AbortError' || error.message?.includes('aborted')) {
                    this.logger.info(`Stream aborted as requested: session=${sessionId}`);
                } else {
                    this.logger.error(`Stream error: ${error.message}`);
                    if (reply.raw.writable) {
                        reply.raw.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
                    }
                }
            }

            if (!reply.raw.writableFinished) {
                reply.raw.end();
            }
        });

        // WebSocket endpoint
        this.app.get('/ws', { websocket: true }, (socket, request) => {
            const sessionId = nanoid();
            this.logger.info(`WebSocket connected: session=${sessionId}`);

            socket.on('message', async (rawMessage: Buffer) => {
                try {
                    const data = JSON.parse(rawMessage.toString());
                    const { type, message: userMessage } = data;

                    if (type === 'chat') {
                        const memory = this.sessionManager.getSession(sessionId);
                        const history = historyRepository.getMessages(sessionId);

                        for await (const step of this.agent.run(userMessage, { sessionId, memory, history })) {
                            socket.send(JSON.stringify(step));
                        }

                        socket.send(JSON.stringify({ type: 'done' }));
                    }
                } catch (error: any) {
                    socket.send(JSON.stringify({ type: 'error', content: error.message }));
                }
            });

            socket.on('close', () => {
                this.logger.info(`WebSocket disconnected: session=${sessionId}`);
            });
        });

        // List skills (Derived from tools + metadata)
        this.app.get('/api/skills', async () => {
            const skillReg = this.agent.getSkillRegistry();
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
        this.app.post<{ Params: { name: string } }>('/api/skills/:name/repair', async (request, reply) => {
            const { name } = request.params;
            const skillReg = this.agent.getSkillRegistry();
            const skill = skillReg.getSkill(name);

            if (!skill) {
                reply.status(404);
                return { error: `Skill "${name}" not found` };
            }

            const deps = skill.metadata.dependencies;
            if (!deps || Object.keys(deps).length === 0) {
                reply.status(400);
                return { error: `Skill "${name}" has no declared dependencies` };
            }

            const packages = Object.keys(deps);
            this.logger.info(`Repairing skill "${name}": installing ${packages.join(', ')}`);

            try {
                await new Promise<void>((resolve, reject) => {
                    execFile(
                        resolveCliCommand('npm'),
                        ['install', '--save', ...packages],
                        { cwd: process.cwd() },
                        (err, stdout, stderr) => {
                            if (err) {
                                this.logger.error(`npm install failed: ${stderr || err.message}`);
                                reject(new Error(stderr || err.message));
                            } else {
                                this.logger.info(`npm install success: ${stdout}`);
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
                    const skillDirs = (this as any).config?.skills?.directories ?? [];
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
                        this.logger.warn(`Could not find skill directory for "${name}" to hot-reload`);
                    }
                }

                return { success: true, message: `依赖安装成功，技能 "${name}" 已热重载` };
            } catch (err: any) {
                reply.status(500);
                return { error: err.message };
            }
        });

        // --- MCP Management API ---
        const registry = this.agent.getSkillRegistry();
        const MCP_CONFIG_PATH = path.join(process.cwd(), 'mcp-servers.json');

        // Helper to read MCP config
        const readMcpConfig = async (): Promise<McpServerConfig[]> => {
            try {
                if (!fs.existsSync(MCP_CONFIG_PATH)) return [];
                const content = await fs.promises.readFile(MCP_CONFIG_PATH, 'utf-8');
                return JSON.parse(content);
            } catch (e) {
                this.logger.error('Failed to read MCP config', e);
                return [];
            }
        };

        // Helper to write MCP config
        const writeMcpConfig = async (config: McpServerConfig[]) => {
            await fs.promises.writeFile(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
        };

        this.app.get('/api/mcp/config', async () => {
            return await readMcpConfig();
        });

        this.app.post<{ Body: McpServerConfig }>('/api/mcp/config', async (request, reply) => {
            const configs = await readMcpConfig();
            const newConfig = request.body;

            if (!newConfig.id) newConfig.id = nanoid();

            const index = configs.findIndex(c => c.id === newConfig.id);
            if (index >= 0) {
                // Unregister old source before updating
                const oldConfig = configs[index];
                await registry.unregisterSource(`mcp-${oldConfig.name}`).catch(() => {});
                configs[index] = newConfig;
            } else {
                configs.push(newConfig);
            }

            await writeMcpConfig(configs);

            // Register the new MCP source if enabled
            if (newConfig.enabled) {
                try {
                    const source = new McpSkillSource(newConfig, this.logger);
                    await registry.registerSource(source);
                } catch (err) {
                    this.logger.warn(`MCP server "${newConfig.name}" saved but connection failed: ${(err as Error).message}`);
                }
            }

            return { success: true, config: newConfig };
        });

        this.app.delete<{ Params: { id: string } }>('/api/mcp/config/:id', async (request, reply) => {
            const configs = await readMcpConfig();
            const toDelete = configs.find(c => c.id === request.params.id);

            // Unregister MCP source before removing config
            if (toDelete) {
                await registry.unregisterSource(`mcp-${toDelete.name}`).catch(() => {});
            }

            const newConfigs = configs.filter(c => c.id !== request.params.id);
            await writeMcpConfig(newConfigs);
            return { success: true };
        });

        // --- MCP Registry API ---
        const mcpRegistry = new McpRegistryClient(this.logger);

        this.app.get<{ Querystring: { cursor?: string; count?: string } }>('/api/mcp/registry', async (request) => {
            const { cursor, count } = request.query;
            return mcpRegistry.listServers(cursor, count ? parseInt(count) : undefined);
        });

        this.app.get<{ Querystring: { q: string } }>('/api/mcp/registry/search', async (request) => {
            const { q } = request.query;
            if (!q) return { servers: [] };
            const servers = await mcpRegistry.searchServers(q);
            return { servers };
        });

        this.app.get<{ Params: { name: string } }>('/api/mcp/registry/:name', async (request) => {
            return mcpRegistry.getServer(request.params.name);
        });

        this.app.post<{ Body: { name: string; env?: Record<string, string> } }>('/api/mcp/registry/install', async (request, reply) => {
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
                        const source = new McpSkillSource(newConfig, this.logger);
                        await registry.registerSource(source);
                    } catch (err) {
                        this.logger.warn(`MCP server "${newConfig.name}" installed but connection failed: ${(err as Error).message}`);
                    }
                }

                return { success: true, config: newConfig };
            } catch (err) {
                reply.status(500);
                return { error: (err as Error).message };
            }
        });

        // Get all sessions
        this.app.get('/api/sessions', async () => {
            const sessions = historyRepository.getSessions();
            return sessions.map(s => ({
                id: s.id,
                title: s.title || s.first_msg || '新对话',
                updatedAt: s.updated_at,
                createdAt: s.created_at,
                is_pinned: Boolean(s.is_pinned),
            }));
        });

        // Get specific session messages (paginated)
        this.app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>('/api/sessions/:id/messages', async (request, reply) => {
            const { id } = request.params;
            const { limit, before } = request.query as { limit?: string; before?: string };
            const opts = {
                limit: limit ? parseInt(limit, 10) : 50,
                before: before || undefined,
            };
            const messages = historyRepository.getMessages(id, opts);
            const hasMore = before ? messages.length >= opts.limit : false;
            return { messages, hasMore };
        });

        // Get session DAG tasks
        this.app.get<{ Params: { id: string } }>('/api/sessions/:id/tasks', async (request, reply) => {
            const { id } = request.params;
            const dag = taskRepository.getDAG(id);
            return dag;
        });

        // Delete session
        this.app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
            const { id } = request.params;
            this.logger.info(`Delete session request: ${id}`);
            try {
                historyRepository.deleteSession(id);
                return { success: true };
            } catch (error: any) {
                this.logger.error(`Delete session error: ${error.message}`);
                reply.status(500);
                return { error: error.message };
            }
        });

        // Update session title
        this.app.patch<{ Params: { id: string }, Body: { title: string } }>('/api/sessions/:id/title', async (request, reply) => {
            const { id } = request.params;
            const { title } = request.body;
            try {
                historyRepository.updateSessionTitle(id, title);
                return { success: true };
            } catch (error: any) {
                this.logger.error(`Update title error: ${error.message}`);
                reply.status(500);
                return { error: error.message };
            }
        });

        // Toggle pin session
        this.app.patch<{ Params: { id: string }, Body: { isPinned: boolean } }>('/api/sessions/:id/pin', async (request, reply) => {
            const { id } = request.params;
            const { isPinned } = request.body;
            try {
                historyRepository.togglePin(id, isPinned);
                return { success: true };
            } catch (error: any) {
                this.logger.error(`Toggle pin error: ${error.message}`);
                reply.status(500);
                return { error: error.message };
            }
        });

        // Feedback API
        this.app.post<{ Body: { messageId: string; sessionId: string; rating: 'positive' | 'negative' } }>('/api/feedback', async (request, reply) => {
            const { messageId, sessionId, rating } = request.body;
            if (!messageId || !sessionId || !rating) {
                reply.status(400);
                return { error: 'Missing required fields: messageId, sessionId, rating' };
            }
            try {
                const id = historyRepository.saveFeedback(messageId, sessionId, rating);
                return { success: true, id };
            } catch (error: any) {
                this.logger.error(`Feedback error: ${error.message}`);
                reply.status(500);
                return { error: error.message };
            }
        });

        // System status
        this.app.get('/api/status', async () => {
            const sessions = historyRepository.getSessions();
            return {
                status: 'active',
                version: '0.1.0',
                stats: {
                    totalSessions: sessions.length,
                    totalMessages: historyRepository.getTotalMessageCount(),
                    skillCount: (await this.agent.getSkillRegistry().getToolDefinitions()).length,
                },
                sessions: sessions.map(s => ({
                    id: s.id,
                    title: s.title || s.first_msg || '新对话',
                    updatedAt: s.updated_at
                })),
                llm: {
                    provider: this.agent.getLLMAdapter().provider,
                    // More info can be added here
                }
            };
        });

        // ===== CONFIG MANAGEMENT =====

        // Model configuration (Read/Update)
        this.app.get('/api/config/models', async () => {
            return this.config.models;
        });

        this.app.patch<{ Body: any }>('/api/config/models', async (request, reply) => {
            const newModelConfig = request.body as any;
            this.config.models.default = newModelConfig.default;
            this.config.models.providers = {
                ...this.config.models.providers,
                ...newModelConfig.providers
            };
            llmFactory.clearCache();
            this.logger.info(`LLM configuration hot-reloaded: ${this.config.models.default}`);
            return { success: true, message: 'Configuration updated and hot-reloaded' };
        });

        // Test LLM provider connectivity with a minimal chat call
        this.app.post<{ Body: { providerName: string } }>('/api/config/models/test', async (request, reply) => {
            const { providerName } = request.body;
            const providerConfig = this.config.models.providers[providerName];
            if (!providerConfig) {
                reply.status(404); return { success: false, error: `Provider "${providerName}" not found` };
            }
            try {
                const adapter = llmFactory.getAdapter(providerName, providerConfig);
                const result = await adapter.chat(
                    [{ role: 'user', content: 'Reply with "OK" only, no other text.' }],
                    { maxTokens: 10 }
                );
                const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
                return { success: true, response: content.trim() };
            } catch (err: any) {
                return { success: false, error: err.message };
            }
        });

        // Security configuration (Read/Update)
        this.app.get('/api/config/security', async () => {
            return {
                sandbox: this.config.skills.shell?.sandbox ?? { enabled: true, mode: 'blocklist' },
                auth: this.config.auth ?? { enabled: false, mode: 'api-key' },
            };
        });

        this.app.patch<{ Body: { sandbox?: any; auth?: any } }>('/api/config/security', async (request, reply) => {
            const { sandbox, auth } = request.body;
            if (sandbox !== undefined) {
                if (!this.config.skills.shell) this.config.skills.shell = {};
                this.config.skills.shell.sandbox = { ...this.config.skills.shell?.sandbox, ...sandbox };
            }
            if (auth !== undefined) {
                this.config.auth = { ...this.config.auth, ...auth } as any;
            }
            this.logger.info('[config] Security settings updated');
            return { success: true };
        });

        // Agent configuration (Read/Update)
        this.app.get('/api/config/agent', async () => {
            return this.config.agent;
        });

        this.app.patch<{ Body: { maxIterations?: number; maxContextTokens?: number } }>('/api/config/agent', async (request, reply) => {
            const { maxIterations, maxContextTokens } = request.body;
            if (maxIterations !== undefined) this.config.agent.maxIterations = Number(maxIterations);
            if (maxContextTokens !== undefined) this.config.agent.maxContextTokens = Number(maxContextTokens);
            this.logger.info(`[config] Agent settings updated: maxIterations=${this.config.agent.maxIterations}, maxContextTokens=${this.config.agent.maxContextTokens}`);
            return { success: true };
        });

        // ===== SKILL GENERATOR =====
        this.app.post<{ Body: { name: string; description: string; actions: any[] } }>('/api/skills/generate', async (request, reply) => {
            if (!this.skillGenerator) { reply.status(503); return { error: 'Skill generator not available' }; }
            try {
                const { name, description, actions } = request.body;
                const generated = await this.skillGenerator.generate({ name, description, actions });
                const dir = await this.skillGenerator.install(generated);
                // Hot-reload: add skill to existing local-files source to avoid overwriting it
                try {
                    const registry = this.skillRegistry ?? this.agent.getSkillRegistry();
                    const existingLocal = registry.getAllSources()
                        .find((s: any) => s.name === 'local-files' && typeof s.loadSkill === 'function') as any;
                    if (existingLocal) {
                        await existingLocal.loadSkill(dir);
                        this.logger.info(`Hot-reloaded skill "${name}" into existing local-files source`);
                    } else {
                        const { LocalSkillSource } = await import('../skills/loader.js');
                        const tempSource = new LocalSkillSource([dir], this.logger);
                        await tempSource.initialize();
                        await registry.registerSource(tempSource);
                    }
                } catch (err) {
                    this.logger.warn(`Hot-reload failed: ${(err as Error).message}`);
                }
                return { success: true, dir, name };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // ===== ENTERPRISE CONNECTORS =====
        this.app.get('/api/connectors', async () => {
            if (!this.connectorManager) return [];
            return this.connectorManager.listConfigs();
        });

        this.app.post<{ Body: any }>('/api/connectors', async (request, reply) => {
            if (!this.connectorManager) { reply.status(503); return { error: 'Connector manager not available' }; }
            try {
                const config = request.body as any;
                this.connectorManager.save(config);
                // Register the new source
                const { ConnectorSkillSource } = await import('../skills/connector-source.js');
                const source = new ConnectorSkillSource(config, this.logger);
                await source.initialize();
                await this.agent.getSkillRegistry().registerSource(source);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.delete<{ Params: { name: string } }>('/api/connectors/:name', async (request, reply) => {
            if (!this.connectorManager) { reply.status(503); return { error: 'Connector manager not available' }; }
            try {
                this.connectorManager.delete(request.params.name);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // ===== SCHEDULED TASKS =====
        this.app.get('/api/scheduled-tasks', async () => {
            if (!this.scheduler) return [];
            return this.scheduler.getTasks();
        });

        this.app.post<{ Body: any }>('/api/scheduled-tasks', async (request, reply) => {
            if (!this.scheduler) { reply.status(503); return { error: 'Scheduler not available' }; }
            try {
                const { name, cronExpr, prompt, sessionId, enabled } = request.body as any;
                const id = this.scheduler.createTask({ name, cronExpr, prompt, sessionId, enabled: enabled !== false });
                return { success: true, id };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.patch<{ Params: { id: string }; Body: any }>('/api/scheduled-tasks/:id', async (request, reply) => {
            if (!this.scheduler) { reply.status(503); return { error: 'Scheduler not available' }; }
            try {
                this.scheduler.updateTask(request.params.id, request.body);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.delete<{ Params: { id: string } }>('/api/scheduled-tasks/:id', async (request, reply) => {
            if (!this.scheduler) { reply.status(503); return { error: 'Scheduler not available' }; }
            try {
                this.scheduler.deleteTask(request.params.id);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.post<{ Params: { id: string } }>('/api/scheduled-tasks/:id/trigger', async (request, reply) => {
            if (!this.scheduler) { reply.status(503); return { error: 'Scheduler not available' }; }
            try {
                const task = this.scheduler.getTask(request.params.id);
                if (!task) { reply.status(404); return { error: 'Task not found' }; }
                const { nanoid } = await import('nanoid');
                const sessionId = task.sessionId || nanoid();
                const memory = this.sessionManager.getSession(sessionId);
                // Run async
                this.agent.execute(task.prompt, { sessionId, memory }).catch(err => {
                    this.logger.error(`Manual trigger failed: ${err.message}`);
                });
                return { success: true, sessionId };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // ===== KNOWLEDGE GRAPH =====
        this.app.get('/api/knowledge/stats', async () => {
            if (!this.knowledgeGraph) return { nodeCount: 0, edgeCount: 0 };
            return this.knowledgeGraph.getStats();
        });

        this.app.post<{ Body: { content: string; title: string; type?: string; source?: string } }>('/api/knowledge/ingest', async (request, reply) => {
            if (!this.knowledgeGraph) { reply.status(503); return { error: 'Knowledge graph not available' }; }
            try {
                const { content, title, type, source } = request.body;
                const id = await this.knowledgeGraph.ingest(content, { title, type, source });
                return { success: true, id };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.get<{ Querystring: { q: string; depth?: string; limit?: string } }>('/api/knowledge/search', async (request, reply) => {
            if (!this.knowledgeGraph) { reply.status(503); return { error: 'Knowledge graph not available' }; }
            try {
                const { q, depth, limit } = request.query as any;
                const result = await this.knowledgeGraph.search(q, {
                    depth: depth ? parseInt(depth) : 2,
                    limit: limit ? parseInt(limit) : 10,
                });
                return result;
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // ===== WORKFLOWS =====
        this.app.get('/api/workflows', async () => {
            const rows = (db as any).prepare('SELECT id, name, description, created_at, updated_at FROM workflows ORDER BY updated_at DESC').all();
            return rows;
        });

        this.app.post<{ Body: { name: string; description?: string; definition: any } }>('/api/workflows', async (request, reply) => {
            try {
                const { nanoid } = await import('nanoid');
                const id = nanoid();
                const now = new Date().toISOString();
                const { name, description, definition } = request.body;
                (db as any).prepare(`INSERT INTO workflows (id, name, description, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
                    .run(id, name, description || null, JSON.stringify(definition), now, now);
                return { success: true, id };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.delete<{ Params: { id: string } }>('/api/workflows/:id', async (request, reply) => {
            try {
                (db as any).prepare('DELETE FROM workflows WHERE id = ?').run(request.params.id);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.post<{ Params: { id: string } }>('/api/workflows/:id/execute', async (request, reply) => {
            try {
                const row = (db as any).prepare('SELECT * FROM workflows WHERE id = ?').get(request.params.id) as any;
                if (!row) { reply.status(404); return { error: 'Workflow not found' }; }
                const definition = JSON.parse(row.definition);
                const { nanoid } = await import('nanoid');
                const sessionId = nanoid();
                const memory = this.sessionManager.getSession(sessionId);
                // Build prompt from workflow nodes
                const nodeDescs = (definition.nodes || []).map((n: any) => `${n.type}: ${n.label}`).join(' → ');
                const prompt = `执行工作流 "${row.name}":\n${nodeDescs}`;
                this.agent.execute(prompt, { sessionId, memory }).catch(err => {
                    this.logger.error(`Workflow execution failed: ${err.message}`);
                });
                return { success: true, sessionId };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // ===== WEBHOOKS =====
        this.app.get('/api/webhooks', async () => {
            return webhookRepository.list();
        });

        this.app.post<{ Body: { name: string; description?: string } }>('/api/webhooks', async (request, reply) => {
            try {
                const { name, description } = request.body;
                if (!name) { reply.status(400); return { error: 'name is required' }; }
                const wh = webhookRepository.create({ name, description });
                return { success: true, webhook: wh };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.patch<{ Params: { id: string }; Body: any }>('/api/webhooks/:id', async (request, reply) => {
            try {
                const wh = webhookRepository.get(request.params.id);
                if (!wh) { reply.status(404); return { error: 'Webhook not found' }; }
                const { name, enabled, description } = request.body as { name?: string; enabled?: boolean; description?: string };
                webhookRepository.update(request.params.id, { name, enabled, description });
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.delete<{ Params: { id: string } }>('/api/webhooks/:id', async (request, reply) => {
            try {
                webhookRepository.delete(request.params.id);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // Inbound webhook trigger — HMAC-SHA256 signature verification
        this.app.post<{ Params: { id: string }; Body: any }>(
            '/api/webhooks/:id/trigger',
            { config: { rawBody: true } },
            async (request, reply) => {
                const { id } = request.params;
                const wh = webhookRepository.get(id);
                if (!wh) { reply.status(404); return { error: 'Webhook not found' }; }
                if (!wh.enabled) { reply.status(403); return { error: 'Webhook is disabled' }; }

                // HMAC-SHA256 signature verification (optional — skip if no signature header)
                const sigHeader = (request.headers['x-signature'] || request.headers['x-hub-signature-256']) as string | undefined;
                if (sigHeader) {
                    const rawBody = (request as any).rawBody as Buffer | undefined;
                    const bodyStr = rawBody ? rawBody.toString() : JSON.stringify(request.body);
                    const expected = 'sha256=' + crypto.createHmac('sha256', wh.secret).update(bodyStr).digest('hex');
                    if (!crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))) {
                        reply.status(401);
                        return { error: 'Invalid signature' };
                    }
                }

                webhookRepository.recordTrigger(id);

                // Trigger agent execution asynchronously
                const sessionId = nanoid();
                const memory = this.sessionManager.getSession(sessionId);
                const payload = JSON.stringify(request.body || {});
                const prompt = `Webhook "${wh.name}" triggered with payload: ${payload}\n请分析此 Webhook 事件并采取相应行动。`;

                this.agent.execute(prompt, { sessionId, memory }).catch(err => {
                    this.logger.error(`Webhook agent execution failed: ${err.message}`);
                });

                return { success: true, sessionId, message: 'Webhook received, agent triggered' };
            }
        );

        // ===== RUNBOOKS =====
        const runbookEngine = new RunbookEngine(this.agent.getSkillRegistry(), this.logger);

        this.app.get('/api/runbooks', async () => {
            return runbookEngine.listRunbooks();
        });

        this.app.post<{ Body: { filename: string; content: string } }>('/api/runbooks', async (request, reply) => {
            try {
                const { filename, content } = request.body;
                if (!filename || !content) { reply.status(400); return { error: 'filename and content required' }; }
                const { writeFileSync, mkdirSync, existsSync } = await import('fs');
                const runbooksDir = path.join(process.cwd(), 'runbooks');
                if (!existsSync(runbooksDir)) mkdirSync(runbooksDir, { recursive: true });
                const safeName = filename.endsWith('.yaml') ? filename : filename + '.yaml';
                writeFileSync(path.join(runbooksDir, safeName), content, 'utf-8');
                return { success: true, filename: safeName };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.post<{ Params: { filename: string }; Body: { variables?: Record<string, unknown> } }>(
            '/api/runbooks/:filename/execute',
            async (request, reply) => {
                try {
                    const runbook = runbookEngine.loadRunbook(request.params.filename);
                    const sessionId = nanoid();
                    const memory = this.sessionManager.getSession(sessionId);
                    const skillContext = {
                        sessionId,
                        logger: this.logger,
                        memory,
                        config: (this.config as any).skills || {},
                        llm: this.agent.getLLMAdapter(),
                    };
                    const result = await runbookEngine.execute(runbook, {
                        sessionId,
                        variables: request.body?.variables,
                        skillContext,
                    });
                    return result;
                } catch (err: any) {
                    reply.status(500); return { error: err.message };
                }
            }
        );

        // ===== RPA API =====
        this.app.post<{ Body: { type: string; params: Record<string, unknown> } }>('/api/rpa/execute', async (request, reply) => {
            try {
                const { type, params } = request.body;
                const sessionId = nanoid();
                const memory = this.sessionManager.getSession(sessionId);
                const skillContext = {
                    sessionId,
                    logger: this.logger,
                    memory,
                    config: (this.config as any).skills || {},
                    llm: this.agent.getLLMAdapter(),
                };
                const toolName = `browser-automation.${type}`;
                const result = await this.agent.getSkillRegistry().executeAction(toolName, params, skillContext);
                return result;
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.post<{ Body: { prompt: string; url?: string } }>('/api/rpa/prompt', async (request, reply) => {
            try {
                const { prompt, url } = request.body;
                const sessionId = nanoid();
                const memory = this.sessionManager.getSession(sessionId);
                const fullPrompt = `[RPA任务] ${url ? `目标网站: ${url}\n` : ''}${prompt}\n\n请使用 browser-automation 技能完成此任务。每次操作后截图确认状态。`;
                this.agent.execute(fullPrompt, { sessionId, memory }).catch(err => {
                    this.logger.error(`RPA agent execution failed: ${err.message}`);
                });
                return { success: true, sessionId, message: 'RPA agent started' };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });
    }

    async start(port: number, host: string): Promise<void> {
        try {
            await this.app.listen({ port, host });
            this.logger.info(`Server listening on http://${host}:${port}`);
        } catch (error) {
            this.logger.error(`Failed to start server: ${error}`);
            throw error;
        }
    }

    async stop(): Promise<void> {
        await this.app.close();
        this.logger.info('Server stopped');
    }
}
