import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { nanoid } from 'nanoid';
import type { Config, ChatRequest, Logger, Message } from '../types.js';
import { Agent } from '../core/agent.js';
import { SessionMemoryManager } from '../memory/short-term.js';

/**
 * Gateway 服务器
 * 提供 HTTP 和 WebSocket 接口
 */
export class GatewayServer {
    private app: FastifyInstance;
    private agent: Agent;
    private sessionManager: SessionMemoryManager;
    private logger: Logger;
    private conversationHistory: Map<string, Message[]> = new Map();

    constructor(options: {
        agent: Agent;
        sessionManager: SessionMemoryManager;
        logger: Logger;
        config: Config;
    }) {
        this.agent = options.agent;
        this.sessionManager = options.sessionManager;
        this.logger = options.logger;

        this.app = Fastify({
            logger: options.config.logging.prettyPrint
                ? { level: options.config.logging.level }
                : false,
        });

        this.setupMiddleware();
        this.setupRoutes();
    }

    private async setupMiddleware(): Promise<void> {
        await this.app.register(cors, {
            origin: true,
            credentials: true,
        });
        await this.app.register(websocket);
    }

    private setupRoutes(): void {
        // Health check
        this.app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

        // Chat API (non-streaming)
        this.app.post<{ Body: ChatRequest }>('/api/chat', async (request, reply) => {
            const { message, sessionId = nanoid(), userId, context } = request.body;

            this.logger.info(`Chat request: session=${sessionId}`);

            const memory = this.sessionManager.getSession(sessionId);
            const history = this.conversationHistory.get(sessionId) || [];

            try {
                const { answer, steps } = await this.agent.execute(message, {
                    sessionId,
                    userId,
                    memory,
                    history,
                });

                // Update history
                history.push({ role: 'user', content: message });
                history.push({ role: 'assistant', content: answer });
                this.conversationHistory.set(sessionId, history);

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
            const { message, sessionId = nanoid(), userId } = request.body;

            this.logger.info(`Stream chat request: session=${sessionId}`);

            const memory = this.sessionManager.getSession(sessionId);
            const history = this.conversationHistory.get(sessionId) || [];

            reply.raw.setHeader('Content-Type', 'text/event-stream');
            reply.raw.setHeader('Cache-Control', 'no-cache');
            reply.raw.setHeader('Connection', 'keep-alive');

            try {
                for await (const step of this.agent.run(message, { sessionId, userId, memory, history })) {
                    reply.raw.write(`data: ${JSON.stringify(step)}\n\n`);
                }
                reply.raw.write('data: [DONE]\n\n');
            } catch (error: any) {
                reply.raw.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
            }

            reply.raw.end();
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
                        const history = this.conversationHistory.get(sessionId) || [];

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
            // This would need access to skill registry
            return { message: 'Skills endpoint - TODO: wire up registry' };
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
