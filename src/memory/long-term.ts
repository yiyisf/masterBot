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

function sanitizeFilename(s: string): string {
    return s.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '-').slice(0, 80);
}

/**
 * 长期记忆实现（v2）
 * - 文件为真相来源：data/.memory/{category}/{topic}.md
 * - SQLite FTS5 为加速层（unicode61 分词）
 * - 无 embedding 外部依赖，任何 LLM provider 均可用
 * - 自动维护 data/.memory/MEMORY.md 索引（前 200 行注入每个 session）
 */
export class LongTermMemory implements MemoryAccess {
    private db: DatabaseSync;
    private logger: Logger;
    private dataDir: string;

    constructor(options: LongTermMemoryOptions) {
        this.db = options.db;
        this.logger = options.logger;
        this.dataDir = options.dataDir ?? 'data/.memory';
    }

    /**
     * 初始化：memories 表 + FTS5 虚拟表 + 触发器
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
            CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key);
            CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
            CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);

            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
                id UNINDEXED,
                category UNINDEXED,
                topic UNINDEXED,
                content,
                tokenize='unicode61 remove_diacritics 2'
            );
        `);

        // 确保文件目录存在
        for (const cat of VALID_CATEGORIES) {
            const dir = join(this.dataDir, cat);
            if (!existsSync(dir)) {
                try { mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
            }
        }

        this.logger.info('[memory] Long-term memory v2 initialized (FTS5, no embedding)');
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
     * Upsert by key（兼容旧接口，不再计算 embedding）
     */
    async set(key: string, value: unknown): Promise<void> {
        const content = typeof value === 'string' ? value : JSON.stringify(value);
        const existing = this.db.prepare('SELECT id FROM memories WHERE key = ?').get(key) as { id: string } | undefined;

        if (existing) {
            this.db.prepare(
                'UPDATE memories SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?'
            ).run(content, key);
            this.db.prepare(
                'UPDATE memory_fts SET content = ? WHERE id = ?'
            ).run(content, existing.id);
        } else {
            const id = nanoid();
            this.db.prepare(
                'INSERT INTO memories (id, key, content) VALUES (?, ?, ?)'
            ).run(id, key, content);
            this.db.prepare(
                'INSERT INTO memory_fts (id, category, topic, content) VALUES (?, ?, ?, ?)'
            ).run(id, 'user', key ?? '', content);
        }
    }

    /**
     * 存储记忆条目
     * - 写文件：data/.memory/{category}/{topic}.md
     * - 写 FTS5：供 search() 快速检索
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

        // 写 SQLite
        this.db.prepare(
            'INSERT INTO memories (id, category, topic, content, metadata, session_id) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, validCategory, topic, content, JSON.stringify(metadata ?? {}), sessionId ?? null);

        // 写 FTS5
        this.db.prepare(
            'INSERT INTO memory_fts (id, category, topic, content) VALUES (?, ?, ?, ?)'
        ).run(id, validCategory, topic, content);

        // 写文件（异步，不阻塞）
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
        if (result.changes > 0) {
            this.db.prepare('DELETE FROM memory_fts WHERE id = ?').run(id);
        }
        return result.changes > 0;
    }

    /**
     * FTS5 搜索 + LIKE 降级
     */
    async search(query: string, limit = 5): Promise<MemoryEntry[]> {
        // 先尝试 FTS5 全文检索
        try {
            const ftsResults = this._ftsSearch(query, limit);
            if (ftsResults.length > 0) return ftsResults;
        } catch (err) {
            this.logger.warn(`[memory] FTS5 search failed, falling back to LIKE: ${(err as Error).message}`);
        }
        return this._likeSearch(query, limit);
    }

    /**
     * 从 MEMORY.md 中加载前 N 行作为 session 上下文
     * 用于在每个对话 session 开始时注入到 system prompt
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

                // 同步到 FTS5（如果还没有）
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

    private _ftsSearch(query: string, limit: number): MemoryEntry[] {
        // FTS5 match 语法：转义特殊字符
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

        // 更新 MEMORY.md 索引
        await this._updateMemoryIndex(safeCategory, safeTopic, content);
    }

    private async _updateMemoryIndex(category: string, topic: string, content: string): Promise<void> {
        const indexPath = join(this.dataDir, 'MEMORY.md');
        const relPath = `./${category}/${sanitizeFilename(topic)}.md`;

        // 取内容首行作为摘要
        const summary = content.split('\n')[0].slice(0, 100);
        const entry = `- [${topic}](${relPath}) — ${summary}`;

        let existing = '';
        if (existsSync(indexPath)) {
            try { existing = await readFile(indexPath, 'utf-8'); } catch { /* ok */ }
        }

        // 如果已有相同路径的条目就替换，否则追加
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
