import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import type { ChatRequest } from '../../types.js';
import { cancelInterrupt } from '../../core/interrupt-coordinator.js';
import { historyRepository } from '../../core/repository.js';
import type { GatewayDeps } from '../route-deps.js';

/**
 * Chat 路由：非流式 /api/chat、SSE 流式 /api/chat/stream、WebSocket /ws。
 * 从 server.ts 拆分而来（P0-4），逻辑与原实现保持一致，仅将 `this.x` 改为 `deps.x`。
 */
export async function registerChatRoutes(app: FastifyInstance, deps: GatewayDeps): Promise<void> {
    // Chat API (non-streaming)
    app.post<{ Body: ChatRequest }>('/api/chat', async (request, reply) => {
        const { message, sessionId = nanoid(), userId, context } = request.body;

        deps.logger.info(`Chat request: session=${sessionId}`);

        const memory = deps.sessionManager.getSession(sessionId);
        const history = historyRepository.getMessages(sessionId);

        try {
            const { answer, steps } = await deps.agent.execute(message, {
                sessionId,
                userId,
                memory,
                history,
            });

            // Update history — 用事务原子保存，防止进程崩溃导致对话只存一半
            historyRepository.saveConversationTurn(
                sessionId,
                { role: 'user', content: message },
                { role: 'assistant', content: answer }
            );

            // Auto-generate title for new sessions (async)
            if ((history?.length || 0) <= 2) {
                deps.agent.generateTitle(message).then(title => {
                    deps.logger.info(`Generated title for session ${sessionId}: ${title}`);
                    historyRepository.updateSessionTitle(sessionId, title);
                }).catch(err => {
                    deps.logger.error(`Title generation failed: ${err.message}`);
                });
            }

            return {
                sessionId,
                message: answer,
                steps,
            };
        } catch (error: any) {
            deps.logger.error(`Chat error: ${error.message}`);
            reply.status(500);
            return { error: error.message };
        }
    });

    // Chat API (streaming via SSE)
    app.post<{ Body: ChatRequest }>('/api/chat/stream', async (request, reply) => {
        const { message, messageContent, sessionId = nanoid(), userId, history: clientHistory, attachments } = request.body;

        deps.logger.info(`Stream chat request: session=${sessionId}`);

        // Sync with client history if provided (client as source of truth)
        if (clientHistory) {
            // historyRepository.syncHistory(sessionId, clientHistory);
        }

        const memory = deps.sessionManager.getSession(sessionId);
        const history = historyRepository.getMessages(sessionId);

        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        const abortController = new AbortController();

        // Listen to response closure instead of request closure to detect client disconnection accurately
        reply.raw.on('close', () => {
            if (!reply.raw.writableFinished) {
                deps.logger.warn(`Stream request interrupted by client (disconnection detected): session=${sessionId}`);
                abortController.abort();
                // Cancel any pending human-in-the-loop interrupt so the agent doesn't hang
                cancelInterrupt(sessionId);
            }
        });

        let assistantAnswer = '';
        const workflowSteps: any[] = [];

        // Use multimodal content if provided, otherwise fall back to plain string
        const userInput = (messageContent && messageContent.length > 0 ? messageContent : message) as string;

        try {
            for await (const step of deps.agent.run(userInput, {
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
                // Collect workflow_generated steps for persistence
                if ((step as any).type === 'workflow_generated') {
                    const wf = step as any;
                    workflowSteps.push({
                        workflow_generated: {
                            workflow: wf.workflow,
                            subWorkflows: wf.subWorkflows,
                            validation: wf.validation,
                            allValid: wf.allValid,
                            explanation: wf.explanation,
                        },
                    });
                }
                if (reply.raw.writable) {
                    reply.raw.write(`data: ${JSON.stringify(step)}\n\n`);
                } else {
                    abortController.abort(); // 连接已断开，中止 agent
                    break;
                }
            }

            // Persist history after success — 用事务原子保存，并跳过空答案（客户端中途断连场景）
            if (!abortController.signal.aborted && assistantAnswer) {
                const assistantMsgMetadata = workflowSteps.length > 0
                    ? { custom: { steps: workflowSteps } }
                    : undefined;
                const { assistantMsgId } = historyRepository.saveConversationTurn(
                    sessionId,
                    { role: 'user', content: messageContent && messageContent.length > 0 ? messageContent : message, attachments },
                    { role: 'assistant', content: assistantAnswer, metadata: assistantMsgMetadata } as any
                );

                // Send meta chunk with assistant message ID for feedback correlation
                if (reply.raw.writable) {
                    reply.raw.write(`data: ${JSON.stringify({ type: 'meta', assistantMessageId: assistantMsgId })}\n\n`);
                }

                // Auto-generate title for new sessions (async)
                if ((history?.length || 0) <= 2) {
                    deps.agent.generateTitle(message).then(title => {
                        deps.logger.info(`Generated title for session ${sessionId}: ${title}`);
                        historyRepository.updateSessionTitle(sessionId, title);
                    }).catch(err => {
                        deps.logger.error(`Title generation failed: ${err.message}`);
                    });
                }

                reply.raw.write('data: [DONE]\n\n');
            }
        } catch (error: any) {
            if (error.name === 'AbortError' || error.message?.includes('aborted')) {
                deps.logger.info(`Stream aborted as requested: session=${sessionId}`);
            } else {
                deps.logger.error(`Stream error: ${error.message}`);
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
    app.get('/ws', { websocket: true }, (socket, request) => {
        const sessionId = nanoid();
        deps.logger.info(`WebSocket connected: session=${sessionId}`);

        socket.on('message', async (rawMessage: Buffer) => {
            try {
                const data = JSON.parse(rawMessage.toString());
                const { type, message: userMessage } = data;

                if (type === 'chat') {
                    const memory = deps.sessionManager.getSession(sessionId);
                    const history = historyRepository.getMessages(sessionId);

                    for await (const step of deps.agent.run(userMessage, { sessionId, memory, history })) {
                        socket.send(JSON.stringify(step));
                    }

                    socket.send(JSON.stringify({ type: 'done' }));
                }
            } catch (error: any) {
                socket.send(JSON.stringify({ type: 'error', content: error.message }));
            }
        });

        socket.on('close', () => {
            deps.logger.info(`WebSocket disconnected: session=${sessionId}`);
        });
    });
}
