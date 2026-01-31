import type { MemoryAccess, MemoryEntry, Logger } from '../types.js';

/**
 * 短期记忆实现
 * 基于内存的会话级记忆
 */
export class ShortTermMemory implements MemoryAccess {
    private store: Map<string, { value: unknown; expiresAt?: number }> = new Map();
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    async get(key: string): Promise<unknown> {
        const entry = this.store.get(key);
        if (!entry) return undefined;

        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }

        return entry.value;
    }

    async set(key: string, value: unknown, ttl?: number): Promise<void> {
        this.store.set(key, {
            value,
            expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
        });
    }

    async search(_query: string, _limit?: number): Promise<MemoryEntry[]> {
        // 短期记忆不支持语义搜索
        return [];
    }

    clear(): void {
        this.store.clear();
    }
}

/**
 * 会话记忆管理器
 * 管理多个会话的记忆
 */
export class SessionMemoryManager {
    private sessions: Map<string, ShortTermMemory> = new Map();
    private maxMessages: number;
    private logger: Logger;

    constructor(options: { maxMessages: number; logger: Logger }) {
        this.maxMessages = options.maxMessages;
        this.logger = options.logger;
    }

    /**
     * 获取或创建会话记忆
     */
    getSession(sessionId: string): ShortTermMemory {
        if (!this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, new ShortTermMemory(this.logger));
            this.logger.debug(`Created new session memory: ${sessionId}`);
        }
        return this.sessions.get(sessionId)!;
    }

    /**
   * 获取当前活跃会话数
   */
    getSessionCount(): number {
        return this.sessions.size;
    }

    /**
     * 删除会话
       */
    deleteSession(sessionId: string): void {
        this.sessions.delete(sessionId);
        this.logger.debug(`Deleted session memory: ${sessionId}`);
    }

    /**
     * 清理过期会话
     */
    cleanup(maxAge: number): void {
        // 简单实现：可以扩展为基于最后访问时间清理
        this.logger.debug(`Memory cleanup triggered`);
    }
}


