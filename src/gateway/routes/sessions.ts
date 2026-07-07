import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { resolveInterrupt } from '../../core/interrupt-coordinator.js';
import { historyRepository } from '../../core/repository.js';
import { taskRepository } from '../../core/task-repository.js';
import { db } from '../../core/database.js';
import type { GatewayDeps } from '../route-deps.js';

/**
 * 会话相关路由：会话 CRUD、消息分页、DAG 任务、Human-in-the-Loop 中断响应、
 * 标题/置顶、反馈、检查点（checkpoints）。
 * 从 server.ts 拆分而来（P0-4），逻辑与原实现保持一致，仅将 `this.x` 改为 `deps.x`。
 */
export async function registerSessionsRoutes(app: FastifyInstance, deps: GatewayDeps): Promise<void> {
    // Get all sessions
    app.get('/api/sessions', async () => {
        const sessions = historyRepository.getSessions();
        return sessions.map(s => {
            // 从最后一条消息内容提取纯文本预览（去除 JSON/Markdown 标记）
            const rawPreview: string = s.last_msg ?? s.first_msg ?? '';
            const preview = rawPreview.replace(/```[\s\S]*?```/g, '[代码]').slice(0, 80);
            return {
                id: s.id,
                title: s.title || s.first_msg || '新对话',
                updatedAt: s.updated_at,
                createdAt: s.created_at,
                is_pinned: Boolean(s.is_pinned),
                preview: preview || undefined,
            };
        });
    });

    // Get specific session messages (paginated)
    app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>('/api/sessions/:id/messages', async (request, reply) => {
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
    app.get<{ Params: { id: string } }>('/api/sessions/:id/tasks', async (request, reply) => {
        const { id } = request.params;
        const dag = taskRepository.getDAG(id);
        return dag;
    });

    // Delete session
    app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
        const { id } = request.params;
        deps.logger.info(`Delete session request: ${id}`);
        try {
            historyRepository.deleteSession(id);
            return { success: true };
        } catch (error: any) {
            deps.logger.error(`Delete session error: ${error.message}`);
            reply.status(500);
            return { error: error.message };
        }
    });

    // Human-in-the-Loop: user approves/rejects a pending interrupt,
    // or answers an ask_user question via the optional `response` text
    app.post<{ Params: { id: string }; Body: { approved: boolean; response?: string } }>(
        '/api/sessions/:id/interrupt-response',
        async (request, reply) => {
            const { id: sessionId } = request.params;
            const { approved, response } = request.body;
            const resolved = resolveInterrupt(sessionId, approved === true, response ? { response } : undefined);
            if (!resolved) {
                reply.status(404);
                return { error: 'No pending interrupt for this session' };
            }
            deps.logger.info(`Interrupt resolved for session ${sessionId}: approved=${approved}${response ? ' (with text response)' : ''}`);
            return { ok: true };
        }
    );

    // Update session title
    app.patch<{ Params: { id: string }, Body: { title: string } }>('/api/sessions/:id/title', async (request, reply) => {
        const { id } = request.params;
        const { title } = request.body;
        try {
            historyRepository.updateSessionTitle(id, title);
            return { success: true };
        } catch (error: any) {
            deps.logger.error(`Update title error: ${error.message}`);
            reply.status(500);
            return { error: error.message };
        }
    });

    // Toggle pin session
    app.patch<{ Params: { id: string }, Body: { isPinned: boolean } }>('/api/sessions/:id/pin', async (request, reply) => {
        const { id } = request.params;
        const { isPinned } = request.body;
        try {
            historyRepository.togglePin(id, isPinned);
            return { success: true };
        } catch (error: any) {
            deps.logger.error(`Toggle pin error: ${error.message}`);
            reply.status(500);
            return { error: error.message };
        }
    });

    // Feedback API
    app.post<{ Body: { messageId: string; sessionId: string; rating: 'positive' | 'negative' } }>('/api/feedback', async (request, reply) => {
        const { messageId, sessionId, rating } = request.body;
        if (!messageId || !sessionId || !rating) {
            reply.status(400);
            return { error: 'Missing required fields: messageId, sessionId, rating' };
        }
        try {
            const id = historyRepository.saveFeedback(messageId, sessionId, rating);

            // Trigger self-improvement on negative feedback (async, non-blocking)
            if (rating === 'negative' && deps.selfImprovementEngine) {
                deps.selfImprovementEngine.onNegativeFeedback(messageId, sessionId).catch(err => {
                    deps.logger.error(`Self-improvement trigger failed: ${err.message}`);
                });
            }

            return { success: true, id };
        } catch (error: any) {
            deps.logger.error(`Feedback error: ${error.message}`);
            reply.status(500);
            return { error: error.message };
        }
    });

    // ===== CHECKPOINTS (T2-4) =====
    // GET  /api/sessions/:id/checkpoints         — 列出检查点
    app.get<{ Params: { id: string } }>('/api/sessions/:id/checkpoints', async (request, reply) => {
        if (!deps.checkpointManager) { reply.status(503); return { error: 'Checkpoint manager not available' }; }
        return deps.checkpointManager.list(request.params.id);
    });

    // POST /api/sessions/:id/checkpoints         — 创建检查点
    app.post<{ Params: { id: string }; Body: { label?: string } }>('/api/sessions/:id/checkpoints', async (request, reply) => {
        if (!deps.checkpointManager) { reply.status(503); return { error: 'Checkpoint manager not available' }; }
        const { id: sessionId } = request.params;
        const { label } = request.body ?? {};
        try {
            // 从 repository 获取当前消息历史
            const { historyRepository: hr } = await import('../../core/repository.js');
            const msgs = hr.getMessages(sessionId);

            // 防止超大快照（限 10MB）
            const json = JSON.stringify(msgs);
            if (json.length > 10 * 1024 * 1024) {
                reply.status(413);
                return { error: `消息历史过大（${(json.length / 1024 / 1024).toFixed(1)} MB），超出检查点 10 MB 限制` };
            }

            const cpId = deps.checkpointManager.save(sessionId, msgs as any[], label);
            return { id: cpId, messageCount: msgs.length };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    // POST /api/sessions/:id/checkpoints/:cpId/restore — 恢复检查点（校验 session 归属）
    app.post<{ Params: { id: string; cpId: string } }>('/api/sessions/:id/checkpoints/:cpId/restore', async (request, reply) => {
        if (!deps.checkpointManager) { reply.status(503); return { error: 'Checkpoint manager not available' }; }
        const { id: sessionId, cpId } = request.params;
        const messages = deps.checkpointManager.restore(cpId, sessionId);
        if (!messages) { reply.status(404); return { error: 'Checkpoint not found' }; }
        return { messages, messageCount: messages.length };
    });

    // DELETE /api/sessions/:id/checkpoints/:cpId — 删除检查点（校验 session 归属）
    app.delete<{ Params: { id: string; cpId: string } }>('/api/sessions/:id/checkpoints/:cpId', async (request, reply) => {
        if (!deps.checkpointManager) { reply.status(503); return { error: 'Checkpoint manager not available' }; }
        const { id: sessionId, cpId } = request.params;
        const deleted = deps.checkpointManager.delete(cpId, sessionId);
        if (!deleted) { reply.status(404); return { error: 'Checkpoint not found' }; }
        return { success: true };
    });

    // POST /api/sessions — create a new session
    app.post<{ Body: { title?: string } }>('/api/sessions', async (request) => {
        const id = nanoid();
        const title = request.body?.title || '新对话';
        const now = new Date().toISOString();
        db.prepare('INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, title, now, now);
        return { id, title, createdAt: now, updatedAt: now };
    });
}
