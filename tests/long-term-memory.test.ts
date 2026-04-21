import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { LongTermMemory } from '../src/memory/long-term.js';

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

describe('LongTermMemory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize without error (idempotent)', () => {
        const { mem } = createMemory();
        // Call initialize again — should not throw
        mem.initialize();
    });

    describe('set/get', () => {
        it('should store and retrieve a string value', async () => {
            const { mem } = createMemory();
            await mem.set('user_name', 'Alice');
            expect(await mem.get('user_name')).toBe('Alice');
        });

        it('should store and retrieve an object value', async () => {
            const { mem } = createMemory();
            await mem.set('prefs', { theme: 'dark', lang: 'zh' });
            expect(await mem.get('prefs')).toEqual({ theme: 'dark', lang: 'zh' });
        });

        it('should upsert existing key', async () => {
            const { mem } = createMemory();
            await mem.set('key1', 'v1');
            await mem.set('key1', 'v2');
            expect(await mem.get('key1')).toBe('v2');
        });

        it('should return undefined for missing key', async () => {
            const { mem } = createMemory();
            expect(await mem.get('nonexistent')).toBeUndefined();
        });
    });

    describe('remember/forget', () => {
        it('should remember and return an id', async () => {
            const { mem } = createMemory();
            const id = await mem.remember('User prefers dark mode', { tags: ['pref'] });
            expect(id).toBeTruthy();
            expect(typeof id).toBe('string');
        });

        it('should forget a memory by id', async () => {
            const { mem } = createMemory();
            const id = await mem.remember('temporary info');
            expect(await mem.forget(id)).toBe(true);
        });

        it('should return false when forgetting non-existent id', async () => {
            const { mem } = createMemory();
            expect(await mem.forget('nonexistent-id')).toBe(false);
        });

        it('should remember with session id', async () => {
            const { mem, db } = createMemory();
            await mem.remember('session data', {}, 'session-123');
            const row = db.prepare('SELECT session_id FROM memories WHERE content = ?').get('session data') as any;
            expect(row.session_id).toBe('session-123');
        });
    });

    describe('search', () => {
        it('should find memories by content substring (FTS5)', async () => {
            const { mem } = createMemory();
            await mem.remember('User prefers dark mode');
            await mem.remember('User email is test@example.com');
            await mem.remember('Project deadline is Friday');

            const results = await mem.search('User');
            expect(results.length).toBe(2);
            expect(results.every(r => r.content.includes('User'))).toBe(true);
        });

        it('should respect limit parameter', async () => {
            const { mem } = createMemory();
            await mem.remember('item 1');
            await mem.remember('item 2');
            await mem.remember('item 3');

            const results = await mem.search('item', 2);
            expect(results.length).toBe(2);
        });

        it('should return empty for no match', async () => {
            const { mem } = createMemory();
            await mem.remember('some content');
            const results = await mem.search('zzz_no_match');
            expect(results).toEqual([]);
        });

        it('should search by category and topic metadata', async () => {
            const { mem } = createMemory();
            await mem.remember('deploy kubernetes cluster', { category: 'operational', topic: 'k8s-deploy' });
            await mem.remember('user prefers english language', { category: 'user', topic: 'language-pref' });

            const results = await mem.search('kubernetes');
            expect(results.length).toBe(1);
            expect(results[0].content).toContain('kubernetes');
        });
    });

    describe('remember with metadata', () => {
        it('should store category in DB', async () => {
            const { mem, db } = createMemory();
            await mem.remember('governance rule', { category: 'governance', topic: 'rule-1' });
            const row = db.prepare('SELECT category, topic FROM memories WHERE content = ?').get('governance rule') as any;
            expect(row.category).toBe('governance');
            expect(row.topic).toBe('rule-1');
        });

        it('should default to user category', async () => {
            const { mem, db } = createMemory();
            await mem.remember('plain memory');
            const row = db.prepare('SELECT category FROM memories WHERE content = ?').get('plain memory') as any;
            expect(row.category).toBe('user');
        });

        it('should fall back to user for invalid category', async () => {
            const { mem, db } = createMemory();
            await mem.remember('test content', { category: 'invalid_category' });
            const row = db.prepare('SELECT category FROM memories WHERE content = ?').get('test content') as any;
            expect(row.category).toBe('user');
        });
    });
});
