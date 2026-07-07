import type { FastifyInstance, FastifyReply } from 'fastify';
import { nanoid } from 'nanoid';
import type { ChatRequest, ExecutionStep } from '../../types.js';
import { cancelInterrupt } from '../../core/interrupt-coordinator.js';
import { historyRepository } from '../../core/repository.js';
import { sanitizeStepForStream } from '../../core/step-sanitizer.js';
import type { GatewayDeps } from '../route-deps.js';

/**
 * 带背压的 SSE 写出：write 返回 false 时等待 drain（或连接关闭），
 * 防止大流量下数据无限堆积在 Node 内存。
 */
function writeSse(reply: FastifyReply, payload: string): Promise<void> {
    if (!reply.raw.writable) return Promise.resolve();
    const ok = reply.raw.write(payload);
    if (ok) return Promise.resolve();
    return new Promise<void>(resolve => {
        const onDone = () => {
            reply.raw.off('drain', onDone);
            reply.raw.off('close', onDone);
            resolve();
        };
        reply.raw.once('drain', onDone);
        reply.raw.once('close', onDone);
    });
}

/**
 * 将后端 ExecutionStep 流归约为前端 ChatThinking 使用的 UI step 形状
 * （与 assistant-runtime.ts 的归约逻辑保持一致），用于持久化到
 * assistant 消息 metadata.custom.steps，刷新后可恢复执行过程。
 */
function reduceUiStep(uiSteps: any[], step: ExecutionStep): void {
    const s = step as any;
    // 子 Agent 步骤：聚合到 subTask 分组（必须先于 type 判断，否则被父级分支吞掉）
    if (s.delegatedFrom && s.harnessInstanceId) {
        const existing = uiSteps.find(u => u.subTask?.instanceId === s.harnessInstanceId);
        if (existing) {
            existing.subTask.steps.push(step);
            if (step.type === 'answer') existing.subTask.status = 'completed';
        } else {
            uiSteps.push({
                subTask: {
                    delegatedFrom: s.delegatedFrom,
                    instanceId: s.harnessInstanceId,
                    steps: [step],
                    status: 'running',
                    startTime: new Date(),
                },
            });
        }
        return;
    }
    switch (step.type) {
        case 'thought':
            uiSteps.push({ thought: step.content });
            break;
        case 'plan':
            try {
                uiSteps.push({ plan: typeof step.content === 'string' ? JSON.parse(step.content) : step.content });
            } catch {
                uiSteps.push({ plan: [String(step.content)] });
            }
            break;
        case 'action':
            uiSteps.push({ action: s.toolName || step.content || 'tool' });
            break;
        case 'observation': {
            const last = uiSteps[uiSteps.length - 1];
            if (last) {
                last.observation = step.content ?? '';
                if (s.duration !== undefined) last.duration = s.duration;
            }
            break;
        }
        case 'task_created':
        case 'task_completed':
        case 'task_failed':
            uiSteps.push({ task: { type: step.type, taskId: s.taskId, content: step.content } });
            break;
        case 'context_compressed':
            uiSteps.push({ contextCompressed: { droppedCount: s.droppedCount ?? 0, summary: step.content ?? '对话历史已压缩' } });
            break;
        case 'grading':
        case 'grade_result':
            uiSteps.push({ grading: { type: step.type, content: step.content } });
            break;
        case 'workflow_generated':
            uiSteps.push({
                workflow_generated: {
                    workflow: s.workflow,
                    subWorkflows: s.subWorkflows,
                    validation: s.validation,
                    allValid: s.allValid,
                    explanation: s.explanation,
                },
            });
            break;
        default:
            // content/answer/meta/suggestions/interrupt 不参与持久化步骤
            break;
    }
}

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
        let partialContent = '';
        const uiSteps: any[] = [];

        // Use multimodal content if provided, otherwise fall back to plain string
        const userInput = (messageContent && messageContent.length > 0 ? messageContent : message) as string;
        const userMsgContent = messageContent && messageContent.length > 0 ? messageContent : message;

        // 用户消息在请求开始时即落库（saveMessage 自带同内容幂等去重），
        // 中途断连/卡死/崩溃不再丢失整轮对话。
        try {
            historyRepository.saveMessage(sessionId, { role: 'user', content: userMsgContent, attachments } as any);
        } catch (err: any) {
            deps.logger.error(`Failed to persist user message: ${err.message}`);
        }

        const maybeGenerateTitle = () => {
            if ((history?.length || 0) <= 2) {
                deps.agent.generateTitle(message).then(title => {
                    deps.logger.info(`Generated title for session ${sessionId}: ${title}`);
                    historyRepository.updateSessionTitle(sessionId, title);
                }).catch(err => {
                    deps.logger.error(`Title generation failed: ${err.message}`);
                });
            }
        };

        /** 保存 assistant 消息（完整或部分），返回消息 ID；无可保存内容时返回 null */
        const persistAssistant = (interrupted: boolean): string | null => {
            const content = assistantAnswer
                || (partialContent ? `${partialContent}\n\n> ⚠️ 回答在生成过程中被中断` : '')
                || (uiSteps.length > 0 ? '(执行被中断，未生成最终回答)' : '');
            if (!content) return null;
            try {
                const metadata = uiSteps.length > 0 ? { custom: { steps: uiSteps } } : undefined;
                const id = historyRepository.saveMessage(sessionId, {
                    role: 'assistant', content, metadata,
                } as any);
                if (interrupted) {
                    deps.logger.info(`Persisted partial assistant message on interruption: session=${sessionId}`);
                }
                maybeGenerateTitle();
                return id;
            } catch (err: any) {
                deps.logger.error(`Failed to persist assistant message: ${err.message}`);
                return null;
            }
        };

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
                } else if (step.type === 'content' && !(step as any).delegatedFrom) {
                    partialContent += step.content ?? '';
                }

                // 传输层截断（不影响 LLM 上下文），同时用于持久化步骤归约
                const safeStep = sanitizeStepForStream(step);
                reduceUiStep(uiSteps, safeStep);

                if (reply.raw.writable) {
                    await writeSse(reply, `data: ${JSON.stringify(safeStep)}\n\n`);
                } else {
                    abortController.abort(); // 连接已断开，中止 agent
                    break;
                }
            }

            if (!abortController.signal.aborted && assistantAnswer) {
                const assistantMsgId = persistAssistant(false);

                // Send meta chunk with assistant message ID for feedback correlation
                if (assistantMsgId && reply.raw.writable) {
                    await writeSse(reply, `data: ${JSON.stringify({ type: 'meta', assistantMessageId: assistantMsgId })}\n\n`);
                }

                await writeSse(reply, 'data: [DONE]\n\n');
            } else {
                // 中断场景：保存已产生的部分回答与执行步骤
                persistAssistant(true);
            }
        } catch (error: any) {
            if (error.name === 'AbortError' || error.message?.includes('aborted')) {
                deps.logger.info(`Stream aborted as requested: session=${sessionId}`);
            } else {
                deps.logger.error(`Stream error: ${error.message}`);
                if (reply.raw.writable) {
                    await writeSse(reply, `data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
                }
            }
            // 异常场景同样保存部分结果，避免整轮对话丢失
            persistAssistant(true);
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
                        socket.send(JSON.stringify(sanitizeStepForStream(step)));
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
