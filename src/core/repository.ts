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
     * 获取会话的所有消息
     */
    getMessages(sessionId: string): Message[] {
        const rows = db.prepare(`
            SELECT * FROM messages 
            WHERE session_id = ? 
            ORDER BY created_at ASC
        `).all(sessionId) as any[];

        return rows.map(row => {
            const msg: Message = {
                id: row.id, role: row.role,
                content: row.content,
            };

            if (row.content && row.content.startsWith('[')) {
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

            return msg;
        });
    }

    /**
     * 保存单条消息
     */
    saveMessage(sessionId: string, message: Message): string {
        const id = nanoid();

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

        db.prepare(`
            INSERT INTO messages (id, session_id, role, content, tool_call_id, tool_calls)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            id,
            sessionId,
            message.role,
            content,
            message.toolCallId || null,
            message.toolCalls ? JSON.stringify(message.toolCalls) : null
        );

        // 如果有附件，一并保存
        if (message.attachments) {
            for (const att of message.attachments) {
                this.saveAttachment(id, att);
            }
        }

        return id;
    }

    /**
     * 同步整个会话历史 (全替换或增量，这里采用先删后存的策略简化初始实现)
     */
    syncHistory(sessionId: string, history: Message[]) {
        const transaction = db.transaction((messages: Message[]) => {
            this.ensureSession(sessionId);
            // 删除旧消息 (级联删除附件)
            // db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);

            for (const msg of messages) {
                this.saveMessage(sessionId, msg);
            }
        });

        transaction(history);
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
}

export const historyRepository = new HistoryRepository();
