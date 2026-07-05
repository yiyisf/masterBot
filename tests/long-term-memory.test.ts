import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LongTermMemory } from '../src/memory/long-term.js';

const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

// 隔离测试文件系统副作用：不传 dataDir 会默认写入真实项目的 data/.memory/ 目录。
const tempDirs: string[] = [];

function createMemory() {
    const db = new DatabaseSync(':memory:');
    const dataDir = mkdtempSync(join(tmpdir(), 'cmaster-ltm-test-'));
    tempDirs.push(dataDir);
    const mem = new LongTermMemory({ db, logger: mockLogger, dataDir });
    mem.initialize();
    return { db, mem, dataDir };
}

describe('LongTermMemory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        while (tempDirs.length) {
            const dir = tempDirs.pop()!;
            try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
        }
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

    describe('readMemoryFile (P1-6 M1: agentic recall)', () => {
        // remember() 的文件写入是 fire-and-forget（不阻塞调用方），测试需轮询等待落盘
        async function waitForFile(mem: LongTermMemory, category: string, topic: string, timeoutMs = 2000): Promise<string> {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                const content = await mem.readMemoryFile(category, topic);
                if (content !== null) return content;
                await new Promise(r => setTimeout(r, 20));
            }
            throw new Error(`Timed out waiting for memory file ${category}/${topic}`);
        }

        it('reads back the full content of a remembered file by category/topic', async () => {
            const { mem } = createMemory();
            await mem.remember('用户偏好深色主题', { category: 'user', topic: 'ui-theme-pref' });

            const content = await waitForFile(mem, 'user', 'ui-theme-pref');
            expect(content).toContain('用户偏好深色主题');
        });

        it('returns null for a non-existent category/topic', async () => {
            const { mem } = createMemory();
            expect(await mem.readMemoryFile('user', 'no-such-topic')).toBeNull();
        });

        it('falls back to user category for an invalid category', async () => {
            const { mem } = createMemory();
            await mem.remember('fallback content', { category: 'user', topic: 'fallback-topic' });
            await waitForFile(mem, 'user', 'fallback-topic');

            const content = await mem.readMemoryFile('not-a-real-category', 'fallback-topic');
            expect(content).toContain('fallback content');
        });
    });

    describe('forget/supersede file sync (P1-6 M3: file as source of truth)', () => {
        async function waitForFile(mem: LongTermMemory, category: string, topic: string, timeoutMs = 2000): Promise<void> {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                if (await mem.readMemoryFile(category, topic) !== null) return;
                await new Promise(r => setTimeout(r, 20));
            }
            throw new Error(`Timed out waiting for memory file ${category}/${topic}`);
        }

        it('forget() deletes the corresponding .md file and index entry', async () => {
            const { mem } = createMemory();
            const id = await mem.remember('temp fact to forget', { category: 'user', topic: 'forget-me' });
            await waitForFile(mem, 'user', 'forget-me');

            const indexBefore = await mem.loadMemoryIndex();
            expect(indexBefore).toContain('forget-me');

            expect(await mem.forget(id)).toBe(true);

            expect(await mem.readMemoryFile('user', 'forget-me')).toBeNull();
            const indexAfter = await mem.loadMemoryIndex();
            expect(indexAfter).not.toContain('forget-me');
        });

        it('supersede() removes the old memory file and index entry (DB row kept for traceability)', async () => {
            const { mem, db } = createMemory();
            const oldId = await mem.remember('old fact', { category: 'user', topic: 'superseded-topic' });
            await waitForFile(mem, 'user', 'superseded-topic');
            const newId = await mem.remember('corrected fact', { category: 'user', topic: 'new-topic' });
            await waitForFile(mem, 'user', 'new-topic');

            expect(mem.supersede(oldId, newId)).toBe(true);

            // 等待异步文件删除 + 索引更新完成（_removeMemoryFile 内先删文件再更新索引，
            // 以索引不再含该 topic 作为两步都完成的信号）
            let index = await mem.loadMemoryIndex();
            const start = Date.now();
            while (index?.includes('superseded-topic') && Date.now() - start < 2000) {
                await new Promise(r => setTimeout(r, 20));
                index = await mem.loadMemoryIndex();
            }

            expect(await mem.readMemoryFile('user', 'superseded-topic')).toBeNull();
            expect(index).not.toContain('superseded-topic');
            expect(index).toContain('new-topic');

            // DB 行本身保留，仅标记 superseded_by（供追溯）
            const row = db.prepare('SELECT superseded_by FROM memories WHERE id = ?').get(oldId) as any;
            expect(row.superseded_by).toBe(newId);
        });

        it('remember() with metadata.supersedes does not race-lose the MEMORY.md index update (review fix)', async () => {
            // 复现审查发现的竞态：remember() 内部同步调用 supersede()（触发旧 topic 的
            // fire-and-forget 文件删除 + 索引移除），随后 remember() 自身又 fire-and-forget
            // 写入新 topic 的文件 + 索引。两者并发对同一个 MEMORY.md 做"读-改-写"，
            // 若无序列化会导致其中一个更新被覆盖丢失。
            const { mem } = createMemory();
            const oldId = await mem.remember('old fact via remember', { category: 'user', topic: 'race-old' });

            // 等待旧记忆文件落盘（remember() 的写入也是 fire-and-forget）
            const start1 = Date.now();
            while (await mem.readMemoryFile('user', 'race-old') === null && Date.now() - start1 < 2000) {
                await new Promise(r => setTimeout(r, 10));
            }

            // 触发竞态路径：remember() 内部同步调用 supersede(oldId, newId) 并行触发
            // 旧 topic 移除 + 新 topic 写入两条 MEMORY.md 更新链
            const newId = await mem.remember('corrected fact via remember', {
                category: 'user',
                topic: 'race-new',
                supersedes: oldId,
            });
            expect(newId).toBeTruthy();

            // 等待两条链都落定：索引不再含旧 topic，且含新 topic
            let index = await mem.loadMemoryIndex();
            const start2 = Date.now();
            while ((index?.includes('race-old') || !index?.includes('race-new')) && Date.now() - start2 < 2000) {
                await new Promise(r => setTimeout(r, 10));
                index = await mem.loadMemoryIndex();
            }

            expect(index).not.toContain('race-old');
            expect(index).toContain('race-new');
            expect(await mem.readMemoryFile('user', 'race-old')).toBeNull();
            const newContent = await mem.readMemoryFile('user', 'race-new');
            expect(newContent).toContain('corrected fact via remember');
        });

        it('does not delete a colliding memory file that now belongs to a different topic (review fix)', async () => {
            // sanitizeFilename() 是有损多对一映射："foo/bar" 与 "foo:bar" 都会 sanitize 成 "foo-bar"，
            // 共享同一个 .md 文件。第二次写入会覆盖第一次的文件内容和 frontmatter name。
            const { mem } = createMemory();
            const idA = await mem.remember('memory A content', { category: 'user', topic: 'foo/bar' });

            const start1 = Date.now();
            while (await mem.readMemoryFile('user', 'foo-bar') === null && Date.now() - start1 < 2000) {
                await new Promise(r => setTimeout(r, 10));
            }

            // 撞名写入：topic "foo:bar" sanitize 后与 "foo/bar" 相同的文件名，覆盖了文件
            await mem.remember('memory B content (collides on disk)', { category: 'user', topic: 'foo:bar' });
            const start2 = Date.now();
            let content = await mem.readMemoryFile('user', 'foo-bar');
            while (!content?.includes('memory B content') && Date.now() - start2 < 2000) {
                await new Promise(r => setTimeout(r, 10));
                content = await mem.readMemoryFile('user', 'foo-bar');
            }
            expect(content).toContain('memory B content');

            // forget A（较早写入、文件名撞车的那一条）不应删除现在实际属于 B 的文件
            expect(await mem.forget(idA)).toBe(true);

            const afterForget = await mem.readMemoryFile('user', 'foo-bar');
            expect(afterForget).toContain('memory B content (collides on disk)');
            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('collision detected'));
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

        it('should find CJK memories by substring (trigram tokenizer, U6 regression)', async () => {
            // unicode61 分词器把整段连续中文当作单个 token，"数据库" 无法匹配到含它的整句。
            // 切到 trigram 后按 3 字符切片索引，中文子串检索应可命中。
            const { mem } = createMemory();
            await mem.remember('我们的数据库配置在 config 目录');
            await mem.remember('用户偏好使用暗色主题');

            const results = await mem.search('数据库');
            expect(results.length).toBe(1);
            expect(results[0].content).toContain('数据库');
        });
    });

    describe('FTS tokenizer migration (U6)', () => {
        it('should migrate an existing unicode61 memory_fts table to trigram and preserve data', async () => {
            const db = new DatabaseSync(':memory:');
            // 模拟旧版本遗留的 unicode61 表 + 已有记忆数据
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
                CREATE VIRTUAL TABLE memory_fts USING fts5(
                    id UNINDEXED, category UNINDEXED, topic UNINDEXED, content,
                    tokenize='unicode61 remove_diacritics 2'
                );
            `);
            db.prepare(
                'INSERT INTO memories (id, category, topic, content) VALUES (?, ?, ?, ?)'
            ).run('legacy-1', 'user', 'legacy-topic', '旧版本写入的数据库连接信息');
            db.prepare(
                'INSERT INTO memory_fts (id, category, topic, content) VALUES (?, ?, ?, ?)'
            ).run('legacy-1', 'user', 'legacy-topic', '旧版本写入的数据库连接信息');

            const mem = new LongTermMemory({ db, logger: mockLogger });
            mem.initialize();

            const sql = (db.prepare(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='memory_fts'"
            ).get() as { sql: string }).sql;
            expect(sql).toContain('trigram');
            expect(sql).not.toContain('unicode61');

            const results = await mem.search('数据库');
            expect(results.length).toBe(1);
            expect(results[0].content).toContain('旧版本写入的数据库连接信息');
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
