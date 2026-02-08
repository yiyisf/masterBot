import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShortTermMemory, SessionMemoryManager } from '../src/memory/short-term.js';

const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

describe('ShortTermMemory', () => {
    let memory: ShortTermMemory;

    beforeEach(() => {
        memory = new ShortTermMemory(mockLogger);
    });

    it('should store and retrieve values', async () => {
        await memory.set('key1', 'value1');
        expect(await memory.get('key1')).toBe('value1');
    });

    it('should return undefined for missing keys', async () => {
        expect(await memory.get('nonexistent')).toBeUndefined();
    });

    it('should handle TTL expiration', async () => {
        vi.useFakeTimers();
        await memory.set('key1', 'value1', 1); // 1 second TTL

        expect(await memory.get('key1')).toBe('value1');

        vi.advanceTimersByTime(2000); // Advance 2 seconds

        expect(await memory.get('key1')).toBeUndefined();
        vi.useRealTimers();
    });

    it('should clear all entries', async () => {
        await memory.set('a', 1);
        await memory.set('b', 2);
        memory.clear();
        expect(await memory.get('a')).toBeUndefined();
        expect(await memory.get('b')).toBeUndefined();
    });

    it('should return empty array for search', async () => {
        const results = await memory.search('anything');
        expect(results).toEqual([]);
    });
});

describe('SessionMemoryManager', () => {
    let manager: SessionMemoryManager;

    beforeEach(() => {
        manager = new SessionMemoryManager({
            maxMessages: 50,
            maxSessions: 5,
            logger: mockLogger,
        });
    });

    afterEach(() => {
        manager.destroy();
    });

    it('should create and retrieve session memory', () => {
        const mem = manager.getSession('session-1');
        expect(mem).toBeInstanceOf(ShortTermMemory);
        expect(manager.getSessionCount()).toBe(1);
    });

    it('should return same memory for same session', () => {
        const mem1 = manager.getSession('session-1');
        const mem2 = manager.getSession('session-1');
        expect(mem1).toBe(mem2);
    });

    it('should delete session', () => {
        manager.getSession('session-1');
        expect(manager.getSessionCount()).toBe(1);
        manager.deleteSession('session-1');
        expect(manager.getSessionCount()).toBe(0);
    });

    it('should evict LRU sessions when over limit', () => {
        vi.useFakeTimers();

        // Create 5 sessions (at limit)
        for (let i = 0; i < 5; i++) {
            manager.getSession(`session-${i}`);
            vi.advanceTimersByTime(100);
        }
        expect(manager.getSessionCount()).toBe(5);

        // Creating 6th should evict the oldest
        manager.getSession('session-new');
        expect(manager.getSessionCount()).toBeLessThanOrEqual(5);

        vi.useRealTimers();
    });

    it('should clean up on destroy', async () => {
        const mem = manager.getSession('session-1');
        await mem.set('key', 'value');
        manager.destroy();
        expect(manager.getSessionCount()).toBe(0);
    });
});
