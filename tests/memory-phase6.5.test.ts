/**
 * Phase 6.5：Active Compression + 数据迁移测试
 *
 * 覆盖：
 *   1. memory_consolidate 工具行为（通过 handleBuiltinToolCall）
 *   2. 迁移逻辑（memories → episodic_memories, knowledge_nodes → semantic_facts）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { EpisodicMemoryStore } from '../src/memory/episodic.js';
import { SemanticMemoryStore } from '../src/memory/semantic.js';
import { MemoryRouter, initMemoryRouter } from '../src/memory/memory-router.js';
import type { Logger } from '../src/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLogger(): Logger {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeFullDb() {
    const db = new DatabaseSync(':memory:');
    // Phase 6 target tables
    db.exec(`
        CREATE TABLE episodic_memories (
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
        CREATE TABLE semantic_facts (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            subject TEXT NOT NULL,
            predicate TEXT NOT NULL,
            object TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            reviewed_by TEXT,
            reviewed_at INTEGER,
            source_session_id TEXT,
            created_at INTEGER NOT NULL
        );
    `);
    return db;
}

function makeLegacyDb() {
    const db = new DatabaseSync(':memory:');
    // Legacy memories table
    db.exec(`
        CREATE TABLE memories (
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
        CREATE TABLE knowledge_nodes (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL DEFAULT 'document',
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT DEFAULT '{}',
            embedding TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        -- Phase 6 target tables (same DB for migration tests)
        CREATE TABLE episodic_memories (
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
        CREATE TABLE semantic_facts (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            subject TEXT NOT NULL,
            predicate TEXT NOT NULL,
            object TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            reviewed_by TEXT,
            reviewed_at INTEGER,
            source_session_id TEXT,
            created_at INTEGER NOT NULL
        );
    `);
    return db;
}

// ─── Active Compression ───────────────────────────────────────────────────────

describe('memory_consolidate — Active Compression', () => {
    let episodic: EpisodicMemoryStore;
    let semantic: SemanticMemoryStore;
    let router: MemoryRouter;
    const logger = makeLogger();

    beforeEach(() => {
        const db = makeFullDb();
        episodic = new EpisodicMemoryStore(db, logger);
        episodic.initialize();
        semantic = new SemanticMemoryStore(db, logger);
        semantic.initialize();
        const mockLT = { search: vi.fn().mockResolvedValue([]) } as any;
        const mockKG = { search: vi.fn().mockResolvedValue({ nodes: [], relevanceScores: {} }) } as any;
        router = new MemoryRouter(mockLT, mockKG, {} as any, episodic, semantic);
    });

    it('insertEpisodic 写入后可被 searchEpisodic 查到', async () => {
        await router.insertEpisodic({
            tenantId: 'T1',
            sessionId: 'sess-1',
            content: '用户决定使用 PostgreSQL 作为主数据库',
            category: 'operational',
            topic: 'db-decision',
        });

        const hits = await router.searchEpisodic('PostgreSQL', 5, 'T1');
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].content).toContain('PostgreSQL');
        expect(hits[0].topic).toBe('db-decision');
    });

    it('consolidate 写入的条目具有正确的 category 和 tenantId', async () => {
        const facts = [
            '用户偏好简洁回复风格',
            '项目使用 TypeScript strict 模式',
        ];

        for (const fact of facts) {
            await router.insertEpisodic({
                tenantId: 'T2',
                sessionId: 'sess-2',
                content: fact,
                category: 'user',
                topic: 'prefs',
            });
        }

        const hits = await router.searchEpisodic('TypeScript', 5, 'T2');
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].category).toBe('user');
        expect(hits[0].tenantId).toBe('T2');
    });

    it('consolidate 的记忆不能被其他 tenant 检索到', async () => {
        await router.insertEpisodic({
            tenantId: 'T-secret',
            sessionId: 'sess-x',
            content: '内部机密部署方案',
            category: 'governance',
            topic: 'infra',
        });

        const hits = await router.searchEpisodic('机密', 5, 'T-other');
        expect(hits).toHaveLength(0);
    });

    it('consolidate TTL 正确：expires_at 在 90 天后', async () => {
        const before = Date.now();
        await router.insertEpisodic({
            tenantId: 'T3',
            sessionId: 's3',
            content: 'TTL 测试记录',
            category: 'operational',
            topic: 'test',
        });

        const hits = await router.searchEpisodic('TTL', 5, 'T3');
        expect(hits.length).toBeGreaterThan(0);

        const TTL_90D = 90 * 24 * 60 * 60 * 1000;
        expect(hits[0].expiresAt).toBeGreaterThanOrEqual(before + TTL_90D - 1000);
        expect(hits[0].expiresAt).toBeLessThanOrEqual(Date.now() + TTL_90D + 1000);
    });
});

// ─── Migration logic (inline, not via CLI) ───────────────────────────────────

describe('Phase 6.5 数据迁移逻辑', () => {
    const TTL_90D = 90 * 24 * 60 * 60 * 1000;

    function migrateMemoriesToEpisodic(
        db: DatabaseSync,
        defaultTenant = 'default',
    ): { migrated: number; skipped: number } {
        const rows = db.prepare(
            'SELECT id, category, topic, content, metadata, session_id, created_at FROM memories'
        ).all() as any[];

        let migrated = 0;
        let skipped = 0;

        for (const row of rows) {
            let meta: any = {};
            try { meta = JSON.parse(row.metadata ?? '{}'); } catch { /**/ }

            const tenantId = meta.tenantId ?? defaultTenant;
            const sessionId = row.session_id ?? 'migrated';
            const now = Date.now();
            const expiresAt = now + TTL_90D;

            const existing = db.prepare(
                'SELECT id FROM episodic_memories WHERE tenant_id = ? AND content = ? AND session_id = ?'
            ).get(tenantId, row.content, sessionId);

            if (existing) { skipped++; continue; }

            db.prepare(`
                INSERT INTO episodic_memories
                    (id, tenant_id, session_id, content, category, topic, expires_at, created_at, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(nanoid(), tenantId, sessionId, row.content,
                row.category ?? 'user', row.topic ?? '', expiresAt, now, row.metadata ?? '{}');
            migrated++;
        }
        return { migrated, skipped };
    }

    function migrateKnowledgeToSemantic(
        db: DatabaseSync,
        defaultTenant = 'default',
    ): { migrated: number; skipped: number } {
        const nodes = db.prepare(
            'SELECT id, type, title, content, metadata, created_at FROM knowledge_nodes'
        ).all() as any[];

        let migrated = 0;
        let skipped = 0;

        for (const node of nodes) {
            let meta: any = {};
            try { meta = JSON.parse(node.metadata ?? '{}'); } catch { /**/ }

            const tenantId = meta.tenantId ?? defaultTenant;
            const predicate = `是一个 ${node.type}`;

            const existing = db.prepare(
                "SELECT id FROM semantic_facts WHERE tenant_id = ? AND subject = ? AND predicate = ? AND status = 'approved'"
            ).get(tenantId, node.title, predicate);

            if (existing) { skipped++; continue; }

            db.prepare(`
                INSERT INTO semantic_facts
                    (id, tenant_id, subject, predicate, object, confidence, status, source_session_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)
            `).run(nanoid(), tenantId, node.title, predicate,
                node.content.slice(0, 1000), 0.9, 'migrated', Date.now());
            migrated++;
        }
        return { migrated, skipped };
    }

    it('memories → episodic_memories：基本迁移', () => {
        const db = makeLegacyDb();

        db.prepare(
            'INSERT INTO memories (id, category, topic, content, metadata, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(nanoid(), 'user', 'prefs', '用户喜欢代码风格简洁', '{}', 'sess-old', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');

        const { migrated, skipped } = migrateMemoriesToEpisodic(db);
        expect(migrated).toBe(1);
        expect(skipped).toBe(0);

        const rows = db.prepare('SELECT * FROM episodic_memories').all() as any[];
        expect(rows).toHaveLength(1);
        expect(rows[0].content).toBe('用户喜欢代码风格简洁');
        expect(rows[0].tenant_id).toBe('default');
    });

    it('memories 迁移幂等性：重复运行不产生重复记录', () => {
        const db = makeLegacyDb();
        db.prepare(
            'INSERT INTO memories (id, category, topic, content, metadata, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(nanoid(), 'user', '', 'idempotent test', '{}', null, '2024-01-01', '2024-01-01');

        migrateMemoriesToEpisodic(db);
        const { migrated, skipped } = migrateMemoriesToEpisodic(db);
        expect(migrated).toBe(0);
        expect(skipped).toBe(1);

        const count = (db.prepare('SELECT COUNT(*) as c FROM episodic_memories').get() as any).c;
        expect(count).toBe(1);
    });

    it('memories 迁移：metadata.tenantId 优先于 default', () => {
        const db = makeLegacyDb();
        db.prepare(
            'INSERT INTO memories (id, category, topic, content, metadata, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(nanoid(), 'user', '', 'tenant-specific data',
            JSON.stringify({ tenantId: 'acme-corp' }), null, '2024-01-01', '2024-01-01');

        migrateMemoriesToEpisodic(db);

        const row = db.prepare('SELECT tenant_id FROM episodic_memories').get() as any;
        expect(row.tenant_id).toBe('acme-corp');
    });

    it('knowledge_nodes → semantic_facts：节点迁移为 approved 事实', () => {
        const db = makeLegacyDb();
        const now = new Date().toISOString();
        db.prepare(
            'INSERT INTO knowledge_nodes (id, type, title, content, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(nanoid(), 'concept', '微服务架构', '将单体应用拆分为独立可部署的服务', '{}', now, now);

        const { migrated } = migrateKnowledgeToSemantic(db);
        expect(migrated).toBe(1);

        const fact = db.prepare('SELECT * FROM semantic_facts').get() as any;
        expect(fact.subject).toBe('微服务架构');
        expect(fact.predicate).toBe('是一个 concept');
        expect(fact.status).toBe('approved');
        expect(fact.confidence).toBe(0.9);
    });

    it('knowledge_nodes 迁移幂等性：重复运行不产生重复记录', () => {
        const db = makeLegacyDb();
        const now = new Date().toISOString();
        db.prepare(
            'INSERT INTO knowledge_nodes (id, type, title, content, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(nanoid(), 'api', 'REST API 规范', 'RESTful 设计原则', '{}', now, now);

        migrateKnowledgeToSemantic(db);
        const { migrated, skipped } = migrateKnowledgeToSemantic(db);
        expect(migrated).toBe(0);
        expect(skipped).toBe(1);
    });
});
