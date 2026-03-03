import { nanoid } from 'nanoid';
import { db } from './database.js';

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
 * 分布式追踪 — Span 记录器
 * 写入 agent_spans SQLite 表
 */
export class SpanRecorder {
    startSpan(
        traceId: string,
        parentId: string | undefined,
        name: string,
        meta?: Record<string, unknown>
    ): string {
        const id = nanoid();
        const now = new Date().toISOString();
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
        return id;
    }

    endSpan(spanId: string, result?: string, error?: string): void {
        const now = new Date().toISOString();
        const span = db.prepare('SELECT started_at FROM agent_spans WHERE id = ?')
            .get(spanId) as { started_at: string } | undefined;
        const durationMs = span ? Date.now() - new Date(span.started_at).getTime() : null;
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
