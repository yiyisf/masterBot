/**
 * Phase 6: L2 Episodic Memory
 * SQLite FTS5 存储，强制 tenant_id 隔离，90 天 TTL。
 */

import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import type { Logger } from '../types.js';
import type { EpisodicMemory } from './types.js';

const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export class EpisodicMemoryStore {
    constructor(
        private db: DatabaseSync,
        private logger: Logger,
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
    }

    async search(query: string, k: number, tenantId: string): Promise<EpisodicMemory[]> {
        const now = Date.now();

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

        // LIKE fallback: FTS unavailable or returned 0 (e.g., CJK tokenizer miss)
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

    /** 删除过期记忆（cron 调用） */
    purgeExpired(): number {
        const now = Date.now();
        // Also remove from FTS
        try {
            const expiredIds = this.db.prepare(
                'SELECT id FROM episodic_memories WHERE expires_at <= ?'
            ).all(now) as Array<{ id: string }>;
            for (const { id } of expiredIds) {
                this.db.prepare('DELETE FROM episodic_fts WHERE id = ?').run(id);
            }
        } catch { /* FTS unavailable */ }

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
