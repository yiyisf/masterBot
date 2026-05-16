import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import type { Logger } from '../types.js';
import { AdminRepository, type SkillReviewStatus, type RbacEffect } from '../core/admin-repository.js';
import { createAdminHook } from './auth.js';

function getAdminId(request: any): string {
    return (request.headers['x-admin-key'] as string).slice(0, 8) + '...';
}

export function registerAdminRoutes(
    app: FastifyInstance,
    db: DatabaseSync,
    adminApiKeys: string[],
    logger: Logger,
): void {
    const repo = new AdminRepository(db);
    const adminHook = createAdminHook(adminApiKeys, logger);

    // All /api/admin/* routes require X-Admin-Key
    app.addHook('onRequest', async (request, reply) => {
        if (!request.url.startsWith('/api/admin')) return;
        await new Promise<void>((resolve, reject) => {
            adminHook(request, reply, (err?: unknown) => {
                if (err) reject(err); else resolve();
            });
        });
    });

    // ─── Overview ──────────────────────────────────────────────────────────────

    app.get('/api/admin/stats', async () => {
        return repo.getOverviewStats();
    });

    // ─── Skill Reviews ─────────────────────────────────────────────────────────

    app.get<{ Querystring: { status?: string } }>('/api/admin/skills/review', async (request) => {
        const { status } = request.query as { status?: string };
        return repo.listSkillReviews(status as SkillReviewStatus | undefined);
    });

    app.post<{
        Params: { name: string };
        Body: { status: SkillReviewStatus; notes?: string };
    }>('/api/admin/skills/review/:name', async (request, reply) => {
        const { name } = request.params;
        const { status, notes } = request.body;

        if (!['approved', 'rejected'].includes(status)) {
            reply.status(400); return { error: 'status must be approved or rejected' };
        }

        const adminId = getAdminId(request);
        const updated = repo.updateSkillReview(name, status, adminId, notes);
        if (!updated) { reply.status(404); return { error: 'skill not found' }; }

        repo.logAdminAction(adminId, `skill_review_${status}`, name, notes);
        logger.info(`[admin] ${adminId} ${status} skill ${name}`);
        return updated;
    });

    // ─── RBAC Rules ────────────────────────────────────────────────────────────

    app.get('/api/admin/rbac', async () => {
        return repo.listRbacRules();
    });

    app.post<{
        Body: { subject: string; scope: string; effect: RbacEffect };
    }>('/api/admin/rbac', async (request, reply) => {
        const { subject, scope, effect } = request.body;
        if (!subject || !scope || !['allow', 'deny'].includes(effect)) {
            reply.status(400); return { error: 'subject, scope, effect(allow|deny) required' };
        }
        const adminId = getAdminId(request);
        const rule = repo.createRbacRule(subject, scope, effect, adminId);
        repo.logAdminAction(adminId, 'rbac_create', `${subject}:${scope}`, effect);
        return rule;
    });

    app.delete<{ Params: { id: string } }>('/api/admin/rbac/:id', async (request, reply) => {
        const { id } = request.params;
        const adminId = getAdminId(request);
        const ok = repo.deleteRbacRule(id);
        if (!ok) { reply.status(404); return { error: 'rule not found' }; }
        repo.logAdminAction(adminId, 'rbac_delete', id);
        return { ok: true };
    });

    // ─── Audit Query ───────────────────────────────────────────────────────────

    app.get<{
        Querystring: { userId?: string; sessionId?: string; type?: string; status?: string; from?: string; to?: string; limit?: string; offset?: string };
    }>('/api/admin/audit', async (request) => {
        const { userId, sessionId, type, status, from, to, limit = '50', offset = '0' } = request.query as any;
        const lim = Math.min(parseInt(limit, 10), 200);
        const off = parseInt(offset, 10);

        const conditions: string[] = [];
        const params: unknown[] = [];

        if (userId) { conditions.push('user_id = ?'); params.push(userId); }
        if (sessionId) { conditions.push('session_id = ?'); params.push(sessionId); }
        if (type) { conditions.push('type = ?'); params.push(type); }
        if (status) { conditions.push('status = ?'); params.push(status); }
        if (from) { conditions.push('started_at >= ?'); params.push(from); }
        if (to) { conditions.push('started_at <= ?'); params.push(to); }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        try {
            const rows = db.prepare(
                `SELECT * FROM execution_records ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`
            ).all(...(params as import('node:sqlite').SQLInputValue[]), lim, off);

            const total = (db.prepare(
                `SELECT COUNT(*) as c FROM execution_records ${where}`
            ).get(...(params as import('node:sqlite').SQLInputValue[])) as any)?.c ?? 0;

            return { rows, total, limit: lim, offset: off };
        } catch { return { rows: [], total: 0, limit: lim, offset: off }; }
    });

    // ─── Cost Dashboard ────────────────────────────────────────────────────────

    app.get<{ Querystring: { days?: string } }>('/api/admin/cost', async (request) => {
        const days = Math.min(parseInt((request.query as any).days ?? '30', 10), 90);
        return {
            daily: repo.getCostDaily(days),
            byModel: repo.getCostByModel(days),
            topUsers: repo.getCostTopUsers(days),
        };
    });

    // ─── Admin Audit Log ───────────────────────────────────────────────────────

    app.get<{ Querystring: { limit?: string } }>('/api/admin/log', async (request) => {
        const limit = Math.min(parseInt((request.query as any).limit ?? '50', 10), 200);
        return repo.listAdminAuditLog(limit);
    });
}
