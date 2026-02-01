import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { nanoid } from 'nanoid';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { existsSync } from 'fs';
import { llmFactory } from '../llm/index.js';
import type { Config, ChatRequest, Logger, Message } from '../types.js';
import { Agent } from '../core/agent.js';
import { SessionMemoryManager } from '../memory/short-term.js';
import { historyRepository } from '../core/repository.js';

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
    }

    private async setupStatic(): Promise<void> {
        const distPath = path.join(process.cwd(), 'web/out');
        if (existsSync(distPath)) {
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

        // List skills
        this.app.get('/api/skills', async () => {
            const skills = this.agent.getSkillRegistry().getAll();
            return skills.map(skill => ({
                name: skill.metadata.name,
                version: skill.metadata.version,
                description: skill.metadata.description,
                actions: Array.from(skill.actions.keys()),
            }));
        });

        // Get all sessions
        this.app.get('/api/sessions', async () => {
            const sessions = historyRepository.getSessions();
            return sessions.map(s => ({
                id: s.id,
                title: s.title || s.first_msg || '新对话',
                updatedAt: s.updated_at,
                createdAt: s.created_at
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

        // System status
        this.app.get('/api/status', async () => {
            const sessions = historyRepository.getSessions();
            return {
                status: 'active',
                version: '0.1.0',
                stats: {
                    totalSessions: sessions.length,
                    totalMessages: 0, // TODO: track messages
                    skillCount: this.agent.getSkillRegistry().getAll().length,
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
