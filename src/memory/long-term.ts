import { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { MemoryAccess, MemoryEntry, Logger } from '../types.js';

export interface LongTermMemoryOptions {
    db: DatabaseSync;
    logger: Logger;
    /** 文件记忆根目录，默认 data/.memory */
    dataDir?: string;
    /**
     * 向量嵌入函数（可选）。
     * 提供后启用混合检索：FTS5 词法召回 + 向量语义召回，结果按分数合并。
     * 不提供则退化为纯 FTS5/LIKE 搜索。
     */
    embedder?: (texts: string[]) => Promise<number[][]>;
}

/**
 * 记忆分类（适配 masterBot 场景）
 */
export type MemoryCategory =
    | 'user'        // 用户偏好与习惯
    | 'operational' // 运维/操作经验
    | 'governance'  // 治理规则、架构决策
    | 'skill'       // Skill 使用经验
    | 'correction'  // 用户纠正过的错误
    | 'reference';  // 外部系统指针

const VALID_CATEGORIES = new Set<string>([
    'user', 'operational', 'governance', 'skill', 'correction', 'reference',
]);

/** 向量搜索内存加载上限，防止超大记忆库时 OOM */
const MAX_VECTOR_ROWS = 10_000;

function sanitizeFilename(s: string): string {
    return s.replace(/[^a-zA-Z0-9一-龥._-]/g, '-').slice(0, 80);
}

/**
 * 长期记忆实现（v3）
 * - 文件为真相来源：data/.memory/{category}/{topic}.md
 * - SQLite FTS5 为词法加速层（unicode61 分词）
 * - 可选向量语义层：embedding TEXT 列 + JS 余弦相似度（零外部依赖）
 * - 混合检索：FTS5 + 向量双路召回，按分数合并去重
 */
export class LongTermMemory implements MemoryAccess {
    private db: DatabaseSync;
    private logger: Logger;
    private dataDir: string;
    private embedder?: (texts: string[]) => Promise<number[][]>;
    /** FTS5 是否可用（部分 Windows/旧 Node 构建中 SQLite 可能未编译 FTS5）*/
    private _ftsAvailable = false;

    constructor(options: LongTermMemoryOptions) {
        this.db = options.db;
        this.logger = options.logger;
        this.dataDir = options.dataDir ?? 'data/.memory';
        this.embedder = options.embedder;
    }

    /**
     * 初始化：memories 表 + 可选 FTS5 虚拟表
     * FTS5 不可用时自动降级为 LIKE 搜索。
     */
    initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                category TEXT NOT NULL DEFAULT 'user',
                topic TEXT NOT NULL DEFAULT '',
                key TEXT,
                content TEXT NOT NULL,
                metadata TEXT DEFAULT '{}',
                session_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 自动迁移：为旧表补充新列
        for (const migration of [
            "ALTER TABLE memories ADD COLUMN category TEXT NOT NULL DEFAULT 'user'",
            "ALTER TABLE memories ADD COLUMN topic TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE memories ADD COLUMN metadata TEXT DEFAULT '{}'",
            'ALTER TABLE memories ADD COLUMN session_id TEXT',
            'ALTER TABLE memories ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP',
            'ALTER TABLE memories ADD COLUMN embedding TEXT',  // U1: 向量嵌入列
        ]) {
            try { this.db.exec(migration); } catch { /* 列已存在，忽略 */ }
        }

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
            CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
            CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
        `);

        try {
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
                    id UNINDEXED,
                    category UNINDEXED,
                    topic UNINDEXED,
                    content,
                    tokenize='unicode61 remove_diacritics 2'
                );
            `);
            this._ftsAvailable = true;
            this.logger.debug('[memory] FTS5 available');
        } catch (err) {
            this._ftsAvailable = false;
            this.logger.warn(`[memory] FTS5 not available, falling back to LIKE search: ${(err as Error).message}`);
        }

        // 确保文件目录存在
        for (const cat of VALID_CATEGORIES) {
            const dir = join(this.dataDir, cat);
            if (!existsSync(dir)) {
                try { mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
            }
        }

        const mode = this.embedder
            ? (this._ftsAvailable ? 'FTS5+Vector hybrid' : 'Vector-only')
            : (this._ftsAvailable ? 'FTS5' : 'LIKE');
        this.logger.info(`[memory] Long-term memory v3 initialized (search: ${mode})`);
    }

    /**
     * 按 key 查询（兼容旧接口）
     */
    async get(key: string): Promise<unknown> {
        const stmt = this.db.prepare('SELECT content, metadata FROM memories WHERE key = ?');
        const row = stmt.get(key) as { content: string; metadata: string } | undefined;
        if (!row) return undefined;
        try { return JSON.parse(row.content); } catch { return row.content; }
    }

    /**
     * Upsert by key（兼容旧接口）
     */
    async set(key: string, value: unknown): Promise<void> {
        const content = typeof value === 'string' ? value : JSON.stringify(value);
        const existing = this.db.prepare('SELECT id FROM memories WHERE key = ?').get(key) as { id: string } | undefined;

        if (existing) {
            this.db.prepare(
                'UPDATE memories SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?'
            ).run(content, key);
            if (this._ftsAvailable) {
                this.db.prepare(
                    'INSERT OR REPLACE INTO memory_fts (id, category, topic, content) VALUES (?, ?, ?, ?)'
                ).run(existing.id, 'user', key ?? '', content);
            }
            this._scheduleEmbedding(existing.id, content);
        } else {
            const id = nanoid();
            this.db.prepare(
                'INSERT INTO memories (id, key, content) VALUES (?, ?, ?)'
            ).run(id, key, content);
            if (this._ftsAvailable) {
                this.db.prepare(
                    'INSERT INTO memory_fts (id, category, topic, content) VALUES (?, ?, ?, ?)'
                ).run(id, 'user', key ?? '', content);
            }
            this._scheduleEmbedding(id, content);
        }
    }

    /**
     * 存储记忆条目
     * - 写文件：data/.memory/{category}/{topic}.md
     * - 写 FTS5：供 search() 快速检索
     * - 异步计算并存储向量嵌入（如 embedder 已配置）
     * - 更新 MEMORY.md 索引
     */
    async remember(
        content: string,
        metadata?: Record<string, unknown>,
        sessionId?: string
    ): Promise<string> {
        const id = nanoid();
        const category = (metadata?.category as MemoryCategory | undefined) ?? 'user';
        const topic = (metadata?.topic as string | undefined) ?? `memory-${id.slice(0, 8)}`;
        const validCategory = VALID_CATEGORIES.has(category) ? category : 'user';

        this.db.prepare(
            'INSERT INTO memories (id, category, topic, content, metadata, session_id) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, validCategory, topic, content, JSON.stringify(metadata ?? {}), sessionId ?? null);

        if (this._ftsAvailable) {
            this.db.prepare(
                'INSERT INTO memory_fts (id, category, topic, content) VALUES (?, ?, ?, ?)'
            ).run(id, validCategory, topic, content);
        }

        // 异步计算向量（不阻塞 remember 调用）
        this._scheduleEmbedding(id, content);

        this._writeMemoryFile(validCategory, topic, content, metadata).catch(err =>
            this.logger.warn(`[memory] Failed to write memory file: ${err.message}`)
        );

        this.logger.debug(`[memory] Remembered: ${validCategory}/${topic} (${id})`);
        return id;
    }

    /**
     * 删除记忆
     */
    async forget(id: string): Promise<boolean> {
        const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
        if (result.changes > 0 && this._ftsAvailable) {
            this.db.prepare('DELETE FROM memory_fts WHERE id = ?').run(id);
        }
        return result.changes > 0;
    }

    /**
     * 混合检索：FTS5 词法召回 + 向量语义召回（如 embedder 已配置），结果按分数合并。
     * 无 embedder 时退化为 FTS5/LIKE 单路搜索（保持原有行为）。
     */
    async search(query: string, limit = 5): Promise<MemoryEntry[]> {
        if (!this.embedder) {
            // 原有路径：FTS5 或 LIKE
            if (!this._ftsAvailable) return this._likeSearch(query, limit);
            try {
                const ftsResults = this._ftsSearch(query, limit);
                if (ftsResults.length > 0) return ftsResults;
            } catch (err) {
                this.logger.warn(`[memory] FTS5 search failed, falling back to LIKE: ${(err as Error).message}`);
            }
            return this._likeSearch(query, limit);
        }

        // 混合路径：FTS5 + 向量双路召回
        const [ftsResults, vectorResults] = await Promise.all([
            this._ftsAvailable
                ? Promise.resolve(this._ftsSearch(query, limit)).catch(() => [] as MemoryEntry[])
                : Promise.resolve(this._likeSearch(query, limit)),
            this._vectorSearch(query, limit),
        ]);

        // 合并：以 id 为 key，取双路最高分
        const merged = new Map<string, MemoryEntry & { score: number }>();

        // FTS5 结果按排名估算分数（rank 0 → 1.0，每级递减 0.1，最低 0.5）
        ftsResults.forEach((entry, idx) => {
            const score = Math.max(0.5, 1.0 - idx * 0.1);
            merged.set(entry.id, { ...entry, score });
        });

        // 向量结果用真实余弦相似度，与已有 FTS5 分数取最大值
        for (const vr of vectorResults) {
            const existing = merged.get(vr.id);
            const vecScore = vr.score ?? 0;
            if (existing) {
                merged.set(vr.id, { ...existing, score: Math.max(existing.score, vecScore) });
            } else {
                merged.set(vr.id, { ...vr, score: vecScore });
            }
        }

        return Array.from(merged.values())
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, limit);
    }

    /**
     * 从 MEMORY.md 中加载前 N 行作为 session 上下文
     */
    async loadMemoryIndex(maxLines = 200): Promise<string | null> {
        const indexPath = join(this.dataDir, 'MEMORY.md');
        if (!existsSync(indexPath)) return null;
        try {
            const content = await readFile(indexPath, 'utf-8');
            const lines = content.split('\n');
            if (lines.length <= maxLines) return content;
            return lines.slice(0, maxLines).join('\n') + '\n\n[... MEMORY.md 已截断，仅显示前 200 行 ...]';
        } catch {
            return null;
        }
    }

    /**
     * 将现有 SQLite memories 导出为 .memory/ 目录 Markdown 文件（迁移工具）
     */
    async migrateToFiles(): Promise<{ exported: number; failed: number }> {
        const rows = this.db.prepare(
            'SELECT id, category, topic, content, metadata, created_at FROM memories ORDER BY created_at ASC'
        ).all() as Array<{
            id: string;
            category: string;
            topic: string;
            content: string;
            metadata: string;
            created_at: string;
        }>;

        let exported = 0;
        let failed = 0;

        for (const row of rows) {
            try {
                const meta = JSON.parse(row.metadata ?? '{}');
                meta.migratedAt = new Date().toISOString();
                meta.originalId = row.id;
                await this._writeMemoryFile(row.category || 'user', row.topic || row.id, row.content, meta);

                const existing = this.db.prepare('SELECT id FROM memory_fts WHERE id = ?').get(row.id);
                if (!existing) {
                    this.db.prepare(
                        'INSERT INTO memory_fts (id, category, topic, content) VALUES (?, ?, ?, ?)'
                    ).run(row.id, row.category || 'user', row.topic || '', row.content);
                }

                exported++;
            } catch {
                failed++;
            }
        }

        this.logger.info(`[memory] Migration complete: ${exported} exported, ${failed} failed`);
        return { exported, failed };
    }

    // ─────────────────────────────── private ───────────────────────────────

    /**
     * 余弦相似度（纯 JS，无外部依赖）
     */
    private static _cosine(a: number[], b: number[]): number {
        if (a.length !== b.length || a.length === 0) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    }

    /**
     * 异步计算并持久化向量嵌入（fire-and-forget，不阻塞调用方）
     */
    private _scheduleEmbedding(id: string, content: string): void {
        if (!this.embedder) return;
        this.embedder([content])
            .then(vecs => {
                if (vecs?.[0]) {
                    this.db.prepare('UPDATE memories SET embedding = ? WHERE id = ?')
                        .run(JSON.stringify(vecs[0]), id);
                }
            })
            .catch(err => this.logger.warn(`[memory] Embedding compute failed for ${id}: ${err.message}`));
    }

    /**
     * 向量语义搜索：加载所有已有 embedding 的记忆，计算余弦相似度，返回 top-N。
     * 内存安全限制：最多加载 MAX_VECTOR_ROWS 条记录。
     */
    private async _vectorSearch(query: string, limit: number): Promise<Array<MemoryEntry & { score: number }>> {
        if (!this.embedder) return [];

        try {
            const vecs = await this.embedder([query]);
            const queryVec = vecs?.[0];
            if (!queryVec) return [];

            const rows = this.db.prepare(
                'SELECT id, content, metadata, created_at, embedding FROM memories WHERE embedding IS NOT NULL LIMIT ?'
            ).all(MAX_VECTOR_ROWS) as Array<{
                id: string;
                content: string;
                metadata: string;
                created_at: string;
                embedding: string;
            }>;

            const scored: Array<MemoryEntry & { score: number }> = [];
            for (const row of rows) {
                try {
                    const rowVec: number[] = JSON.parse(row.embedding);
                    const sim = LongTermMemory._cosine(queryVec, rowVec);
                    scored.push({
                        id: row.id,
                        content: row.content,
                        metadata: this._parseMeta(row.metadata),
                        createdAt: new Date(row.created_at),
                        score: sim,
                    });
                } catch {
                    // 跳过解析失败的行
                }
            }

            return scored
                .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                .slice(0, limit);
        } catch (err) {
            this.logger.warn(`[memory] Vector search failed: ${(err as Error).message}`);
            return [];
        }
    }

    private _ftsSearch(query: string, limit: number): MemoryEntry[] {
        const safeQuery = query.replace(/["*]/g, ' ').trim();
        if (!safeQuery) return [];

        const rows = this.db.prepare(`
            SELECT m.id, m.content, m.metadata, m.created_at
            FROM memory_fts f
            JOIN memories m ON m.id = f.id
            WHERE memory_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `).all(safeQuery, limit) as Array<{
            id: string;
            content: string;
            metadata: string;
            created_at: string;
        }>;

        return rows.map(row => ({
            id: row.id,
            content: row.content,
            metadata: this._parseMeta(row.metadata),
            createdAt: new Date(row.created_at),
        }));
    }

    private _likeSearch(query: string, limit: number): MemoryEntry[] {
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
            metadata: this._parseMeta(row.metadata),
            createdAt: new Date(row.created_at),
        }));
    }

    private _parseMeta(raw: string): Record<string, unknown> {
        try { return JSON.parse(raw); } catch { return {}; }
    }

    private async _writeMemoryFile(
        category: string,
        topic: string,
        content: string,
        metadata?: Record<string, unknown>
    ): Promise<void> {
        const safeCategory = VALID_CATEGORIES.has(category) ? category : 'user';
        const safeTopic = sanitizeFilename(topic);
        const filePath = join(this.dataDir, safeCategory, `${safeTopic}.md`);

        const frontmatter = [
            '---',
            `name: ${topic}`,
            `category: ${safeCategory}`,
            `updated: ${new Date().toISOString()}`,
            ...(metadata?.tags ? [`tags: ${JSON.stringify(metadata.tags)}`] : []),
            '---',
            '',
        ].join('\n');

        const fileContent = frontmatter + content + '\n';

        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, fileContent, 'utf-8');

        await this._updateMemoryIndex(safeCategory, safeTopic, content);
    }

    private async _updateMemoryIndex(category: string, topic: string, content: string): Promise<void> {
        const indexPath = join(this.dataDir, 'MEMORY.md');
        const relPath = `./${category}/${sanitizeFilename(topic)}.md`;

        const summary = content.split('\n')[0].slice(0, 100);
        const entry = `- [${topic}](${relPath}) — ${summary}`;

        let existing = '';
        if (existsSync(indexPath)) {
            try { existing = await readFile(indexPath, 'utf-8'); } catch { /* ok */ }
        }

        const lines = existing ? existing.split('\n') : ['# Memory Index', ''];
        const idx = lines.findIndex(l => l.includes(`(${relPath})`));
        if (idx >= 0) {
            lines[idx] = entry;
        } else {
            lines.push(entry);
        }

        await writeFile(indexPath, lines.join('\n'), 'utf-8');
    }
}
