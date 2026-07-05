import type { FastifyInstance } from 'fastify';
import { auditRepository } from '../../core/audit-repository.js';
import type { GatewayDeps } from '../route-deps.js';

/**
 * 合规审计路由：执行记录、审批记录、定时任务运行历史、审计报表导出、Trace 查询。
 * 从 server.ts 拆分而来（P0-4），逻辑与原实现保持一致，仅将 `this.x` 改为 `deps.x`。
 */
export async function registerAuditRoutes(app: FastifyInstance, _deps: GatewayDeps): Promise<void> {
    app.get<{ Querystring: any }>('/api/audit/executions', async (request) => {
        const q = request.query as any;
        const filter = {
            type: q.type,
            status: q.status,
            triggerSource: q.triggerSource,
            startAfter: q.startAfter,
            startBefore: q.startBefore,
            sessionId: q.sessionId,
            limit: q.limit ? parseInt(q.limit, 10) : 50,
            offset: q.offset ? parseInt(q.offset, 10) : 0,
        };
        const total = auditRepository.countExecutions(filter);
        const items = auditRepository.listExecutions(filter);
        return { total, items };
    });

    app.get<{ Params: { id: string } }>('/api/audit/executions/:id', async (request, reply) => {
        const record = auditRepository.getExecution(request.params.id);
        if (!record) { reply.status(404); return { error: 'Not found' }; }
        return record;
    });

    app.get<{ Querystring: any }>('/api/audit/approvals', async (request) => {
        const q = request.query as any;
        const filter = {
            decision: q.decision,
            sessionId: q.sessionId,
            startAfter: q.startAfter,
            startBefore: q.startBefore,
            limit: q.limit ? parseInt(q.limit, 10) : 50,
            offset: q.offset ? parseInt(q.offset, 10) : 0,
        };
        const total = auditRepository.countApprovals(filter);
        const items = auditRepository.listApprovals(filter);
        return { total, items };
    });

    app.get<{ Querystring: any }>('/api/audit/scheduled-runs', async (request) => {
        const q = request.query as any;
        const filter = {
            scheduledTaskId: q.scheduledTaskId,
            status: q.status,
            startAfter: q.startAfter,
            limit: q.limit ? parseInt(q.limit, 10) : 50,
            offset: q.offset ? parseInt(q.offset, 10) : 0,
        };
        const items = auditRepository.listScheduledRuns(filter);
        return { total: items.length, items };
    });

    app.get<{ Params: { taskId: string }; Querystring: { limit?: string } }>(
        '/api/audit/scheduled-runs/:taskId/history',
        async (request) => {
            const limit = request.query.limit ? parseInt(request.query.limit, 10) : 20;
            const runs = auditRepository.getRunsForTask(request.params.taskId, limit);
            const successCount = runs.filter(r => r.status === 'success').length;
            const durations = runs.filter(r => r.durationMs != null).map(r => r.durationMs!);
            const avgDurationMs = durations.length
                ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
                : 0;
            return {
                runs,
                stats: {
                    successRate: runs.length ? Math.round((successCount / runs.length) * 1000) / 10 : 0,
                    avgDurationMs,
                },
            };
        }
    );

    app.get<{ Querystring: { from: string; to: string; format?: string } }>(
        '/api/audit/report',
        async (request, reply) => {
            const { from, to, format } = request.query as { from: string; to: string; format?: string };
            if (!from || !to) { reply.status(400); return { error: 'from and to are required' }; }
            const report = auditRepository.generateReportData(from, to);
            if (format === 'csv') {
                const csv = auditRepository.exportToCSV(report);
                reply.header('Content-Type', 'text/csv; charset=utf-8');
                reply.header('Content-Disposition', `attachment; filename="audit-report-${from}-${to}.csv"`);
                return reply.send(csv);
            }
            return report;
        }
    );

    // ===== TRACE API — Phase 21 =====
    // GET /api/audit/traces — 分页列出最近 traceId
    app.get<{ Querystring: { sessionId?: string; limit?: string; offset?: string } }>(
        '/api/audit/traces',
        async (request) => {
            const { sessionId, limit, offset } = request.query as Record<string, string | undefined>;
            const { spanRecorder: sr } = await import('../../core/trace.js');
            const items = sr.listTraces({
                sessionId,
                limit: limit ? parseInt(limit, 10) : 20,
                offset: offset ? parseInt(offset, 10) : 0,
            });
            return { items };
        }
    );

    // GET /api/audit/traces/:traceId — 获取某次 trace 的所有 spans（用于瀑布图）
    app.get<{ Params: { traceId: string } }>(
        '/api/audit/traces/:traceId',
        async (request, reply) => {
            const { spanRecorder: sr } = await import('../../core/trace.js');
            const spans = sr.getTrace(request.params.traceId);
            if (spans.length === 0) {
                reply.status(404);
                return { error: 'Trace not found' };
            }
            return { traceId: request.params.traceId, spans };
        }
    );
}
