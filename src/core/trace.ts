import { nanoid } from 'nanoid';
import { db } from './database.js';
import type { Span as OtelSpan } from '@opentelemetry/api';
import { otelObserver } from '../observability/otel.js';

export interface Span {
    id: string;
    traceId: string;
    parentId?: string;
    name: string;
    agentId?: string;
    sessionId?: string;
    status: 'running' | 'success' | 'failed';
    meta?: Record<string, unknown>;
    result?: string;
    error?: string;
    durationMs?: number;
    startedAt: string;
    endedAt?: string;
}

export interface TraceListItem {
    traceId: string;
    sessionId?: string;
    spanCount: number;
    totalDurationMs?: number;
    startedAt: string;
}

function rowToSpan(row: Record<string, unknown>): Span {
    return {
        id: row['id'] as string,
        traceId: row['trace_id'] as string,
        parentId: (row['parent_id'] as string | null) ?? undefined,
        name: row['name'] as string,
        agentId: (row['agent_id'] as string | null) ?? undefined,
        sessionId: (row['session_id'] as string | null) ?? undefined,
        status: row['status'] as Span['status'],
        meta: row['meta'] ? JSON.parse(row['meta'] as string) : undefined,
        result: (row['result'] as string | null) ?? undefined,
        error: (row['error'] as string | null) ?? undefined,
        durationMs: (row['duration_ms'] as number | null) ?? undefined,
        startedAt: row['started_at'] as string,
        endedAt: (row['ended_at'] as string | null) ?? undefined,
    };
}

/**
 * @deprecated Phase 1: SpanRecorder 内部已代理到 OtelObserver。
 * Phase 2+ 将直接使用 OtelObserver 并移除此类。
 * 外部 API 保持不变以确保向后兼容。
 */
export class SpanRecorder {
    // string spanId → OTel Span 的桥接映射
    private readonly _otelSpans = new Map<string, OtelSpan>();

    startSpan(
        traceId: string,
        parentId: string | undefined,
        name: string,
        meta?: Record<string, unknown>
    ): string {
        const id = nanoid();
        const now = new Date().toISOString();

        // ── 1. SQLite 写入（向后兼容，供 /api/traces 使用）──
        db.prepare(`
            INSERT INTO agent_spans (id, trace_id, parent_id, name, session_id, status, meta, started_at, created_at)
            VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)
        `).run(
            id,
            traceId,
            parentId ?? null,
            name,
            (meta?.sessionId as string) ?? null,
            meta ? JSON.stringify(meta) : null,
            now,
            now
        );

        // ── 2. OTel span（双写到 Langfuse）──
        const parentOtelSpan = parentId ? this._otelSpans.get(parentId) : undefined;
        const otelSpan = otelObserver.startGenericSpan(
            name,
            {
                'legacy.trace_id': traceId,
                'legacy.span_id': id,
                ...(meta?.sessionId ? { 'agent.session_id': meta.sessionId as string } : {}),
            },
            parentOtelSpan,
        );
        this._otelSpans.set(id, otelSpan);

        return id;
    }

    endSpan(spanId: string, result?: string, error?: string): void {
        const now = new Date().toISOString();

        // ── 1. SQLite 更新──
        const row = db.prepare('SELECT started_at FROM agent_spans WHERE id = ?')
            .get(spanId) as { started_at: string } | undefined;
        const durationMs = row ? Date.now() - new Date(row.started_at).getTime() : null;
        const status = error ? 'failed' : 'success';
        db.prepare(`
            UPDATE agent_spans
            SET status = ?, result = ?, error = ?, duration_ms = ?, ended_at = ?
            WHERE id = ?
        `).run(
            status,
            result ? result.slice(0, 300) : null,
            error ? error.slice(0, 300) : null,
            durationMs,
            now,
            spanId
        );

        // ── 2. OTel span 结束 ──
        const otelSpan = this._otelSpans.get(spanId);
        if (otelSpan) {
            otelObserver.endSpan(otelSpan, { result, error });
            this._otelSpans.delete(spanId);
        }
    }

    getTrace(traceId: string): Span[] {
        const rows = db.prepare(
            'SELECT * FROM agent_spans WHERE trace_id = ? ORDER BY started_at'
        ).all(traceId) as Record<string, unknown>[];
        return rows.map(rowToSpan);
    }

    listTraces(opts?: { sessionId?: string; limit?: number; offset?: number }): TraceListItem[] {
        const limit = opts?.limit ?? 20;
        const offset = opts?.offset ?? 0;

        if (opts?.sessionId) {
            const rows = db.prepare(`
                SELECT trace_id, session_id,
                       COUNT(*) AS span_count,
                       SUM(duration_ms) AS total_duration_ms,
                       MIN(started_at) AS started_at
                FROM agent_spans
                WHERE session_id = ?
                GROUP BY trace_id
                ORDER BY started_at DESC
                LIMIT ? OFFSET ?
            `).all(opts.sessionId, limit, offset) as Record<string, unknown>[];
            return rows.map(r => ({
                traceId: r['trace_id'] as string,
                sessionId: (r['session_id'] as string | null) ?? undefined,
                spanCount: r['span_count'] as number,
                totalDurationMs: (r['total_duration_ms'] as number | null) ?? undefined,
                startedAt: r['started_at'] as string,
            }));
        } else {
            const rows = db.prepare(`
                SELECT trace_id, session_id,
                       COUNT(*) AS span_count,
                       SUM(duration_ms) AS total_duration_ms,
                       MIN(started_at) AS started_at
                FROM agent_spans
                GROUP BY trace_id
                ORDER BY started_at DESC
                LIMIT ? OFFSET ?
            `).all(limit, offset) as Record<string, unknown>[];
            return rows.map(r => ({
                traceId: r['trace_id'] as string,
                sessionId: (r['session_id'] as string | null) ?? undefined,
                spanCount: r['span_count'] as number,
                totalDurationMs: (r['total_duration_ms'] as number | null) ?? undefined,
                startedAt: r['started_at'] as string,
            }));
        }
    }
}

export const spanRecorder = new SpanRecorder();
