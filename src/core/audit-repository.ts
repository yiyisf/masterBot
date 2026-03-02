import { nanoid } from 'nanoid';
import { db } from './database.js';

export type ExecutionType   = 'agent' | 'runbook' | 'scheduled' | 'webhook' | 'workflow' | 'dag';
export type ExecutionStatus = 'running' | 'success' | 'failed' | 'aborted';
export type TriggerSource   = 'user' | 'scheduler' | 'webhook' | 'im' | 'api';
export type ApprovalDecision = 'approved' | 'rejected' | 'timeout' | 'cancelled';

export interface ExecutionRecord {
    id: string;
    type: ExecutionType;
    name: string;
    sessionId?: string;
    triggerSource: TriggerSource;
    triggerRef?: string;
    status: ExecutionStatus;
    inputSummary?: string;
    outputSummary?: string;
    errorMessage?: string;
    durationMs?: number;
    startedAt: string;
    finishedAt?: string;
    createdAt: string;
}

export interface AuditApproval {
    id: string;
    executionId?: string;
    sessionId: string;
    interruptId: string;
    actionName?: string;
    actionParams?: string;
    dangerReason?: string;
    decision: ApprovalDecision;
    operator?: string;
    operatorChannel: string;
    decidedAt: string;
    createdAt: string;
}

export interface ScheduledTaskRun {
    id: string;
    scheduledTaskId: string;
    taskName: string;
    cronExpr: string;
    sessionId?: string;
    triggerType: 'auto' | 'manual';
    status: ExecutionStatus;
    prompt?: string;
    resultSummary?: string;
    errorMessage?: string;
    durationMs?: number;
    startedAt: string;
    finishedAt?: string;
    createdAt: string;
}

export interface ComplianceReport {
    from: string;
    to: string;
    generatedAt: string;
    executions: {
        total: number;
        byStatus: Record<string, number>;
        byType: Record<string, number>;
        byTrigger: Record<string, number>;
        successRate: number;
    };
    approvals: {
        total: number;
        byDecision: Record<string, number>;
        approvalRate: number;
    };
    scheduledRuns: {
        total: number;
        successRate: number;
        avgDurationMs: number;
    };
    topFailures: Array<{ name: string; count: number; lastError?: string }>;
}

function rowToExecution(row: any): ExecutionRecord {
    return {
        id: row.id,
        type: row.type,
        name: row.name,
        sessionId: row.session_id ?? undefined,
        triggerSource: row.trigger_source,
        triggerRef: row.trigger_ref ?? undefined,
        status: row.status,
        inputSummary: row.input_summary ?? undefined,
        outputSummary: row.output_summary ?? undefined,
        errorMessage: row.error_message ?? undefined,
        durationMs: row.duration_ms ?? undefined,
        startedAt: row.started_at,
        finishedAt: row.finished_at ?? undefined,
        createdAt: row.created_at,
    };
}

function rowToApproval(row: any): AuditApproval {
    return {
        id: row.id,
        executionId: row.execution_id ?? undefined,
        sessionId: row.session_id,
        interruptId: row.interrupt_id,
        actionName: row.action_name ?? undefined,
        actionParams: row.action_params ?? undefined,
        dangerReason: row.danger_reason ?? undefined,
        decision: row.decision,
        operator: row.operator ?? undefined,
        operatorChannel: row.operator_channel,
        decidedAt: row.decided_at,
        createdAt: row.created_at,
    };
}

function rowToScheduledRun(row: any): ScheduledTaskRun {
    return {
        id: row.id,
        scheduledTaskId: row.scheduled_task_id,
        taskName: row.task_name,
        cronExpr: row.cron_expr,
        sessionId: row.session_id ?? undefined,
        triggerType: row.trigger_type,
        status: row.status,
        prompt: row.prompt ?? undefined,
        resultSummary: row.result_summary ?? undefined,
        errorMessage: row.error_message ?? undefined,
        durationMs: row.duration_ms ?? undefined,
        startedAt: row.started_at,
        finishedAt: row.finished_at ?? undefined,
        createdAt: row.created_at,
    };
}

export class AuditRepository {
    // ─── Execution Records ────────────────────────────────────────────────────

    createExecution(d: {
        type: ExecutionType;
        name: string;
        sessionId?: string;
        triggerSource: TriggerSource;
        triggerRef?: string;
        inputSummary?: string;
    }): string {
        const id = nanoid();
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO execution_records
              (id, type, name, session_id, trigger_source, trigger_ref, status, input_summary, started_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
        `).run(
            id, d.type, d.name,
            d.sessionId ?? null,
            d.triggerSource,
            d.triggerRef ?? null,
            d.inputSummary ? d.inputSummary.slice(0, 500) : null,
            now, now
        );
        return id;
    }

    updateExecution(id: string, d: {
        status: ExecutionStatus;
        outputSummary?: string;
        errorMessage?: string;
        durationMs?: number;
        finishedAt?: string;
    }): void {
        const finishedAt = d.finishedAt ?? new Date().toISOString();
        db.prepare(`
            UPDATE execution_records
            SET status = ?, output_summary = ?, error_message = ?, duration_ms = ?, finished_at = ?
            WHERE id = ?
        `).run(
            d.status,
            d.outputSummary ? d.outputSummary.slice(0, 500) : null,
            d.errorMessage ?? null,
            d.durationMs ?? null,
            finishedAt,
            id
        );
    }

    listExecutions(f?: {
        type?: string;
        status?: string;
        triggerSource?: string;
        startAfter?: string;
        startBefore?: string;
        sessionId?: string;
        limit?: number;
        offset?: number;
    }): ExecutionRecord[] {
        const { where, params } = this.buildExecFilter(f);
        const limit = f?.limit ?? 50;
        const offset = f?.offset ?? 0;
        const rows = db.prepare(
            `SELECT * FROM execution_records ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`
        ).all(...(params as import('node:sqlite').SQLInputValue[]), limit, offset) as any[];
        return rows.map(rowToExecution);
    }

    countExecutions(f?: Parameters<AuditRepository['listExecutions']>[0]): number {
        const { where, params } = this.buildExecFilter(f);
        const row = db.prepare(`SELECT COUNT(*) as c FROM execution_records ${where}`)
            .get(...(params as import('node:sqlite').SQLInputValue[])) as any;
        return row?.c ?? 0;
    }

    getExecution(id: string): ExecutionRecord | null {
        const row = db.prepare('SELECT * FROM execution_records WHERE id = ?').get(id) as any;
        return row ? rowToExecution(row) : null;
    }

    private buildExecFilter(f?: Parameters<AuditRepository['listExecutions']>[0]): { where: string; params: unknown[] } {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (f?.type)          { conditions.push('type = ?');          params.push(f.type); }
        if (f?.status)        { conditions.push('status = ?');        params.push(f.status); }
        if (f?.triggerSource) { conditions.push('trigger_source = ?'); params.push(f.triggerSource); }
        if (f?.sessionId)     { conditions.push('session_id = ?');    params.push(f.sessionId); }
        if (f?.startAfter)    { conditions.push('started_at >= ?');   params.push(f.startAfter); }
        if (f?.startBefore)   { conditions.push('started_at <= ?');   params.push(f.startBefore); }
        return {
            where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
            params,
        };
    }

    // ─── Audit Approvals ──────────────────────────────────────────────────────

    recordApproval(d: {
        executionId?: string;
        sessionId: string;
        interruptId: string;
        actionName?: string;
        actionParams?: string;
        dangerReason?: string;
        decision: ApprovalDecision;
        operator?: string;
        operatorChannel?: string;
    }): string {
        const id = nanoid();
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO audit_approvals
              (id, execution_id, session_id, interrupt_id, action_name, action_params,
               danger_reason, decision, operator, operator_channel, decided_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            d.executionId ?? null,
            d.sessionId,
            d.interruptId,
            d.actionName ?? null,
            d.actionParams ? d.actionParams.slice(0, 1000) : null,
            d.dangerReason ?? null,
            d.decision,
            d.operator ?? null,
            d.operatorChannel ?? 'web',
            now, now
        );
        return id;
    }

    listApprovals(f?: {
        decision?: string;
        sessionId?: string;
        startAfter?: string;
        startBefore?: string;
        limit?: number;
        offset?: number;
    }): AuditApproval[] {
        const { where, params } = this.buildApprovalFilter(f);
        const limit = f?.limit ?? 50;
        const offset = f?.offset ?? 0;
        const rows = db.prepare(
            `SELECT * FROM audit_approvals ${where} ORDER BY decided_at DESC LIMIT ? OFFSET ?`
        ).all(...(params as import('node:sqlite').SQLInputValue[]), limit, offset) as any[];
        return rows.map(rowToApproval);
    }

    countApprovals(f?: Parameters<AuditRepository['listApprovals']>[0]): number {
        const { where, params } = this.buildApprovalFilter(f);
        const row = db.prepare(`SELECT COUNT(*) as c FROM audit_approvals ${where}`)
            .get(...(params as import('node:sqlite').SQLInputValue[])) as any;
        return row?.c ?? 0;
    }

    private buildApprovalFilter(f?: Parameters<AuditRepository['listApprovals']>[0]): { where: string; params: unknown[] } {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (f?.decision)    { conditions.push('decision = ?');    params.push(f.decision); }
        if (f?.sessionId)   { conditions.push('session_id = ?'); params.push(f.sessionId); }
        if (f?.startAfter)  { conditions.push('decided_at >= ?'); params.push(f.startAfter); }
        if (f?.startBefore) { conditions.push('decided_at <= ?'); params.push(f.startBefore); }
        return {
            where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
            params,
        };
    }

    // ─── Scheduled Task Runs ──────────────────────────────────────────────────

    createScheduledRun(d: {
        scheduledTaskId: string;
        taskName: string;
        cronExpr: string;
        sessionId?: string;
        triggerType?: 'auto' | 'manual';
        prompt?: string;
    }): string {
        const id = nanoid();
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO scheduled_task_runs
              (id, scheduled_task_id, task_name, cron_expr, session_id, trigger_type, status, prompt, started_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
        `).run(
            id, d.scheduledTaskId, d.taskName, d.cronExpr,
            d.sessionId ?? null,
            d.triggerType ?? 'auto',
            d.prompt ?? null,
            now, now
        );
        return id;
    }

    updateScheduledRun(id: string, d: {
        status: ExecutionStatus;
        resultSummary?: string;
        errorMessage?: string;
        durationMs?: number;
        finishedAt?: string;
    }): void {
        const finishedAt = d.finishedAt ?? new Date().toISOString();
        db.prepare(`
            UPDATE scheduled_task_runs
            SET status = ?, result_summary = ?, error_message = ?, duration_ms = ?, finished_at = ?
            WHERE id = ?
        `).run(
            d.status,
            d.resultSummary ? d.resultSummary.slice(0, 500) : null,
            d.errorMessage ?? null,
            d.durationMs ?? null,
            finishedAt,
            id
        );
    }

    listScheduledRuns(f?: {
        scheduledTaskId?: string;
        status?: string;
        startAfter?: string;
        limit?: number;
        offset?: number;
    }): ScheduledTaskRun[] {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (f?.scheduledTaskId) { conditions.push('scheduled_task_id = ?'); params.push(f.scheduledTaskId); }
        if (f?.status)          { conditions.push('status = ?');           params.push(f.status); }
        if (f?.startAfter)      { conditions.push('started_at >= ?');      params.push(f.startAfter); }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = f?.limit ?? 50;
        const offset = f?.offset ?? 0;
        const rows = db.prepare(
            `SELECT * FROM scheduled_task_runs ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`
        ).all(...(params as import('node:sqlite').SQLInputValue[]), limit, offset) as any[];
        return rows.map(rowToScheduledRun);
    }

    getRunsForTask(scheduledTaskId: string, limit = 10): ScheduledTaskRun[] {
        const rows = db.prepare(
            `SELECT * FROM scheduled_task_runs WHERE scheduled_task_id = ? ORDER BY started_at DESC LIMIT ?`
        ).all(scheduledTaskId, limit) as any[];
        return rows.map(rowToScheduledRun);
    }

    // ─── Compliance Report ────────────────────────────────────────────────────

    generateReportData(from: string, to: string): ComplianceReport {
        const execRows = db.prepare(
            `SELECT status, type, trigger_source, error_message, name FROM execution_records
             WHERE started_at >= ? AND started_at <= ?`
        ).all(from, to) as any[];

        const byStatus: Record<string, number> = {};
        const byType: Record<string, number> = {};
        const byTrigger: Record<string, number> = {};
        const failureMap: Record<string, { count: number; lastError?: string }> = {};

        for (const r of execRows) {
            byStatus[r.status] = (byStatus[r.status] || 0) + 1;
            byType[r.type] = (byType[r.type] || 0) + 1;
            byTrigger[r.trigger_source] = (byTrigger[r.trigger_source] || 0) + 1;
            if (r.status === 'failed') {
                if (!failureMap[r.name]) failureMap[r.name] = { count: 0 };
                failureMap[r.name].count++;
                if (r.error_message) failureMap[r.name].lastError = r.error_message;
            }
        }

        const total = execRows.length;
        const successCount = byStatus['success'] || 0;

        const approvalRows = db.prepare(
            `SELECT decision FROM audit_approvals WHERE decided_at >= ? AND decided_at <= ?`
        ).all(from, to) as any[];
        const byDecision: Record<string, number> = {};
        for (const r of approvalRows) byDecision[r.decision] = (byDecision[r.decision] || 0) + 1;

        const schedRows = db.prepare(
            `SELECT status, duration_ms FROM scheduled_task_runs WHERE started_at >= ? AND started_at <= ?`
        ).all(from, to) as any[];
        const schedTotal = schedRows.length;
        const schedSuccess = schedRows.filter((r: any) => r.status === 'success').length;
        const durations = schedRows.filter((r: any) => r.duration_ms != null).map((r: any) => r.duration_ms as number);
        const avgDurationMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

        const topFailures = Object.entries(failureMap)
            .sort(([, a], [, b]) => b.count - a.count)
            .slice(0, 10)
            .map(([name, v]) => ({ name, count: v.count, lastError: v.lastError }));

        return {
            from, to,
            generatedAt: new Date().toISOString(),
            executions: {
                total,
                byStatus,
                byType,
                byTrigger,
                successRate: total ? Math.round((successCount / total) * 1000) / 10 : 0,
            },
            approvals: {
                total: approvalRows.length,
                byDecision,
                approvalRate: approvalRows.length
                    ? Math.round(((byDecision['approved'] || 0) / approvalRows.length) * 1000) / 10
                    : 0,
            },
            scheduledRuns: {
                total: schedTotal,
                successRate: schedTotal ? Math.round((schedSuccess / schedTotal) * 1000) / 10 : 0,
                avgDurationMs,
            },
            topFailures,
        };
    }

    exportToCSV(report: ComplianceReport): string {
        const BOM = '\uFEFF';
        const lines: string[] = [];

        lines.push('CMaster Bot 合规报告');
        lines.push(`生成时间,${report.generatedAt}`);
        lines.push(`统计范围,${report.from} ~ ${report.to}`);
        lines.push('');

        lines.push('=== 执行记录统计 ===');
        lines.push(`总执行次数,${report.executions.total}`);
        lines.push(`成功率,${report.executions.successRate}%`);
        lines.push('');
        lines.push('按状态分布');
        lines.push('状态,次数');
        for (const [k, v] of Object.entries(report.executions.byStatus)) lines.push(`${k},${v}`);
        lines.push('');
        lines.push('按类型分布');
        lines.push('类型,次数');
        for (const [k, v] of Object.entries(report.executions.byType)) lines.push(`${k},${v}`);
        lines.push('');
        lines.push('按触发源分布');
        lines.push('触发源,次数');
        for (const [k, v] of Object.entries(report.executions.byTrigger)) lines.push(`${k},${v}`);
        lines.push('');

        lines.push('=== HitL 审批记录 ===');
        lines.push(`总审批次数,${report.approvals.total}`);
        lines.push(`通过率,${report.approvals.approvalRate}%`);
        lines.push('');
        lines.push('按决策分布');
        lines.push('决策,次数');
        for (const [k, v] of Object.entries(report.approvals.byDecision)) lines.push(`${k},${v}`);
        lines.push('');

        lines.push('=== 定时任务运行统计 ===');
        lines.push(`总运行次数,${report.scheduledRuns.total}`);
        lines.push(`成功率,${report.scheduledRuns.successRate}%`);
        lines.push(`平均耗时(ms),${report.scheduledRuns.avgDurationMs}`);
        lines.push('');

        if (report.topFailures.length) {
            lines.push('=== 失败最多的任务（Top 10）===');
            lines.push('任务名,失败次数,最近错误');
            for (const f of report.topFailures) {
                const err = (f.lastError || '').replace(/,/g, '，').replace(/\n/g, ' ');
                lines.push(`${f.name},${f.count},${err}`);
            }
        }

        return BOM + lines.join('\n');
    }
}

export const auditRepository = new AuditRepository();
