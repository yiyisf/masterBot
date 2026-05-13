/**
 * Phase 6: Memory 四层架构测试
 * 覆盖：EpisodicMemoryStore / SemanticMemoryStore / 租户隔离
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EpisodicMemoryStore } from '../src/memory/episodic.js';
import { SemanticMemoryStore } from '../src/memory/semantic.js';
import { MemoryRouter } from '../src/memory/memory-router.js';
import type { Logger } from '../src/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLogger(): Logger {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDb() {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
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
        CREATE INDEX IF NOT EXISTS idx_ep_tenant ON episodic_memories(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ep_expires ON episodic_memories(expires_at);

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

// ─── EpisodicMemoryStore ──────────────────────────────────────────────────────

describe('EpisodicMemoryStore', () => {
    let store: EpisodicMemoryStore;
    const logger = makeLogger();

    beforeEach(() => {
        store = new EpisodicMemoryStore(makeDb(), logger);
        store.initialize();
    });

    it('insert + search 基本流程', async () => {
        await store.insert({
            tenantId: 'tenant-A',
            sessionId: 'sess-1',
            content: '用户喜欢简洁的回复风格',
            category: 'user',
            topic: 'preference',
        });
        const results = await store.search('简洁', 5, 'tenant-A');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].content).toContain('简洁');
    });

    it('租户隔离：tenant-B 查不到 tenant-A 的记忆', async () => {
        await store.insert({
            tenantId: 'tenant-A',
            sessionId: 's1',
            content: '机密内容仅限A租户',
            category: 'governance',
            topic: 'secret',
        });
        const resultsB = await store.search('机密内容', 5, 'tenant-B');
        expect(resultsB).toHaveLength(0);
    });

    it('purgeExpired 清理过期记忆', async () => {
        const db = makeDb();
        const s = new EpisodicMemoryStore(db, logger);
        s.initialize();

        // 直接插入一条已过期的记录
        db.prepare(`
            INSERT INTO episodic_memories (id, tenant_id, session_id, content, category, topic, expires_at, created_at)
            VALUES ('exp-1', 'tenant-A', 'sess-x', 'expired', 'general', '', 1, 1)
        `).run();

        const deleted = s.purgeExpired();
        expect(deleted).toBe(1);

        const remaining = await s.search('expired', 5, 'tenant-A');
        expect(remaining).toHaveLength(0);
    });
});

// ─── SemanticMemoryStore ──────────────────────────────────────────────────────

describe('SemanticMemoryStore', () => {
    let store: SemanticMemoryStore;
    const logger = makeLogger();

    beforeEach(() => {
        store = new SemanticMemoryStore(makeDb(), logger);
        store.initialize();
    });

    it('upsert confidence < 0.85 被过滤', async () => {
        await store.upsert({
            tenantId: 'tenant-A',
            subject: '张三',
            predicate: '职位',
            object: '工程师',
            confidence: 0.7,
        });
        const pending = await store.pendingFacts('tenant-A');
        expect(pending).toHaveLength(0);
    });

    it('upsert confidence >= 0.85 进入 pending', async () => {
        await store.upsert({
            tenantId: 'tenant-A',
            subject: '张三',
            predicate: '职位',
            object: '工程师',
            confidence: 0.9,
        });
        const pending = await store.pendingFacts('tenant-A');
        expect(pending).toHaveLength(1);
        expect(pending[0].status).toBe('pending');
    });

    it('review approve → status 变为 approved，可被 search 查到', async () => {
        await store.upsert({
            tenantId: 'tenant-A',
            subject: '张三',
            predicate: '技能',
            object: 'TypeScript',
            confidence: 0.95,
        });
        const [fact] = await store.pendingFacts('tenant-A');
        const ok = await store.review(fact.id, 'approve', 'admin', 'tenant-A');
        expect(ok).toBe(true);

        const results = await store.search('张三', 'tenant-A');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].status).toBe('approved');
    });

    it('review reject → 不出现在 search 结果', async () => {
        await store.upsert({
            tenantId: 'tenant-A',
            subject: '李四',
            predicate: '爱好',
            object: '钓鱼',
            confidence: 0.9,
        });
        const [fact] = await store.pendingFacts('tenant-A');
        const ok = await store.review(fact.id, 'reject', 'admin', 'tenant-A');
        expect(ok).toBe(true);

        const results = await store.search('李四', 'tenant-A');
        expect(results).toHaveLength(0);
    });

    it('review 跨租户攻击：tenant-B 无法审批 tenant-A 的事实', async () => {
        await store.upsert({
            tenantId: 'tenant-A',
            subject: 'Alice',
            predicate: '角色',
            object: '管理员',
            confidence: 0.95,
        });
        const [fact] = await store.pendingFacts('tenant-A');
        // tenant-B 尝试审批 tenant-A 的事实
        const ok = await store.review(fact.id, 'approve', 'attacker', 'tenant-B');
        expect(ok).toBe(false);

        // 事实仍然是 pending 状态
        const pending = await store.pendingFacts('tenant-A');
        expect(pending).toHaveLength(1);
        expect(pending[0].status).toBe('pending');
    });

    it('租户隔离：tenant-B 看不到 tenant-A 的 pending facts', async () => {
        await store.upsert({
            tenantId: 'tenant-A',
            subject: 'X',
            predicate: 'Y',
            object: 'Z',
            confidence: 0.95,
        });
        const pendingB = await store.pendingFacts('tenant-B');
        expect(pendingB).toHaveLength(0);
    });

    it('已 approved 的 subject+predicate 不重复创建 pending', async () => {
        await store.upsert({ tenantId: 'T', subject: 'A', predicate: 'B', object: 'C', confidence: 0.9 });
        const [f] = await store.pendingFacts('T');
        await store.review(f.id, 'approve', 'admin', 'T');

        // 再次 upsert 同一 subject+predicate
        await store.upsert({ tenantId: 'T', subject: 'A', predicate: 'B', object: 'D', confidence: 0.95 });
        const pending2 = await store.pendingFacts('T');
        expect(pending2).toHaveLength(0); // 跳过了
    });
});

// ─── IMemoryRouter 接口 ───────────────────────────────────────────────────────

describe('MemoryRouter (Phase 6)', () => {
    it('实现 IMemoryRouter 接口的方法签名', () => {
        const mockLongTerm = { search: vi.fn().mockResolvedValue([]) } as any;
        const mockKG = { search: vi.fn().mockResolvedValue({ nodes: [], relevanceScores: {} }) } as any;
        const mockSession = {} as any;
        const episodic = new EpisodicMemoryStore(makeDb(), makeLogger());
        episodic.initialize();
        const semantic = new SemanticMemoryStore(makeDb(), makeLogger());
        semantic.initialize();

        const router = new MemoryRouter(mockLongTerm, mockKG, mockSession, episodic, semantic);

        expect(typeof router.searchEpisodic).toBe('function');
        expect(typeof router.insertEpisodic).toBe('function');
        expect(typeof router.searchSemantic).toBe('function');
        expect(typeof router.upsertSemanticFact).toBe('function');
        expect(typeof router.pendingFacts).toBe('function');
        expect(typeof router.reviewFact).toBe('function'); // (factId, decision, reviewer, tenantId) => Promise<boolean>
        expect(typeof router.loadAgentRules).toBe('function');
        expect(typeof router.query).toBe('function');
    });

    it('query() 返回 layer 字段（非旧版 source）', async () => {
        const mockLongTerm = { search: vi.fn().mockResolvedValue([{ content: 'lt result', metadata: {} }]) } as any;
        const mockKG = { search: vi.fn().mockResolvedValue({ nodes: [], relevanceScores: {} }) } as any;
        const router = new MemoryRouter(mockLongTerm, mockKG, {} as any);

        const results = await router.query('test', { sessionId: 's1', tenantId: 'T' });
        expect(results[0]).toHaveProperty('layer');
    });
});
