import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { LongTermMemory } from '../src/memory/long-term.js';
import { MemoryGovernor } from '../src/memory/memory-governor.js';
import type { LLMAdapter, Message } from '../src/types.js';

const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

function createMemory() {
    const db = new DatabaseSync(':memory:');
    const mem = new LongTermMemory({ db, logger: mockLogger });
    mem.initialize();
    return { db, mem };
}

function mockLLM(response: string): LLMAdapter {
    return {
        provider: 'mock',
        chat: vi.fn(async (): Promise<Message> => ({ role: 'assistant', content: response })),
        chatStream: vi.fn(),
        embeddings: vi.fn(),
    } as unknown as LLMAdapter;
}

describe('U5: Memory Governance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('LongTermMemory governance fields', () => {
        it('should store confidence from metadata', async () => {
            const { db, mem } = createMemory();
            const id = await mem.remember('test content', { confidence: 0.5 });
            const row = db.prepare('SELECT confidence FROM memories WHERE id = ?').get(id) as { confidence: number };
            expect(row.confidence).toBe(0.5);
        });

        it('should default confidence to 0.8', async () => {
            const { db, mem } = createMemory();
            const id = await mem.remember('test content');
            const row = db.prepare('SELECT confidence FROM memories WHERE id = ?').get(id) as { confidence: number };
            expect(row.confidence).toBe(0.8);
        });

        it('should clamp confidence to [0,1]', async () => {
            const { db, mem } = createMemory();
            const id = await mem.remember('test', { confidence: 5 });
            const row = db.prepare('SELECT confidence FROM memories WHERE id = ?').get(id) as { confidence: number };
            expect(row.confidence).toBe(1);
        });

        it('should supersede old memory via metadata.supersedes', async () => {
            const { db, mem } = createMemory();
            const oldId = await mem.remember('服务器端口是 8080');
            const newId = await mem.remember('服务器端口改为 9090', { supersedes: oldId });

            const oldRow = db.prepare('SELECT superseded_by FROM memories WHERE id = ?').get(oldId) as { superseded_by: string };
            expect(oldRow.superseded_by).toBe(newId);
        });

        it('should exclude superseded memories from search', async () => {
            const { mem } = createMemory();
            const oldId = await mem.remember('数据库密码策略是每30天更新');
            await mem.remember('数据库密码策略是每90天更新', { supersedes: oldId });

            const results = await mem.search('数据库密码策略');
            expect(results.length).toBe(1);
            expect(results[0].content).toContain('90天');
        });

        it('markVerified should bump confidence and refresh last_verified_at', async () => {
            const { db, mem } = createMemory();
            const id = await mem.remember('test', { confidence: 0.5 });
            const ok = mem.markVerified(id);
            expect(ok).toBe(true);
            const row = db.prepare('SELECT confidence, last_verified_at FROM memories WHERE id = ?').get(id) as { confidence: number; last_verified_at: string };
            expect(row.confidence).toBeCloseTo(0.55);
            expect(row.last_verified_at).toBeTruthy();
        });

        it('markVerified should cap confidence at 1.0', async () => {
            const { db, mem } = createMemory();
            const id = await mem.remember('test', { confidence: 0.99 });
            mem.markVerified(id);
            const row = db.prepare('SELECT confidence FROM memories WHERE id = ?').get(id) as { confidence: number };
            expect(row.confidence).toBe(1.0);
        });
    });

    describe('decayAndPrune', () => {
        it('should decay stale memories', async () => {
            const { db, mem } = createMemory();
            const id = await mem.remember('old knowledge', { confidence: 0.8 });
            // 人为做旧：last_verified_at 设为 100 天前
            db.prepare(`UPDATE memories SET last_verified_at = datetime('now', '-100 days'), updated_at = datetime('now', '-100 days') WHERE id = ?`).run(id);

            const { decayed } = mem.decayAndPrune({ staleDays: 90 });
            expect(decayed).toBe(1);

            const row = db.prepare('SELECT confidence FROM memories WHERE id = ?').get(id) as { confidence: number };
            expect(row.confidence).toBeCloseTo(0.72); // 0.8 × 0.9
        });

        it('should not decay fresh memories', async () => {
            const { mem } = createMemory();
            await mem.remember('fresh knowledge');
            const { decayed } = mem.decayAndPrune({ staleDays: 90 });
            expect(decayed).toBe(0);
        });

        it('should prune low-confidence stale memories', async () => {
            const { db, mem } = createMemory();
            const id = await mem.remember('obsolete', { confidence: 0.15 });
            db.prepare(`UPDATE memories SET last_verified_at = datetime('now', '-200 days'), updated_at = datetime('now', '-200 days') WHERE id = ?`).run(id);

            const { pruned } = mem.decayAndPrune({ pruneThreshold: 0.2, pruneDays: 180 });
            expect(pruned).toBe(1);
            expect(db.prepare('SELECT COUNT(*) AS c FROM memories').get()).toEqual({ c: 0 });
        });
    });

    describe('MemoryGovernor.governedRemember', () => {
        it('should insert directly when no similar memories exist', async () => {
            const { mem } = createMemory();
            const gov = new MemoryGovernor(mem, () => mockLLM('{"verdict":"new"}'), mockLogger);
            const result = await gov.governedRemember('全新的知识');
            expect(result.verdict).toBe('insert');
            expect(result.id).toBeTruthy();
        });

        it('should skip duplicate and reinforce existing memory', async () => {
            const { db, mem } = createMemory();
            const existingId = await mem.remember('部署流程需要先跑测试', { confidence: 0.8 });

            const gov = new MemoryGovernor(
                mem,
                () => mockLLM(`{"verdict":"duplicate","targetId":"${existingId}"}`),
                mockLogger
            );
            const result = await gov.governedRemember('部署流程必须先执行测试');
            expect(result.verdict).toBe('skip_duplicate');
            expect(result.id).toBe(existingId);

            // 置信度应被提升，且没有新增条目
            const row = db.prepare('SELECT confidence FROM memories WHERE id = ?').get(existingId) as { confidence: number };
            expect(row.confidence).toBeCloseTo(0.85);
            expect((db.prepare('SELECT COUNT(*) AS c FROM memories').get() as { c: number }).c).toBe(1);
        });

        it('should supersede conflicting memory', async () => {
            const { db, mem } = createMemory();
            const oldId = await mem.remember('发布窗口是周五下午');

            const gov = new MemoryGovernor(
                mem,
                () => mockLLM(`{"verdict":"conflict","targetId":"${oldId}"}`),
                mockLogger
            );
            const result = await gov.governedRemember('发布窗口改为周三上午');
            expect(result.verdict).toBe('supersede');

            const oldRow = db.prepare('SELECT superseded_by FROM memories WHERE id = ?').get(oldId) as { superseded_by: string };
            expect(oldRow.superseded_by).toBe(result.id);
        });

        it('should fall back to insert when LLM fails', async () => {
            const { mem } = createMemory();
            await mem.remember('已有记忆');
            const failingLLM = {
                provider: 'mock',
                chat: vi.fn(async () => { throw new Error('LLM unavailable'); }),
                chatStream: vi.fn(),
                embeddings: vi.fn(),
            } as unknown as LLMAdapter;

            const gov = new MemoryGovernor(mem, () => failingLLM, mockLogger);
            const result = await gov.governedRemember('已有记忆的另一种说法');
            expect(result.verdict).toBe('insert');
        });

        it('should ignore verdict with invalid targetId', async () => {
            const { mem } = createMemory();
            await mem.remember('某条记忆');
            const gov = new MemoryGovernor(
                mem,
                () => mockLLM('{"verdict":"duplicate","targetId":"nonexistent-id"}'),
                mockLogger
            );
            const result = await gov.governedRemember('某条记忆的复述');
            expect(result.verdict).toBe('insert');
        });
    });

    describe('reflect', () => {
        it('should run reflection and record stats', async () => {
            const { mem } = createMemory();
            const gov = new MemoryGovernor(mem, () => mockLLM(''), mockLogger);
            const result = await gov.reflect();
            expect(result.decayed).toBe(0);
            expect(result.pruned).toBe(0);
            expect(gov.getLastReflection()).toEqual(result);
        });
    });
});
