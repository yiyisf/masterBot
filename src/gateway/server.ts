import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { nanoid } from 'nanoid';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { llmFactory } from '../llm/index.js';
import type { Config, ChatRequest, Logger, Message, McpServerConfig } from '../types.js';
import { Agent } from '../core/agent.js';
import { SessionMemoryManager } from '../memory/short-term.js';
import { historyRepository } from '../core/repository.js';
import { McpSkillSource } from '../skills/mcp-source.js';
import { createAuthHook } from './auth.js';

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

    constructor(options: {
        agent: Agent;
        sessionManager: SessionMemoryManager;
        logger: Logger;
        config: Config;
    }) {
        this.agent = options.agent;
        this.sessionManager = options.sessionManager;
        this.logger = options.logger;
        this.config = options.config;

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
                    historyRepository.saveMessage(sessionId, {
                        role: 'assistant',
                        content: assistantAnswer
                    });

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

        // List skills (Derived from tools)
        this.app.get('/api/skills', async () => {
            const tools = await this.agent.getSkillRegistry().getToolDefinitions();

            // Group tools by skill name (prefix before first dot)
            const skillMap = new Map<string, { name: string; actions: string[] }>();

            for (const tool of tools) {
                const [skillName, actionName] = tool.function.name.split('.');
                if (!skillMap.has(skillName)) {
                    skillMap.set(skillName, {
                        name: skillName,
                        actions: []
                    });
                }
                skillMap.get(skillName)?.actions.push(actionName);
            }

            return Array.from(skillMap.values()).map(s => ({
                name: s.name,
                version: '2.0.0', // Dynamic version not available in ToolDefinition
                description: 'Loaded via Skill Registry 2.0',
                actions: s.actions,
            }));
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

        // Get specific session messages
        this.app.get<{ Params: { id: string } }>('/api/sessions/:id/messages', async (request, reply) => {
            const { id } = request.params;
            const messages = historyRepository.getMessages(id);
            return {
                sessionId: id,
                messages
            };
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

        // System status
        this.app.get('/api/status', async () => {
            const sessions = historyRepository.getSessions();
            return {
                status: 'active',
                version: '0.1.0',
                stats: {
                    totalSessions: sessions.length,
                    totalMessages: 0, // TODO: track messages
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

        // Model configuration (Read/Update)
        this.app.get('/api/config/models', async () => {
            return this.config.models;
        });

        // ... inside setupRoutes ...
        this.app.patch<{ Body: any }>('/api/config/models', async (request, reply) => {
            const newModelConfig = request.body as any;

            // Update configuration in-memory
            this.config.models.default = newModelConfig.default;
            this.config.models.providers = {
                ...this.config.models.providers,
                ...newModelConfig.providers
            };

            // Clear LLM cache to force re-initialization on next use
            llmFactory.clearCache();

            this.logger.info(`LLM configuration hot-reloaded: ${this.config.models.default}`);
            return { success: true, message: 'Configuration updated and hot-reloaded' };
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
