import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { LLMAdapter, Logger } from '../types.js';
import { AdminRepository, type SkillReviewStatus, type RbacEffect } from '../core/admin-repository.js';
import { CanaryService } from '../eval/canary.js';
import { createAdminHook } from './auth.js';
import { LocalSkillFactory } from '../skill-factory/client.js';
import { EnterpriseSkillFactory } from '../skill-factory/server.js';

function getAdminId(request: any): string {
    return (request.headers['x-admin-key'] as string).slice(0, 8) + '...';
}

export function registerAdminRoutes(
    app: FastifyInstance,
    db: Database.Database,
    adminApiKeys: string[],
    logger: Logger,
    llm?: LLMAdapter,
): void {
    const repo = new AdminRepository(db);
    const canary = new CanaryService(db, logger);
    const adminHook = createAdminHook(adminApiKeys, logger);
    const localFactory = llm ? new LocalSkillFactory(llm, logger, db) : null;
    const enterpriseFactory = llm ? new EnterpriseSkillFactory(llm, logger, db) : null;

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

        // ─── Canary Flags (Phase 9) ──────────────────────────────────────────────

        admin.get('/api/admin/canary', async () => {
            return canary.listFlags();
        });

        admin.post<{
            Body: {
                flagName: string;
                stages?: number[];
                observeHours?: number;
                errorRateThreshold?: number;
            };
        }>('/api/admin/canary', async (request, reply) => {
            const { flagName, stages, observeHours, errorRateThreshold } = request.body;
            if (!flagName || typeof flagName !== 'string') {
                reply.status(400); return { error: 'flagName is required' };
            }
            const flag = canary.createFlag(flagName, {
                stages,
                observe_hours: observeHours,
                error_rate_threshold: errorRateThreshold,
            });
            const adminId = getAdminId(request);
            repo.logAdminAction(adminId, 'canary_create', flagName);
            return flag;
        });

        admin.post<{ Params: { name: string } }>('/api/admin/canary/:name/promote', async (request, reply) => {
            const { name } = request.params;
            const flag = canary.promoteStage(name);
            if (!flag) { reply.status(404); return { error: 'flag not found' }; }
            const adminId = getAdminId(request);
            repo.logAdminAction(adminId, 'canary_promote', name);
            return flag;
        });

        admin.post<{ Params: { name: string } }>('/api/admin/canary/:name/rollback', async (request, reply) => {
            const { name } = request.params;
            const flag = canary.rollbackStage(name);
            if (!flag) { reply.status(404); return { error: 'flag not found' }; }
            const adminId = getAdminId(request);
            repo.logAdminAction(adminId, 'canary_rollback', name);
            return flag;
        });

        admin.get<{ Params: { name: string } }>('/api/admin/canary/:name/metrics', async (request, reply) => {
            const { name } = request.params;
            const flag = canary.getFlag(name);
            if (!flag) { reply.status(404); return { error: 'flag not found' }; }
            return canary.getMetrics(name);
        });

        // ─── Skill Factory 2.0 (Phase 9.5) ──────────────────────────────────────

        function requireFactory(reply: any): LocalSkillFactory | null {
            if (!localFactory) {
                reply.status(503);
                reply.send({ error: 'Skill Factory not available: LLM not configured' });
                return null;
            }
            return localFactory;
        }

        admin.post<{ Body: { intent: string; createdBy?: string } }>(
            '/api/admin/skill-factory/jobs',
            async (request, reply) => {
                const factory = requireFactory(reply);
                if (!factory) return;
                const { intent, createdBy } = request.body;
                if (!intent) { reply.status(400); return { error: 'intent is required' }; }
                const adminId = getAdminId(request);
                const job = await factory.createJob(intent, createdBy ?? adminId);
                return job;
            }
        );

        admin.get<{ Querystring: { createdBy?: string } }>(
            '/api/admin/skill-factory/jobs',
            async (request) => {
                const factory = localFactory;
                if (!factory) return [];
                const { createdBy } = request.query as { createdBy?: string };
                return factory.listJobs(createdBy);
            }
        );

        admin.get<{ Params: { id: string } }>(
            '/api/admin/skill-factory/jobs/:id',
            async (request, reply) => {
                const factory = requireFactory(reply);
                if (!factory) return;
                const job = factory.getJob(request.params.id);
                if (!job) { reply.status(404); return { error: 'job not found' }; }
                return job;
            }
        );

        admin.post<{ Params: { id: string }; Body: { stages?: string[] } }>(
            '/api/admin/skill-factory/jobs/:id/run',
            async (request, reply) => {
                const factory = requireFactory(reply);
                if (!factory) return;
                const { id } = request.params;
                const stages = (request.body?.stages ?? ['all']);
                const runAll = stages.includes('all');

                const results: Record<string, unknown> = {};
                try {
                    if (runAll || stages.includes('1')) {
                        results.spec = await factory.runStage1(id);
                    }
                    if (runAll || stages.includes('2')) {
                        results.files = await factory.runStage2(id);
                    }
                    if (runAll || stages.includes('3')) {
                        results.validation = await factory.runStage3(id);
                    }
                    if (runAll || stages.includes('4')) {
                        results.evaluation = await factory.runStage4(id);
                    }
                } catch (err: any) {
                    reply.status(500);
                    return { error: err.message, partial: results };
                }
                return { ok: true, results };
            }
        );

        admin.post<{ Params: { id: string } }>(
            '/api/admin/skill-factory/jobs/:id/install',
            async (request, reply) => {
                const factory = requireFactory(reply);
                if (!factory) return;
                try {
                    const path = await factory.installAsDraft(request.params.id);
                    return { ok: true, path };
                } catch (err: any) {
                    reply.status(400); return { error: err.message };
                }
            }
        );

        admin.post<{ Params: { id: string } }>(
            '/api/admin/skill-factory/jobs/:id/submit',
            async (request, reply) => {
                const factory = requireFactory(reply);
                if (!factory) return;
                try {
                    const reviewId = await factory.submitForReview(request.params.id);
                    const adminId = getAdminId(request);
                    repo.logAdminAction(adminId, 'skill_factory_submit', request.params.id);
                    return { ok: true, reviewId };
                } catch (err: any) {
                    reply.status(400); return { error: err.message };
                }
            }
        );

        admin.post<{ Params: { id: string }; Body: { notes?: string } }>(
            '/api/admin/skill-factory/reviews/:id/approve',
            async (request, reply) => {
                if (!enterpriseFactory) { reply.status(503); return { error: 'Enterprise factory not available' }; }
                try {
                    const adminId = getAdminId(request);
                    await enterpriseFactory.approveAndPublish(request.params.id, request.body?.notes);
                    repo.logAdminAction(adminId, 'skill_factory_approve', request.params.id);
                    return { ok: true };
                } catch (err: any) {
                    reply.status(400); return { error: err.message };
                }
            }
        );

        admin.post<{ Params: { id: string }; Body: { reason: string } }>(
            '/api/admin/skill-factory/reviews/:id/reject',
            async (request, reply) => {
                if (!enterpriseFactory) { reply.status(503); return { error: 'Enterprise factory not available' }; }
                const { reason } = request.body;
                if (!reason) { reply.status(400); return { error: 'reason is required' }; }
                try {
                    const adminId = getAdminId(request);
                    await enterpriseFactory.reject(request.params.id, reason);
                    repo.logAdminAction(adminId, 'skill_factory_reject', request.params.id, reason);
                    return { ok: true };
                } catch (err: any) {
                    reply.status(400); return { error: err.message };
                }
            }
        );

        admin.get<{ Querystring: { state?: string; curation?: string } }>(
            '/api/admin/skill-catalog',
            async (request) => {
                const { state, curation } = request.query as { state?: string; curation?: string };
                let query = 'SELECT * FROM skill_catalog WHERE 1=1';
                const params: string[] = [];
                if (state) { query += ' AND state = ?'; params.push(state); }
                if (curation) { query += ' AND curation_status = ?'; params.push(curation); }
                query += ' ORDER BY updated_at DESC';
                return db.prepare(query).all(...params);
            }
        );
    });
}
