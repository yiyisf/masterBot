/**
 * SessionEventStore — Meta-Harness Session 持久层
 * Phase 24: Brain/Hands/Session 三者解耦
 *
 * Session 作为 append-only 事件日志，生命周期独立于 Harness 进程。
 * Harness 崩溃后，任意新实例可通过 wake(sessionId) 从最后事件恢复。
 */

import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import type { SessionEvent, SessionEventType } from '../../types.js';

export type { SessionEvent };

export class SessionEventStore {
    private stmtAppend: ReturnType<DatabaseSync['prepare']>;
    private stmtGetBySession: ReturnType<DatabaseSync['prepare']>;
    private stmtGetUnfinished: ReturnType<DatabaseSync['prepare']>;

    constructor(private db: DatabaseSync) {
        this.stmtAppend = db.prepare(`
            INSERT INTO session_events (id, session_id, timestamp, type, payload, caused_by)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        this.stmtGetBySession = db.prepare(`
            SELECT * FROM session_events WHERE session_id = ? ORDER BY timestamp ASC
        `);
        // 有 session_start 但无 session_end 的 sessionId
        this.stmtGetUnfinished = db.prepare(`
            SELECT DISTINCT session_id FROM session_events
            WHERE type = 'session_start'
              AND session_id NOT IN (
                  SELECT session_id FROM session_events WHERE type = 'session_end'
              )
        `);
    }

    /**
     * 追加一条事件，返回生成的事件 ID
     */
    append(event: Omit<SessionEvent, 'id'>): string {
        const id = nanoid(16);
        this.stmtAppend.run(
            id,
            event.sessionId,
            event.timestamp,
            event.type,
            JSON.stringify(event.payload),
            event.causedBy ?? null
        );
        return id;
    }

    /**
     * 获取某 sessionId 的全部事件（按时间升序）
     */
    getEvents(sessionId: string): SessionEvent[] {
        const rows = this.stmtGetBySession.all(sessionId) as Array<{
            id: string;
            session_id: string;
            timestamp: number;
            type: string;
            payload: string;
            caused_by: string | null;
        }>;
        return rows.map(r => ({
            id: r.id,
            sessionId: r.session_id,
            timestamp: r.timestamp,
            type: r.type as SessionEventType,
            payload: JSON.parse(r.payload),
            causedBy: r.caused_by ?? undefined,
        }));
    }

    /**
     * 返回所有"已开始但未结束"的 sessionId（供启动时 wake 扫描）
     */
    getUnfinished(): string[] {
        const rows = this.stmtGetUnfinished.all() as Array<{ session_id: string }>;
        return rows.map(r => r.session_id);
    }
}
