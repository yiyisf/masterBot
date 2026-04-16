/**
 * SessionEventStore — Meta-Harness Session 持久层
 * Phase 24: Brain/Hands/Session 三者解耦
 * Phase 25: EventSelector 过滤 + WakeContext 重建
 *
 * Session 作为 append-only 事件日志，生命周期独立于 Harness 进程。
 * Harness 崩溃后，任意新实例可通过 wake(sessionId) 从最后事件恢复。
 */

import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import type { SessionEvent, SessionEventType, Message } from '../../types.js';

export type { SessionEvent };

// ─────────────────────────────────────────────────
// EventSelector — 灵活查询接口（Gap 5）
// ─────────────────────────────────────────────────

export interface EventSelector {
    /** 只返回这些类型的事件 */
    types?: SessionEventType[];
    /** 只返回涉及此 toolName 的事件（tool_call / tool_result） */
    toolName?: string;
    /** 起始时间戳（Unix ms，inclusive） */
    fromTimestamp?: number;
    /** 结束时间戳（Unix ms，inclusive） */
    toTimestamp?: number;
    /** 只返回最后 N 条事件 */
    last?: number;
}

// ─────────────────────────────────────────────────
// WakeContext — wake 时重建的运行时上下文（Gap 3）
// ─────────────────────────────────────────────────

export interface PendingToolCall {
    eventId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
}

export interface WakeContext {
    specId: string;
    specName: string;
    originalTask: string;
    userId?: string;
    /** 进程崩溃时尚未收到 tool_result 的 tool_call */
    pendingToolCalls: PendingToolCall[];
    /** 已完成的步骤数（tool_call + tool_result 配对数） */
    completedSteps: number;
    /** 供 Agent 恢复时注入的初始消息历史 */
    resumeHistory: Message[];
}

// ─────────────────────────────────────────────────
// SessionEventStore
// ─────────────────────────────────────────────────

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
        this.stmtGetUnfinished = db.prepare(`
            SELECT DISTINCT session_id FROM session_events
            WHERE type = 'session_start'
              AND session_id NOT IN (
                  SELECT session_id FROM session_events WHERE type = 'session_end'
              )
        `);
    }

    // ─────────────────────────────────────────────────
    // 写入
    // ─────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────
    // 查询
    // ─────────────────────────────────────────────────

    /**
     * 获取 sessionId 全部事件（无过滤，按时间升序）
     */
    getEvents(sessionId: string): SessionEvent[];
    /**
     * 获取 sessionId 事件，应用 EventSelector 过滤（Gap 5）
     */
    getEvents(sessionId: string, selector: EventSelector): SessionEvent[];
    getEvents(sessionId: string, selector?: EventSelector): SessionEvent[] {
        if (!selector) {
            const rows = this.stmtGetBySession.all(sessionId) as Array<{
                id: string; session_id: string; timestamp: number; type: string; payload: string; caused_by: string | null;
            }>;
            return this.parseRows(rows);
        }

        // D2: 动态构建 SQL WHERE 子句，将过滤下推到 SQLite 层
        const conditions: string[] = ['session_id = ?'];
        const params: unknown[] = [sessionId];

        if (selector.types && selector.types.length > 0) {
            const placeholders = selector.types.map(() => '?').join(',');
            conditions.push(`type IN (${placeholders})`);
            params.push(...selector.types);
        }
        if (selector.fromTimestamp !== undefined) {
            conditions.push('timestamp >= ?');
            params.push(selector.fromTimestamp);
        }
        if (selector.toTimestamp !== undefined) {
            conditions.push('timestamp <= ?');
            params.push(selector.toTimestamp);
        }

        const whereClause = conditions.join(' AND ');
        let sql: string;

        if (selector.last !== undefined && selector.last > 0) {
            // 取最后 N 条：先反序取 N 条再正序
            sql = `SELECT * FROM (
                SELECT * FROM session_events WHERE ${whereClause}
                ORDER BY timestamp DESC LIMIT ?
            ) sub ORDER BY timestamp ASC`;
            params.push(selector.last);
        } else {
            sql = `SELECT * FROM session_events WHERE ${whereClause} ORDER BY timestamp ASC`;
        }

        const rows = this.db.prepare(sql).all(...(params as import('node:sqlite').SQLInputValue[])) as Array<{
            id: string; session_id: string; timestamp: number; type: string; payload: string; caused_by: string | null;
        }>;
        let events = this.parseRows(rows);

        // toolName 过滤仍需内存处理（payload 内字段，无法 SQL 索引）
        if (selector.toolName) {
            const tn = selector.toolName;
            events = events.filter(e => {
                const p = e.payload as Record<string, unknown>;
                return p.toolName === tn;
            });
        }

        return events;
    }

    private parseRows(rows: Array<{
        id: string; session_id: string; timestamp: number; type: string; payload: string; caused_by: string | null;
    }>): SessionEvent[] {
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

    // ─────────────────────────────────────────────────
    // Wake 上下文重建（Gap 3 增强）
    // ─────────────────────────────────────────────────

    /**
     * 从事件日志重建 wake 所需的运行时上下文：
     * - 提取 specId / originalTask / userId
     * - 检测悬挂 tool_call（没有对应 tool_result）
     * - 构建供 Agent 恢复用的初始消息历史
     */
    rebuildWakeContext(sessionId: string): WakeContext | null {
        const events = this.getEvents(sessionId);

        const startEvent = events.find(e => e.type === 'session_start');
        if (!startEvent) return null;

        const { specId, specName, task, userId } = startEvent.payload as {
            specId: string;
            specName: string;
            task: string;
            userId?: string;
        };

        // 检测悬挂 tool_call（有 tool_call 但无对应 tool_result）
        const toolCallEvents = events.filter(e => e.type === 'tool_call');
        const toolResultPayloads = events
            .filter(e => e.type === 'tool_result')
            .map(e => (e.payload as { toolName: string }).toolName);

        const pendingToolCalls: PendingToolCall[] = [];
        let completedSteps = 0;

        for (const tc of toolCallEvents) {
            const p = tc.payload as { toolName: string; toolInput?: Record<string, unknown> };
            // 检查是否有对应的 tool_result（按 toolName 匹配，允许多个同名工具按顺序配对）
            const idx = toolResultPayloads.indexOf(p.toolName);
            if (idx >= 0) {
                toolResultPayloads.splice(idx, 1);
                completedSteps++;
            } else {
                pendingToolCalls.push({
                    eventId: tc.id,
                    toolName: p.toolName,
                    toolInput: p.toolInput ?? {},
                });
            }
        }

        // 构建恢复用消息历史
        const resumeHistory = buildResumeHistory(task, completedSteps, pendingToolCalls);

        return {
            specId,
            specName: specName ?? specId,
            originalTask: task,
            userId,
            pendingToolCalls,
            completedSteps,
            resumeHistory,
        };
    }
}

// ─────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────

/**
 * 构建 Agent 恢复时的初始消息历史。
 * 注入 wake 摘要，让 LLM 知道任务已执行到哪一步，
 * 并将悬挂的 tool_call 以 error 形式反馈，由 LLM 自行决策是否重试。
 */
function buildResumeHistory(
    originalTask: string,
    completedSteps: number,
    pendingToolCalls: PendingToolCall[]
): Message[] {
    const history: Message[] = [
        {
            role: 'user',
            content: originalTask,
        },
    ];

    if (completedSteps === 0 && pendingToolCalls.length === 0) {
        // 任务刚开始就崩溃，无需特殊注入
        return history;
    }

    // 注入 wake 摘要（assistant 角色，告知 LLM 已有进展）
    const wakeNote = [
        `[系统恢复] 此任务在上次进程中已完成 ${completedSteps} 个工具调用步骤。`,
        pendingToolCalls.length > 0
            ? `以下工具调用在进程崩溃时尚未收到结果，视为失败：\n${pendingToolCalls
                  .map(p => `  - ${p.toolName}（输入：${JSON.stringify(p.toolInput).slice(0, 200)}）`)
                  .join('\n')}`
            : null,
        '请根据以上信息继续完成任务，必要时重新执行失败的步骤。',
    ]
        .filter(Boolean)
        .join('\n');

    history.push({
        role: 'assistant',
        content: wakeNote,
    });

    // 将悬挂的 tool_call 注入为 tool error 消息，让 LLM 收到完整的 turn
    for (const pending of pendingToolCalls) {
        history.push({
            role: 'tool',
            content: `[wake-recovery] 工具 "${pending.toolName}" 因进程崩溃未能返回结果，视为执行失败。如需继续，请重新调用。`,
            name: pending.toolName,
        });
    }

    return history;
}
