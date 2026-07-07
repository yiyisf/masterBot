import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../route-deps.js';

/**
 * Managed Agents Harness API（Phase 23）：AgentSpec 注册/列表、实例生命周期、
 * 事件流查询。仅当 deps.agentPool 存在时注册（与原 setupAgentPoolRoutes 行为一致）。
 * 从 server.ts 拆分而来（P0-4），逻辑与原实现保持一致，仅将 `this.x` 改为 `deps.x`。
 */
export async function registerAgentPoolRoutes(app: FastifyInstance, deps: GatewayDeps): Promise<void> {
    const pool = deps.agentPool;
    if (!pool) return;

    // GET /api/agents/specs — 列出所有已注册 AgentSpec
    app.get('/api/agents/specs', async () => {
        return pool.listSpecs().map(s => ({
            id: s.id,
            name: s.name,
            version: s.version,
            description: s.description,
            tools: s.tools,
            resources: s.resources,
            hasOutcome: !!s.outcome,
        }));
    });

    // POST /api/agents/specs — 动态注册 AgentSpec（JSON body）
    app.post<{ Body: any }>('/api/agents/specs', async (request, reply) => {
        try {
            const spec = request.body as Record<string, any>;
            if (!spec['id'] || !spec['name']) {
                reply.status(400); return { error: 'id and name are required' };
            }
            pool.registerSpec(spec as any);
            return { success: true, id: spec['id'] };
        } catch (err: any) {
            reply.status(400); return { error: err.message };
        }
    });

    // DELETE /api/agents/specs/:id — 移除 AgentSpec
    app.delete<{ Params: { id: string } }>('/api/agents/specs/:id', async (request, reply) => {
        pool.unregisterSpec(request.params.id);
        return { success: true };
    });

    // GET /api/agents/instances — 列出所有运行实例
    app.get('/api/agents/instances', async () => {
        return pool.listInstances();
    });

    // POST /api/agents/spawn — 手动创建实例
    app.post<{ Body: { specId: string; task: string; sessionId?: string } }>('/api/agents/spawn', async (request, reply) => {
        const { specId, task, sessionId } = request.body;
        if (!specId || !task) {
            reply.status(400); return { error: 'specId and task are required' };
        }
        try {
            const sid = sessionId ?? `harness-${Date.now()}`;
            const memory = deps.sessionManager.getSession(sid);
            const instanceId = await pool.spawn(specId, task, { sessionId: sid, memory });
            return { instanceId, specId };
        } catch (err: any) {
            reply.status(404); return { error: err.message };
        }
    });

    // GET /api/agents/instances/:id — 实例详情 + steps
    app.get<{ Params: { id: string } }>('/api/agents/instances/:id', async (request, reply) => {
        const info = pool.listInstances().find(i => i.instanceId === request.params.id);
        if (!info) { reply.status(404); return { error: 'Instance not found' }; }
        const steps = pool.getInstanceSteps(request.params.id);
        return { ...info, steps };
    });

    // PATCH /api/agents/instances/:id — pause / resume / cancel
    app.patch<{ Params: { id: string }; Body: { action: string } }>('/api/agents/instances/:id', async (request, reply) => {
        const { id } = request.params;
        const { action } = request.body;
        let found: boolean;
        switch (action) {
            case 'pause': found = pool.pause(id); break;
            case 'resume': found = pool.resume(id); break;
            case 'cancel': found = pool.cancel(id); break;
            default: reply.status(400); return { error: `Unknown action: ${action}` };
        }
        if (!found) {
            reply.status(404);
            return { error: `Instance not found or not ${action}able: ${id}` };
        }
        return { success: true, action, instanceId: id };
    });

    // GET /api/agents/instances/:id/steps — 获取实例步骤历史
    app.get<{ Params: { id: string } }>('/api/agents/instances/:id/steps', async (request, reply) => {
        const steps = pool.getInstanceSteps(request.params.id);
        if (!steps) { reply.status(404); return { error: 'Instance not found' }; }
        return { steps };
    });

    // GET /api/agents/sessions/:id/events — 获取 Session 事件日志，支持 EventSelector 过滤（Gap 5）
    // 查询参数：types（逗号分隔）、toolName、last（数字）、from（Unix ms）、to（Unix ms）
    app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
        '/api/agents/sessions/:id/events',
        async (request) => {
            const { id } = request.params;
            const q = request.query;

            const selector = Object.keys(q).length > 0 ? {
                types: q.types ? (q.types.split(',') as any) : undefined,
                toolName: q.toolName ?? undefined,
                last: q.last ? parseInt(q.last, 10) : undefined,
                fromTimestamp: q.from ? parseInt(q.from, 10) : undefined,
                toTimestamp: q.to ? parseInt(q.to, 10) : undefined,
            } : undefined;

            const events = selector
                ? pool.getSessionEvents(id, selector)
                : pool.getSessionEvents(id);

            return { sessionId: id, count: events.length, events };
        }
    );

    deps.logger.info('[harness] Managed Agents API routes registered (/api/agents/*)');
}
