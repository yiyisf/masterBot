/**
 * P1: Agent 实例治理测试
 * 覆盖：cancel 状态保持 / AbortError 归为 cancelled / DB-only 实例 cancel /
 *       孤儿实例启动清理 / 进度周期性持久化
 */

import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { AgentPool } from '../src/core/harness/agent-pool.js';
import { AgentHarness } from '../src/core/harness/agent-harness.js';
import { defaultAgentSpec } from '../src/core/harness/agent-spec.js';
import { SkillRegistry } from '../src/skills/registry.js';
import type { Logger, MemoryAccess } from '../src/types.js';

function makeLogger(): Logger {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeLLM() {
    return {
        provider: 'mock',
        chat: vi.fn().mockResolvedValue({ role: 'assistant', content: 'mock answer' }),
        chatStream: vi.fn(),
        embeddings: vi.fn().mockResolvedValue([[]]),
    };
}

function makeMemory(): MemoryAccess {
    return { get: async () => undefined, set: async () => {}, search: async () => [] };
}

function makeDb(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    db.exec(`
        CREATE TABLE agent_instances (
            id TEXT PRIMARY KEY,
            spec_id TEXT NOT NULL,
            spec_name TEXT NOT NULL,
            state TEXT NOT NULL,
            task TEXT,
            started_at INTEGER,
            completed_at INTEGER,
            step_count INTEGER DEFAULT 0,
            last_score REAL,
            error TEXT
        )
    `);
    return db;
}

function makeHarness(logger = makeLogger()): AgentHarness {
    const spec = defaultAgentSpec({ id: 'w1', name: 'Worker', description: 'test', systemPrompt: 'x' });
    return new AgentHarness(spec, () => makeLLM() as any, new SkillRegistry(logger), logger);
}

const ctx = { sessionId: 's1', memory: makeMemory() };

describe('AgentHarness cancel 状态', () => {
    it('执行中 cancel 后最终状态保持 cancelled（不被覆写为 completed）', async () => {
        const harness = makeHarness();
        (harness as any).engine = {
            run: async function* () {
                yield { type: 'thought', content: 't1', timestamp: new Date() };
                harness.cancel();
                yield { type: 'answer', content: 'a', timestamp: new Date() };
            },
        };
        const steps: any[] = [];
        for await (const s of harness.execute('task', ctx)) steps.push(s);
        expect(harness.getState()).toBe('cancelled');
    });

    it('引擎抛出 AbortError 归为 cancelled 而非 failed，且不向上抛', async () => {
        const harness = makeHarness();
        (harness as any).engine = {
            run: async function* () {
                const err = new Error('This operation was aborted');
                err.name = 'AbortError';
                throw err;
                yield undefined as never; // 使函数成为 generator
            },
        };
        const steps: any[] = [];
        for await (const s of harness.execute('task', ctx)) steps.push(s);
        expect(harness.getState()).toBe('cancelled');
        expect(harness.getError()).toBeUndefined();
    });

    it('cancel 后不允许重新进入运行态', async () => {
        const harness = makeHarness();
        harness.cancel();
        const steps: any[] = [];
        for await (const s of harness.execute('task', ctx)) steps.push(s);
        expect(steps).toHaveLength(0);
        expect(harness.getState()).toBe('cancelled');
    });

    it('cancel 触发内部 AbortController', () => {
        const harness = makeHarness();
        const signal = (harness as any).abortController.signal as AbortSignal;
        expect(signal.aborted).toBe(false);
        harness.cancel();
        expect(signal.aborted).toBe(true);
    });
});

describe('AgentPool 实例治理', () => {
    it('cancel 不存在的实例返回 false', () => {
        const pool = new AgentPool(() => makeLLM() as any, new SkillRegistry(makeLogger()), makeLogger());
        expect(pool.cancel('nonexistent')).toBe(false);
        expect(pool.pause('nonexistent')).toBe(false);
        expect(pool.resume('nonexistent')).toBe(false);
    });

    it('cancel 仅存在于 DB 的残留 running 行：直接更新状态', () => {
        const db = makeDb();
        db.prepare(`INSERT INTO agent_instances (id, spec_id, spec_name, state, task, started_at, step_count)
                    VALUES ('stale-1', 'w1', 'Worker', 'running', 't', ?, 0)`).run(Date.now());
        const pool = new AgentPool(
            () => makeLLM() as any, new SkillRegistry(makeLogger()), makeLogger(),
            undefined, undefined, undefined, undefined, undefined, db
        );
        expect(pool.cancel('stale-1')).toBe(true);
        const row = db.prepare(`SELECT state FROM agent_instances WHERE id = 'stale-1'`).get() as any;
        expect(row.state).toBe('cancelled');
        // 已终止的行再次 cancel 返回 false
        expect(pool.cancel('stale-1')).toBe(false);
    });

    it('markOrphanedInstances 将残留 running/queued 行标记为 failed', () => {
        const db = makeDb();
        db.prepare(`INSERT INTO agent_instances (id, spec_id, spec_name, state, task, started_at, step_count)
                    VALUES ('orphan-1', 'w1', 'Worker', 'running', 't', ?, 0)`).run(Date.now());
        db.prepare(`INSERT INTO agent_instances (id, spec_id, spec_name, state, task, started_at, step_count)
                    VALUES ('orphan-2', 'w1', 'Worker', 'queued', 't', ?, 0)`).run(Date.now());
        db.prepare(`INSERT INTO agent_instances (id, spec_id, spec_name, state, task, started_at, step_count, completed_at)
                    VALUES ('done-1', 'w1', 'Worker', 'completed', 't', ?, 5, ?)`).run(Date.now(), Date.now());
        const pool = new AgentPool(
            () => makeLLM() as any, new SkillRegistry(makeLogger()), makeLogger(),
            undefined, undefined, undefined, undefined, undefined, db
        );
        expect(pool.markOrphanedInstances()).toBe(2);
        const states = db.prepare(`SELECT id, state, error FROM agent_instances ORDER BY id`).all() as any[];
        expect(states.find(r => r.id === 'orphan-1').state).toBe('failed');
        expect(states.find(r => r.id === 'orphan-1').error).toContain('restart');
        expect(states.find(r => r.id === 'orphan-2').state).toBe('failed');
        expect(states.find(r => r.id === 'done-1').state).toBe('completed');
    });

    it('spawn 后 listInstances 显示 task 内容', async () => {
        const logger = makeLogger();
        const pool = new AgentPool(() => makeLLM() as any, new SkillRegistry(logger), logger);
        const spec = defaultAgentSpec({ id: 'w1', name: 'Worker', description: 'test', systemPrompt: 'x' });
        pool.registerSpec(spec);
        const instanceId = await pool.spawn('w1', '分析日志文件', { sessionId: 's1', memory: makeMemory() });
        const info = pool.listInstances().find(i => i.instanceId === instanceId);
        expect(info?.task).toBe('分析日志文件');
        pool.cancel(instanceId);
    });
});
