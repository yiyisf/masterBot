import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { LongTermMemory } from '../src/memory/long-term.js';

const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

function createMemory(embeddingFn?: (texts: string[]) => Promise<number[][]>) {
    const db = new DatabaseSync(':memory:');
    const mem = new LongTermMemory({ db, logger: mockLogger, embeddingFn });
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

    describe('search (LIKE fallback)', () => {
        it('should find memories by content substring', async () => {
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
    });

    describe('search (vector)', () => {
        it('should use embedding function for vector search', async () => {
            // Mock embedding: simple 3-dim vectors
            const mockEmbedding = vi.fn(async (texts: string[]) => {
                return texts.map(t => {
                    if (t.includes('dark')) return [1, 0, 0];
                    if (t.includes('light')) return [0.9, 0.1, 0];
                    if (t.includes('deadline')) return [0, 0, 1];
                    return [0.5, 0.5, 0.5]; // query default
                });
            });

            const { mem } = createMemory(mockEmbedding);
            await mem.remember('dark mode preference');
            await mem.remember('light theme option');
            await mem.remember('project deadline Friday');

            const results = await mem.search('dark theme', 2);
            expect(results.length).toBe(2);
            // dark and light should be most similar to "dark theme"
            expect(results[0].content).toContain('dark');
        });

        it('should fall back to LIKE when embedding fails', async () => {
            const failingEmbedding = vi.fn()
                .mockResolvedValueOnce([[1, 0, 0]]) // succeed on remember
                .mockRejectedValueOnce(new Error('API error')); // fail on search

            const { mem } = createMemory(failingEmbedding);
            await mem.remember('findable content');

            // Should fall back to LIKE and still find
            const results = await mem.search('findable');
            expect(results.length).toBe(1);
        });
    });

    describe('set with embedding', () => {
        it('should compute embedding on set', async () => {
            const mockEmbedding = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));
            const { mem, db } = createMemory(mockEmbedding);

            await mem.set('key1', 'hello');
            const row = db.prepare('SELECT embedding FROM memories WHERE key = ?').get('key1') as any;
            expect(JSON.parse(row.embedding)).toEqual([1, 0]);
            expect(mockEmbedding).toHaveBeenCalledWith(['hello']);
        });

        it('should still set value when embedding fails', async () => {
            const failingEmbedding = vi.fn().mockRejectedValue(new Error('fail'));
            const { mem } = createMemory(failingEmbedding);

            await mem.set('key1', 'value');
            expect(await mem.get('key1')).toBe('value');
        });
    });
});
