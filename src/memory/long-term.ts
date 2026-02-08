import { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import type { MemoryAccess, MemoryEntry, Logger } from '../types.js';

export interface LongTermMemoryOptions {
    db: DatabaseSync;
    logger: Logger;
    embeddingFn?: (texts: string[]) => Promise<number[][]>;
}

/**
 * 长期记忆实现
 * SQLite 存储 + 可选向量嵌入 cosine 搜索
 */
export class LongTermMemory implements MemoryAccess {
    private db: DatabaseSync;
    private logger: Logger;
    private embeddingFn?: (texts: string[]) => Promise<number[][]>;

    constructor(options: LongTermMemoryOptions) {
        this.db = options.db;
        this.logger = options.logger;
        this.embeddingFn = options.embeddingFn;
    }

    /**
     * 初始化 memories 表
     */
    initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                key TEXT,
                content TEXT NOT NULL,
                embedding TEXT,
                metadata TEXT DEFAULT '{}',
                session_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
            CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
        `);
        this.logger.info('Long-term memory initialized');
    }

    /**
     * 按 key 查询
     */
    async get(key: string): Promise<unknown> {
        const stmt = this.db.prepare('SELECT content, metadata FROM memories WHERE key = ?');
        const row = stmt.get(key) as { content: string; metadata: string } | undefined;
        if (!row) return undefined;
        try {
            return JSON.parse(row.content);
        } catch {
            return row.content;
        }
    }

    /**
     * Upsert by key, 自动计算 embedding
     */
    async set(key: string, value: unknown): Promise<void> {
        const content = typeof value === 'string' ? value : JSON.stringify(value);
        let embeddingJson: string | null = null;

        if (this.embeddingFn) {
            try {
                const [embedding] = await this.embeddingFn([content]);
                embeddingJson = JSON.stringify(embedding);
            } catch (err) {
                this.logger.warn(`Embedding failed for key "${key}": ${(err as Error).message}`);
            }
        }

        const existing = this.db.prepare('SELECT id FROM memories WHERE key = ?').get(key);
        if (existing) {
            this.db.prepare(
                'UPDATE memories SET content = ?, embedding = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?'
            ).run(content, embeddingJson, key);
        } else {
            this.db.prepare(
                'INSERT INTO memories (id, key, content, embedding) VALUES (?, ?, ?, ?)'
            ).run(nanoid(), key, content, embeddingJson);
        }
    }

    /**
     * 向量 cosine 搜索，无 embedding 降级为 LIKE
     */
    async search(query: string, limit = 5): Promise<MemoryEntry[]> {
        if (this.embeddingFn) {
            try {
                return await this.vectorSearch(query, limit);
            } catch (err) {
                this.logger.warn(`Vector search failed, falling back to LIKE: ${(err as Error).message}`);
            }
        }
        return this.likeSearch(query, limit);
    }

    /**
     * 存储记忆条目
     */
    async remember(content: string, metadata?: Record<string, unknown>, sessionId?: string): Promise<string> {
        const id = nanoid();
        let embeddingJson: string | null = null;

        if (this.embeddingFn) {
            try {
                const [embedding] = await this.embeddingFn([content]);
                embeddingJson = JSON.stringify(embedding);
            } catch (err) {
                this.logger.warn(`Embedding failed for remember: ${(err as Error).message}`);
            }
        }

        this.db.prepare(
            'INSERT INTO memories (id, content, embedding, metadata, session_id) VALUES (?, ?, ?, ?, ?)'
        ).run(id, content, embeddingJson, JSON.stringify(metadata ?? {}), sessionId ?? null);

        this.logger.debug(`Remembered memory: ${id}`);
        return id;
    }

    /**
     * 删除记忆
     */
    async forget(id: string): Promise<boolean> {
        const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
        return result.changes > 0;
    }

    /**
     * 向量搜索 (cosine similarity)
     */
    private async vectorSearch(query: string, limit: number): Promise<MemoryEntry[]> {
        const [queryEmbedding] = await this.embeddingFn!([query]);

        // 获取所有有 embedding 的记忆
        const rows = this.db.prepare(
            'SELECT id, content, embedding, metadata, session_id, created_at FROM memories WHERE embedding IS NOT NULL'
        ).all() as Array<{
            id: string;
            content: string;
            embedding: string;
            metadata: string;
            session_id: string | null;
            created_at: string;
        }>;

        // 计算 cosine similarity 并排序
        const scored = rows.map(row => {
            const embedding = JSON.parse(row.embedding) as number[];
            const similarity = cosineSimilarity(queryEmbedding, embedding);
            return { row, similarity };
        });

        scored.sort((a, b) => b.similarity - a.similarity);

        return scored.slice(0, limit).map(({ row }) => ({
            id: row.id,
            content: row.content,
            metadata: JSON.parse(row.metadata),
            createdAt: new Date(row.created_at),
        }));
    }

    /**
     * LIKE 降级搜索
     */
    private likeSearch(query: string, limit: number): MemoryEntry[] {
        const rows = this.db.prepare(
            'SELECT id, content, metadata, created_at FROM memories WHERE content LIKE ? ORDER BY updated_at DESC LIMIT ?'
        ).all(`%${query}%`, limit) as Array<{
            id: string;
            content: string;
            metadata: string;
            created_at: string;
        }>;

        return rows.map(row => ({
            id: row.id,
            content: row.content,
            metadata: JSON.parse(row.metadata),
            createdAt: new Date(row.created_at),
        }));
    }
}

/**
 * 纯 JS cosine similarity
 */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
}
