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

    // 使用 Fastify 插件封装，将 adminHook 作用域限制在 /api/admin/* 路由内，
    // 避免全局 onRequest hook + URL 前缀判断的开销与 Promise 泄漏问题。
    app.register(async (admin) => {
        admin.addHook('onRequest', adminHook);

        // ─── Overview ────────────────────────────────────────────────────────────

        admin.get('/api/admin/stats', async () => {
            return repo.getOverviewStats();
        });

        // ─── Skill Reviews ───────────────────────────────────────────────────────
        // 注：skill_reviews 由 Phase 9.5 技能生命周期管理自动写入，此处仅提供审批 API

        admin.get<{ Querystring: { status?: string } }>('/api/admin/skills/review', async (request) => {
            const { status } = request.query as { status?: string };
            return repo.listSkillReviews(status as SkillReviewStatus | undefined);
        });

        admin.post<{
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

        // ─── RBAC Rules ──────────────────────────────────────────────────────────
        // 注：规则当前仅持久化存储，运行时执行层将在 Phase 9 接入 SkillRegistry。

        admin.get('/api/admin/rbac', async () => {
            return repo.listRbacRules();
        });

        admin.post<{
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

        admin.delete<{ Params: { id: string } }>('/api/admin/rbac/:id', async (request, reply) => {
            const { id } = request.params;
            const adminId = getAdminId(request);
            const ok = repo.deleteRbacRule(id);
            if (!ok) { reply.status(404); return { error: 'rule not found' }; }
            repo.logAdminAction(adminId, 'rbac_delete', id);
            return { ok: true };
        });

        // ─── Audit Query ─────────────────────────────────────────────────────────

        admin.get<{
            Querystring: { userId?: string; sessionId?: string; type?: string; status?: string; from?: string; to?: string; limit?: string; offset?: string };
        }>('/api/admin/audit', async (request) => {
            const { userId, sessionId, type, status, from, to, limit = '50', offset = '0' } = request.query as any;
            const lim = Math.min(parseInt(limit, 10), 200);
            const off = parseInt(offset, 10);
            return repo.queryAuditRecords({ userId, sessionId, type, status, from, to, limit: lim, offset: off });
        });

        // ─── Cost Dashboard ──────────────────────────────────────────────────────

        admin.get<{ Querystring: { days?: string } }>('/api/admin/cost', async (request) => {
            const days = Math.min(parseInt((request.query as any).days ?? '30', 10), 90);
            return {
                daily: repo.getCostDaily(days),
                byModel: repo.getCostByModel(days),
                topUsers: repo.getCostTopUsers(days),
            };
        });

        // ─── Admin Audit Log ─────────────────────────────────────────────────────

        admin.get<{ Querystring: { limit?: string } }>('/api/admin/log', async (request) => {
            const limit = Math.min(parseInt((request.query as any).limit ?? '50', 10), 200);
            return repo.listAdminAuditLog(limit);
        });
    });
}
