import type { FastifyInstance } from 'fastify';
import { db } from '../../core/database.js';
import { imUserRegistry, imSessionMapper } from '../im-gateway.js';
import type { GatewayDeps } from '../route-deps.js';

/**
 * IM 网关路由：IM 集成状态、入站事件、审批卡片回调、IM 用户白名单、会话列表、
 * im-bot 技能内部使用的主动发送消息 API。
 * 从 server.ts 拆分而来（P0-4），逻辑与原实现保持一致，仅将 `this.x` 改为 `deps.x`。
 */
export async function registerImRoutes(app: FastifyInstance, deps: GatewayDeps): Promise<void> {
    // GET /api/im/status — IM integration status
    app.get('/api/im/status', async () => {
        return {
            enabled: deps.config.im?.enabled ?? false,
            platform: deps.config.im?.platform ?? null,
            connected: !!deps.imGateway,
        };
    });

    // POST /api/im/inbound — IM event push endpoint
    app.post<{ Body: unknown }>('/api/im/inbound', {
        config: { rawBody: true },
    }, async (request, reply) => {
        if (!deps.imGateway) {
            reply.status(503);
            return { error: 'IM gateway not configured' };
        }
        const rawBody = (request as any).rawBody ?? JSON.stringify(request.body);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(request.headers)) {
            if (typeof v === 'string') headers[k] = v;
        }
        const result = await deps.imGateway.handleInbound(rawBody, headers) as any;
        if (result?.code === 401) { reply.status(401); return { error: result.error }; }
        if (result?.code === 400) { reply.status(400); return { error: result.error }; }
        return result;
    });

    // POST /api/im/card-action — HitL approval card callback
    app.post<{ Body: unknown }>('/api/im/card-action', async (request, reply) => {
        if (!deps.imGateway) {
            reply.status(503);
            return { error: 'IM gateway not configured' };
        }
        return deps.imGateway.handleCardAction(request.body);
    });

    // GET /api/im/users — list IM users
    app.get<{ Querystring: { platform?: string } }>('/api/im/users', async (request) => {
        return imUserRegistry.listUsers(request.query.platform);
    });

    // POST /api/im/users — add/update IM user whitelist
    app.post<{ Body: { platform: string; imUserId: string; name?: string; role?: string; enabled?: boolean } }>(
        '/api/im/users',
        async (request, reply) => {
            try {
                const { platform, imUserId, name, role, enabled } = request.body;
                if (!platform || !imUserId) { reply.status(400); return { error: 'platform and imUserId are required' }; }
                const id = imUserRegistry.upsertUser({ platform, imUserId, name, role, enabled });
                return { success: true, id };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        }
    );

    // PATCH /api/im/users/:id — update user
    app.patch<{ Params: { id: string }; Body: { role?: string; enabled?: boolean; name?: string } }>(
        '/api/im/users/:id',
        async (request, reply) => {
            try {
                const row = db.prepare('SELECT * FROM im_users WHERE id = ?').get(request.params.id) as any;
                if (!row) { reply.status(404); return { error: 'User not found' }; }
                const now = new Date().toISOString();
                const { role, enabled, name } = request.body;
                db.prepare('UPDATE im_users SET role = ?, enabled = ?, name = ?, updated_at = ? WHERE id = ?')
                    .run(
                        role ?? row.role,
                        enabled !== undefined ? (enabled ? 1 : 0) : row.enabled,
                        name ?? row.name,
                        now,
                        request.params.id
                    );
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        }
    );

    // DELETE /api/im/users/:id
    app.delete<{ Params: { id: string } }>('/api/im/users/:id', async (request, reply) => {
        try {
            imUserRegistry.deleteUser(request.params.id);
            return { success: true };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    // GET /api/im/sessions
    app.get<{ Querystring: { platform?: string } }>('/api/im/sessions', async (request) => {
        return imSessionMapper.listSessions(request.query.platform);
    });

    // POST /api/im/send — internal API used by im-bot skill to send messages
    app.post<{ Body: { platform: string; conversationId: string; userId: string; type: string; content?: string; title?: string; template?: string } }>(
        '/api/im/send',
        async (request, reply) => {
            if (!deps.imGateway) {
                // Mock mode: log only
                deps.logger.info(`[im-bot] Mock send: ${JSON.stringify(request.body)}`);
                return { success: true, mock: true };
            }
            try {
                const { platform, conversationId, userId, type, content, title } = request.body;
                const target = { platform, conversationId, userId };
                if (type === 'text') {
                    await (deps.imGateway as any).adapter.sendMessage(target, content ?? '');
                } else if (type === 'card') {
                    await (deps.imGateway as any).adapter.sendMessage(target,
                        `**${title}**\n\n${content}`
                    );
                }
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        }
    );
}
