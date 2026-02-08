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
 * 管理多个会话的记忆，支持 LRU 淘汰
 */
export class SessionMemoryManager {
    private sessions: Map<string, ShortTermMemory> = new Map();
    private accessOrder: Map<string, number> = new Map(); // sessionId → last access timestamp
    private maxSessions: number;
    private maxMessages: number;
    private logger: Logger;
    private cleanupTimer?: ReturnType<typeof setInterval>;

    constructor(options: { maxMessages: number; maxSessions?: number; logger: Logger }) {
        this.maxMessages = options.maxMessages;
        this.maxSessions = options.maxSessions ?? 100;
        this.logger = options.logger;

        // Periodic cleanup every 5 minutes
        this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
        // Prevent timer from keeping the process alive
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }

    /**
     * 获取或创建会话记忆
     */
    getSession(sessionId: string): ShortTermMemory {
        this.accessOrder.set(sessionId, Date.now());

        if (!this.sessions.has(sessionId)) {
            // Evict LRU sessions if over limit
            if (this.sessions.size >= this.maxSessions) {
                this.evictLRU();
            }
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
        const mem = this.sessions.get(sessionId);
        if (mem) mem.clear();
        this.sessions.delete(sessionId);
        this.accessOrder.delete(sessionId);
        this.logger.debug(`Deleted session memory: ${sessionId}`);
    }

    /**
     * 淘汰最久未访问的会话
     */
    private evictLRU(): void {
        const toEvict = Math.max(1, Math.floor(this.maxSessions * 0.1)); // Evict 10%
        const sorted = [...this.accessOrder.entries()].sort((a, b) => a[1] - b[1]);

        for (let i = 0; i < toEvict && i < sorted.length; i++) {
            const sessionId = sorted[i][0];
            this.deleteSession(sessionId);
            this.logger.info(`Evicted LRU session memory: ${sessionId}`);
        }
    }

    /**
     * 清理过期条目和超限会话
     */
    cleanup(): void {
        if (this.sessions.size > this.maxSessions) {
            this.evictLRU();
        }
        this.logger.debug(`Memory cleanup: ${this.sessions.size} active sessions`);
    }

    /**
     * 销毁管理器，清理定时器
     */
    destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        for (const mem of this.sessions.values()) {
            mem.clear();
        }
        this.sessions.clear();
        this.accessOrder.clear();
    }
}
