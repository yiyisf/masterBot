/**
 * checkpoint-manager.ts  (T2-4)
 *
 * 对话检查点：将当前会话的消息历史快照保存到 SQLite，
 * 支持随时回退到任意历史节点，不破坏原始消息记录。
 *
 * 表结构由 database.ts 统一创建：
 *   checkpoints (id, session_id, label, message_count, messages_json, created_at)
 */

import { nanoid } from 'nanoid';
import type { DatabaseSync } from 'node:sqlite';
import type { Message, Logger } from '../types.js';

export interface CheckpointInfo {
    id: string;
    sessionId: string;
    label: string;
    messageCount: number;
    createdAt: string;
}

export class CheckpointManager {
    constructor(
        private db: DatabaseSync,
        private logger: Logger,
    ) {}

    initialize(): void {
        // 表结构由 database.ts 统一建立；此处仅做就绪日志
        this.logger.debug('[checkpoint] CheckpointManager initialized');
    }

    /**
     * 保存当前消息历史为新检查点，返回检查点 ID。
     */
    save(sessionId: string, messages: Message[], label?: string): string {
        const id = nanoid();
        const finalLabel = label || `检查点 ${new Date().toLocaleString('zh-CN')}`;
        this.db.prepare(
            'INSERT INTO checkpoints (id, session_id, label, message_count, messages_json) VALUES (?, ?, ?, ?, ?)'
        ).run(id, sessionId, finalLabel, messages.length, JSON.stringify(messages));
        this.logger.info(`[checkpoint] Saved checkpoint "${finalLabel}" for session ${sessionId} (${messages.length} messages)`);
        return id;
    }

    /**
     * 列出会话的所有检查点（最新优先）。
     */
    list(sessionId: string): CheckpointInfo[] {
        const rows = this.db.prepare(
            'SELECT id, session_id, label, message_count, created_at FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC'
        ).all(sessionId) as Array<{
            id: string; session_id: string; label: string;
            message_count: number; created_at: string;
        }>;
        return rows.map(r => ({
            id: r.id,
            sessionId: r.session_id,
            label: r.label,
            messageCount: r.message_count,
            createdAt: r.created_at,
        }));
    }

    /**
     * 恢复检查点，返回保存的消息历史。
     * 同时校验 sessionId 归属，防止跨会话访问。
     * 返回 null 表示检查点不存在或不属于该 session。
     */
    restore(checkpointId: string, sessionId: string): Message[] | null {
        const row = this.db.prepare(
            'SELECT messages_json, session_id FROM checkpoints WHERE id = ? AND session_id = ?'
        ).get(checkpointId, sessionId) as { messages_json: string; session_id: string } | undefined;
        if (!row) return null;
        try {
            const messages = JSON.parse(row.messages_json) as Message[];
            this.logger.info(`[checkpoint] Restored checkpoint ${checkpointId} for session ${row.session_id} (${messages.length} messages)`);
            return messages;
        } catch (err) {
            this.logger.error(`[checkpoint] Failed to parse checkpoint ${checkpointId}: ${(err as Error).message}`);
            return null;
        }
    }

    /**
     * 删除检查点，同时校验 sessionId 归属。
     * 返回是否删除成功（false 表示不存在或不属于该 session）。
     */
    delete(checkpointId: string, sessionId: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM checkpoints WHERE id = ? AND session_id = ?'
        ).run(checkpointId, sessionId);
        return result.changes > 0;
    }
}
