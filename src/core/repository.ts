import { db } from './database.js';
import { Message, Attachment } from '../types.js';
import { nanoid } from 'nanoid';

/**
 * 聊天历史持久化仓库
 */
export class HistoryRepository {
    /**
     * 获取所有会话列表
     */
    getSessions(): any[] {
        return db.prepare(`
            SELECT s.*, 
            (SELECT content FROM messages WHERE session_id = s.id ORDER BY created_at ASC LIMIT 1) as first_msg
            FROM sessions s
            ORDER BY is_pinned DESC, updated_at DESC
        `).all() as any[];
    }

    /**
     * 获取会话的消息（支持分页）
     */
    getMessages(sessionId: string, opts?: { limit?: number; before?: string }): Message[] {
        // If before + limit: get last N rows before that cursor (DESC then reverse)
        if (opts?.before && opts?.limit) {
            const subQuery = `SELECT * FROM messages WHERE session_id = ? AND created_at < (SELECT created_at FROM messages WHERE id = ?) ORDER BY created_at DESC LIMIT ?`;
            const rows = db.prepare(subQuery).all(sessionId, opts.before, opts.limit) as any[];
            rows.reverse();
            return rows.map(row => this.rowToMessage(row));
        }

        let query = `SELECT * FROM messages WHERE session_id = ?`;
        const params: unknown[] = [sessionId];

        if (opts?.before) {
            query += ` AND created_at < (SELECT created_at FROM messages WHERE id = ?)`;
            params.push(opts.before);
        }
        query += ` ORDER BY created_at ASC`;
        if (opts?.limit) {
            query += ` LIMIT ?`;
            params.push(opts.limit);
        }

        const rows = db.prepare(query).all(...(params as import('node:sqlite').SQLInputValue[])) as any[];
        return rows.map(row => this.rowToMessage(row));
    }

    private rowToMessage(row: any): Message {
        const msg: Message = {
            id: row.id, role: row.role,
            content: row.content,
        };

        if (row.content && row.content.trim().startsWith('[')) {
            try {
                msg.content = JSON.parse(row.content);
            } catch (e) {
                // Fallback to string
            }
        }

        if (row.tool_call_id) msg.toolCallId = row.tool_call_id;
        if (row.tool_calls) {
            try {
                msg.toolCalls = JSON.parse(row.tool_calls);
            } catch (e) {
                // Ignore errors
            }
        }

        // 获取附件
        const attachments = this.getAttachments(row.id);
        if (attachments.length > 0) {
            msg.attachments = attachments;
        }

        // 解析 metadata（含 workflow_generated 等 steps 数据）
        if (row.metadata && row.metadata !== '{}') {
            try {
                (msg as any).metadata = JSON.parse(row.metadata);
            } catch {
                // ignore
            }
        }

        return msg;
    }

    /**
     * 内部：仅执行 INSERT，不含幂等检查和事务管理。
     * 由 saveMessage 和 saveConversationTurn 复用。
     */
    private _insertMessage(sessionId: string, message: Message): string {
        const id = nanoid();
        const content = typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content);
        const metadata = (message as any).metadata
            ? JSON.stringify((message as any).metadata)
            : '{}';

        db.prepare(`
            INSERT INTO messages (id, session_id, role, content, tool_call_id, tool_calls, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            sessionId,
            message.role,
            content,
            message.toolCallId || null,
            message.toolCalls ? JSON.stringify(message.toolCalls) : null,
            metadata
        );

        if (message.attachments) {
            for (const att of message.attachments) {
                this.saveAttachment(id, att);
            }
        }

        return id;
    }

    /**
     * 保存单条消息
     */
    saveMessage(sessionId: string, message: Message): string {
        // 确保会话存在并更新活跃时间
        this.ensureSession(sessionId);
        db.prepare('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);

        const content = typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content);

        // 简易幂等性检查：如果上一条消息完全相同且在极短时间内产生，则跳过（防止前端重复触发）
        const lastMsg = db.prepare(`
            SELECT role, content FROM messages
            WHERE session_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        `).get(sessionId) as any;

        if (lastMsg && lastMsg.role === message.role && lastMsg.content === content) {
            // 这里可以增加时间差检查，但对于目前的重复导入问题，角色+内容一致已足够
            return "duplicate";
        }

        return this._insertMessage(sessionId, message);
    }

    /**
     * 在事务中原子保存 user + assistant 一轮对话。
     * 进程崩溃时两条消息要么都在、要么都不在，避免孤立的 user/assistant 消息。
     */
    saveConversationTurn(
        sessionId: string,
        userMsg: Message,
        assistantMsg: Message
    ): { userMsgId: string; assistantMsgId: string } {
        this.ensureSession(sessionId);
        db.exec('BEGIN');
        try {
            db.prepare('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);
            const userMsgId = this._insertMessage(sessionId, userMsg);
            const assistantMsgId = this._insertMessage(sessionId, assistantMsg);
            db.exec('COMMIT');
            return { userMsgId, assistantMsgId };
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    }

    /**
     * 同步整个会话历史 (全替换或增量，这里采用先删后存的策略简化初始实现)
     */
    syncHistory(sessionId: string, history: Message[]) {
        db.exec('BEGIN');
        try {
            this.ensureSession(sessionId);
            // 删除旧消息 (级联删除附件)
            // db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);

            for (const msg of history) {
                this.saveMessage(sessionId, msg);
            }
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }

    private ensureSession(id: string) {
        const exists = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id);
        if (!exists) {
            db.prepare('INSERT INTO sessions (id) VALUES (?)').run(id);
        }
    }

    private saveAttachment(messageId: string, att: Attachment) {
        db.prepare(`
            INSERT INTO attachments (id, message_id, name, type, url, base64)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            att.id || nanoid(),
            messageId,
            att.name || null,
            att.type,
            att.url || null,
            att.base64 || null
        );
    }

    private getAttachments(messageId: string): Attachment[] {
        const rows = db.prepare('SELECT * FROM attachments WHERE message_id = ?').all(messageId) as any[];
        return rows.map(row => ({
            id: row.id,
            name: row.name,
            type: row.type,
            url: row.url,
            base64: row.base64
        }));
    }

    /**
     * 删除会话及其所有关联数据
     */
    deleteSession(sessionId: string): void {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    }

    /**
     * 切换会话置顶状态
     */
    togglePin(sessionId: string, isPinned: boolean): void {
        db.prepare('UPDATE sessions SET is_pinned = ? WHERE id = ?').run(isPinned ? 1 : 0, sessionId);
    }

    /**
     * 更新会话标题
     */
    updateSessionTitle(sessionId: string, title: string): void {
        db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, sessionId);
    }

    /**
     * 保存消息反馈（点赞/点踩）
     */
    saveFeedback(messageId: string, sessionId: string, rating: 'positive' | 'negative'): string {
        const id = nanoid();
        // Upsert: remove existing feedback for this message then insert
        db.prepare('DELETE FROM feedback WHERE message_id = ?').run(messageId);
        db.prepare(`
            INSERT INTO feedback (id, message_id, session_id, rating)
            VALUES (?, ?, ?, ?)
        `).run(id, messageId, sessionId, rating);
        return id;
    }

    /**
     * 获取所有消息总数
     */
    getTotalMessageCount(): number {
        const row = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
        return row.count;
    }

    /**
     * 获取消息的反馈
     */
    getFeedback(messageId: string): { rating: string } | null {
        const row = db.prepare('SELECT rating FROM feedback WHERE message_id = ?').get(messageId) as any;
        return row ? { rating: row.rating } : null;
    }
}

export const historyRepository = new HistoryRepository();
