/**
 * Phase 6: L2 Episodic Memory
 * SQLite FTS5 主存储 + DuckDB VSS 向量搜索（Phase 6.5 新增，可选增强）。
 *
 * 搜索优先级：DuckDB VSS（向量语义） > SQLite FTS5（全文） > LIKE（关键字）
 * 任一层不可用时自动降级，不影响功能。
 */

import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import type { Logger } from '../types.js';
import type { EpisodicMemory } from './types.js';
import type { DuckDBClient } from '../persistence/duckdb-client.js';
import type { Embedder } from './embedder.js';

const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export class EpisodicMemoryStore {
    constructor(
        private db: DatabaseSync,
        private logger: Logger,
        /** Phase 6.5: 可选向量搜索增强 */
        private duckdb?: DuckDBClient,
        private embedder?: Embedder,
    ) {}

    initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS episodic_memories (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                content TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'general',
                topic TEXT NOT NULL DEFAULT '',
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                metadata TEXT DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_episodic_tenant ON episodic_memories(tenant_id);
            CREATE INDEX IF NOT EXISTS idx_episodic_expires ON episodic_memories(expires_at);
        `);

        // FTS5 virtual table for full-text search
        try {
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS episodic_fts
                USING fts5(id UNINDEXED, tenant_id UNINDEXED, content, tokenize='unicode61');
            `);
        } catch {
            this.logger.warn('[episodic] FTS5 not available, falling back to LIKE search');
        }

        this.logger.debug('[episodic] EpisodicMemoryStore initialized');
    }

    async insert(item: Omit<EpisodicMemory, 'id' | 'createdAt' | 'expiresAt'>): Promise<void> {
        const id = nanoid();
        const now = Date.now();
        const expiresAt = now + TTL_MS;

        this.db.prepare(`
            INSERT INTO episodic_memories
                (id, tenant_id, session_id, content, category, topic, expires_at, created_at, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            item.tenantId,
            item.sessionId,
            item.content,
            item.category ?? 'general',
            item.topic ?? '',
            expiresAt,
            now,
            JSON.stringify(item.metadata ?? {}),
        );

        // Sync to FTS
        try {
            this.db.prepare(`INSERT INTO episodic_fts(id, tenant_id, content) VALUES (?, ?, ?)`)
                .run(id, item.tenantId, item.content);
        } catch { /* FTS unavailable */ }

        // Phase 6.5: 同步向量到 DuckDB VSS
        if (this.duckdb?.isReady() && this.embedder) {
            const vec = await this.embedder.embed(item.content);
            if (vec) {
                await this.duckdb.upsertVector(id, item.tenantId, vec);
            }
        }
    }

    async search(query: string, k: number, tenantId: string): Promise<EpisodicMemory[]> {
        const now = Date.now();

        // ── Phase 6.5: DuckDB VSS 向量语义搜索（最高优先级）──────────────────
        if (this.duckdb?.isReady() && this.embedder) {
            const queryVec = await this.embedder.embed(query);
            if (queryVec) {
                const vssHits = await this.duckdb.searchSimilar(queryVec, tenantId, k);
                if (vssHits.length > 0) {
                    const ids = vssHits.map(h => h.id);
                    const placeholders = ids.map(() => '?').join(', ');
                    const rows = this.db.prepare(`
                        SELECT * FROM episodic_memories
                        WHERE id IN (${placeholders})
                          AND expires_at > ?
                    `).all(...(ids as import('node:sqlite').SQLInputValue[]), now) as any[];

                    if (rows.length > 0) {
                        // 按向量相似度分数排序
                        const scoreMap = new Map(vssHits.map(h => [h.id, h.score]));
                        return rows
                            .sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0))
                            .map(r => this.rowToEpisodic(r));
                    }
                }
            }
        }

        // ── SQLite FTS5（全文搜索）──────────────────────────────────────────────
        // Try FTS5 first; fall back to LIKE when FTS is unavailable or returns no results.
        // FTS5 with unicode61 may not tokenize CJK characters, so LIKE fallback improves recall.
        let ftsRows: any[] | null = null;
        try {
            ftsRows = this.db.prepare(`
                SELECT e.*
                FROM episodic_memories e
                WHERE e.id IN (
                    SELECT id FROM episodic_fts
                    WHERE episodic_fts MATCH ?
                      AND tenant_id = ?
                )
                AND e.expires_at > ?
                ORDER BY e.created_at DESC
                LIMIT ?
            `).all(query, tenantId, now, k) as any[];
        } catch {
            // FTS5 unavailable — proceed to LIKE
        }

        if (ftsRows && ftsRows.length > 0) {
            return ftsRows.map(r => this.rowToEpisodic(r));
        }

        // ── LIKE 关键字匹配（最终降级）────────────────────────────────────────
        const rows = this.db.prepare(`
            SELECT * FROM episodic_memories
            WHERE tenant_id = ?
              AND expires_at > ?
              AND content LIKE ?
            ORDER BY created_at DESC
            LIMIT ?
        `).all(tenantId, now, `%${query}%`, k) as any[];
        return rows.map(r => this.rowToEpisodic(r));
    }

    /** 删除过期记忆（cron 调用），同步清理 FTS 和 DuckDB 向量 */
    purgeExpired(): number {
        const now = Date.now();

        const expiredIds = (this.db.prepare(
            'SELECT id FROM episodic_memories WHERE expires_at <= ?'
        ).all(now) as Array<{ id: string }>).map(r => r.id);

        if (expiredIds.length > 0) {
            // Clean FTS
            try {
                for (const id of expiredIds) {
                    this.db.prepare('DELETE FROM episodic_fts WHERE id = ?').run(id);
                }
            } catch { /* FTS unavailable */ }

            // Phase 6.5: Clean DuckDB vectors
            if (this.duckdb?.isReady()) {
                void this.duckdb.deleteByIds(expiredIds);
            }
        }

        const result = this.db.prepare(
            'DELETE FROM episodic_memories WHERE expires_at <= ?'
        ).run(now);
        return Number(result.changes);
    }

    private rowToEpisodic(r: any): EpisodicMemory {
        return {
            id: r.id,
            tenantId: r.tenant_id,
            sessionId: r.session_id,
            content: r.content,
            category: r.category,
            topic: r.topic,
            expiresAt: r.expires_at,
            createdAt: r.created_at,
            metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
        };
    }
}
