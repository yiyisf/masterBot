/**
 * Phase 5: Session Fork / Checkpoint / Resume 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRouter, EnvFeatureFlagService } from '../src/core/agent/router.js';
import { CheckpointManager } from '../src/core/checkpoint-manager.js';
import type { IAgent, AgentInput, AgentEvent, AgentCapabilities } from '../src/core/agent/types.js';
import type { Logger } from '../src/types.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeLogger(): Logger {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
    return {
        message: 'hello',
        sessionId: 'sess-1',
        userId: 'u1',
        tenantId: 't1',
        provider: 'anthropic',
        ...overrides,
    };
}

function makeMockAgent(overrides: Partial<IAgent> = {}): IAgent {
    return {
        async *execute(_input: AgentInput): AsyncGenerator<AgentEvent> { yield { type: 'text', data: 'ok', timestamp: 0 }; },
        async *resume(_sessionId: string): AsyncGenerator<AgentEvent> { yield { type: 'text', data: 'resumed', timestamp: 0 }; },
        async fork(sessionId: string): Promise<string> { return `fork-of-${sessionId}`; },
        async checkpoint(sessionId: string, label?: string): Promise<string> { return `cp-${sessionId}-${label ?? 'default'}`; },
        capabilities(): AgentCapabilities {
            return { supportsStreaming: true, supportsFork: true, supportsCheckpoint: true, maxContextTokens: 100_000 };
        },
        ...overrides,
    };
}

// ─── EnvFeatureFlagService ─────────────────────────────────────────────────────

describe('EnvFeatureFlagService', () => {
    it('读取 overrides', () => {
        const svc = new EnvFeatureFlagService({ 'my-flag': true });
        expect(svc.isEnabled('my-flag')).toBe(true);
        expect(svc.isEnabled('other-flag')).toBe(false);
    });

    it('读取环境变量', () => {
        process.env['FEATURE_TEST_FLAG'] = 'true';
        const svc = new EnvFeatureFlagService();
        expect(svc.isEnabled('test-flag')).toBe(true);
        delete process.env['FEATURE_TEST_FLAG'];
    });
});

// ─── AgentRouter ──────────────────────────────────────────────────────────────

describe('AgentRouter', () => {
    let legacyAgent: IAgent;
    let claudeAgent: IAgent;
    let router: AgentRouter;
    const logger = makeLogger();

    beforeEach(() => {
        legacyAgent = makeMockAgent({
            async fork(_sessionId: string) { return `legacy-fork`; },
            async checkpoint(_sessionId: string, _label?: string) { return `legacy-cp`; },
            capabilities: () => ({ supportsStreaming: true, supportsFork: false, supportsCheckpoint: false, maxContextTokens: 50_000 }),
        });
        claudeAgent = makeMockAgent({
            async fork(sessionId: string) { return `claude-fork-${sessionId}`; },
            async checkpoint(sessionId: string, label?: string) { return `claude-cp-${sessionId}-${label ?? 'x'}`; },
            capabilities: () => ({ supportsStreaming: true, supportsFork: true, supportsCheckpoint: true, maxContextTokens: 200_000 }),
        });
        router = new AgentRouter({
            legacyFactory: () => legacyAgent,
            claudeFactory: () => claudeAgent,
            featureFlags: new EnvFeatureFlagService({ 'claude-managed-agent': true }),
            logger,
        });
    });

    describe('fork()', () => {
        it('有 claudeAgent 时优先使用 claudeAgent.fork()', async () => {
            const newId = await router.fork('sess-abc');
            expect(newId).toBe('claude-fork-sess-abc');
        });

        it('claudeAgent fork 抛出 Invalid sessionId（Legacy 会话）时降级为 copy-based fork', async () => {
            const claudeAgentThatRejects = makeMockAgent({
                async fork() { throw new Error('Invalid sessionId: FLrQIARM1NyW_lmYYBZKS'); },
                async checkpoint(sid: string) { return `cp-${sid}`; },
                capabilities: () => ({ supportsStreaming: true, supportsFork: true, supportsCheckpoint: true, maxContextTokens: 200_000 }),
            });
            const mockMessages = [
                { id: 'm1', role: 'user', content: 'hello' },
                { id: 'm2', role: 'assistant', content: 'world' },
            ];
            const saved: any[] = [];
            const mockRepo = {
                getMessages: (_sid: string) => mockMessages,
                saveMessage: (_sid: string, msg: any) => { saved.push(msg); return msg.id; },
                recordFork: (_parent: string, _newId: string) => {},
            };
            const r = new AgentRouter({
                legacyFactory: () => legacyAgent,
                claudeFactory: () => claudeAgentThatRejects,
                featureFlags: new EnvFeatureFlagService({ 'claude-managed-agent': true }),
                logger,
                historyRepository: mockRepo,
            });
            const newId = await r.fork('sess-abc');
            expect(typeof newId).toBe('string');
            expect(newId.length).toBeGreaterThan(0);
            expect(newId).not.toBe('sess-abc');
            expect(saved.length).toBe(2); // 两条消息被复制
        });

        it('无 claudeAgent 时使用 copy-based fork', async () => {
            const mockMessages = [{ id: 'm1', role: 'user', content: 'hi' }];
            const saved: any[] = [];
            const mockRepo = {
                getMessages: (_sid: string) => mockMessages,
                saveMessage: (_sid: string, msg: any) => { saved.push(msg); return msg.id; },
                recordFork: (_parent: string, _newId: string) => {},
            };
            const r = new AgentRouter({
                legacyFactory: () => legacyAgent,
                featureFlags: new EnvFeatureFlagService(),
                logger,
                historyRepository: mockRepo,
            });
            const newId = await r.fork('sess-abc');
            expect(typeof newId).toBe('string');
            expect(newId).not.toBe('sess-abc');
            expect(saved.length).toBe(1);
        });
    });

    describe('checkpoint()', () => {
        it('有 claudeAgent 时优先使用 claudeAgent.checkpoint()', async () => {
            const cpId = await router.checkpoint('sess-1', 'before-deploy');
            expect(cpId).toBe('claude-cp-sess-1-before-deploy');
        });

        it('label 可选', async () => {
            const cpId = await router.checkpoint('sess-1');
            expect(cpId).toBe('claude-cp-sess-1-x');
        });

        it('无 claudeAgent 时 fallback 到 legacyAgent', async () => {
            const r = new AgentRouter({
                legacyFactory: () => legacyAgent,
                featureFlags: new EnvFeatureFlagService(),
                logger,
            });
            const cpId = await r.checkpoint('sess-1', 'lbl');
            expect(cpId).toBe('legacy-cp');
        });
    });

    describe('capabilities()', () => {
        it('合并两个 agent 能力（取最大值）', () => {
            const caps = router.capabilities();
            expect(caps.supportsFork).toBe(true);
            expect(caps.supportsCheckpoint).toBe(true);
            expect(caps.maxContextTokens).toBe(200_000);
        });

        it('无 claudeAgent 时返回 legacy 能力', () => {
            const r = new AgentRouter({
                legacyFactory: () => legacyAgent,
                featureFlags: new EnvFeatureFlagService(),
                logger,
            });
            const caps = r.capabilities();
            expect(caps.supportsFork).toBe(false);
            expect(caps.maxContextTokens).toBe(50_000);
        });
    });

    describe('execute() 路由', () => {
        it('forceLegacy=true 时走 legacyAgent', async () => {
            const legacySpy = vi.spyOn(legacyAgent, 'execute');
            const claudeSpy = vi.spyOn(claudeAgent, 'execute');
            const input = makeInput({ forceLegacy: true });
            const events: AgentEvent[] = [];
            for await (const ev of router.execute(input)) events.push(ev);
            expect(legacySpy).toHaveBeenCalled();
            expect(claudeSpy).not.toHaveBeenCalled();
        });

        it('provider=anthropic + flag 启用 → 走 claudeAgent', async () => {
            const claudeSpy = vi.spyOn(claudeAgent, 'execute');
            const input = makeInput({ provider: 'anthropic' });
            const events: AgentEvent[] = [];
            for await (const ev of router.execute(input)) events.push(ev);
            expect(claudeSpy).toHaveBeenCalled();
        });

        it('provider=openai → 走 legacyAgent', async () => {
            const legacySpy = vi.spyOn(legacyAgent, 'execute');
            const input = makeInput({ provider: 'openai' });
            const events: AgentEvent[] = [];
            for await (const ev of router.execute(input)) events.push(ev);
            expect(legacySpy).toHaveBeenCalled();
        });
    });
});

// ─── CheckpointManager ────────────────────────────────────────────────────────

describe('CheckpointManager', () => {
    let mgr: CheckpointManager;
    const logger = makeLogger();

    beforeEach(() => {
        const Database = require('better-sqlite3');
        const db = new Database(':memory:');
        // 建表（production 中由 database.ts 统一创建）
        db.exec(`CREATE TABLE checkpoints (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            label TEXT,
            message_count INTEGER DEFAULT 0,
            messages_json TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        mgr = new CheckpointManager(db, logger);
        mgr.initialize();
    });

    it('save() 返回 checkpoint id', () => {
        const messages = [{ id: 'm1', role: 'user' as const, content: 'hello' }];
        const cpId = mgr.save('sess-1', messages, 'my-label');
        expect(typeof cpId).toBe('string');
        expect(cpId.length).toBeGreaterThan(0);
    });

    it('list() 返回按时间倒序的 checkpoint', () => {
        const msgs = [{ id: 'm1', role: 'user' as const, content: 'hi' }];
        mgr.save('sess-1', msgs, 'cp-1');
        mgr.save('sess-1', msgs, 'cp-2');
        const list = mgr.list('sess-1');
        expect(list.length).toBe(2);
    });

    it('restore() 还原消息', () => {
        const msgs = [
            { id: 'm1', role: 'user' as const, content: 'hello' },
            { id: 'm2', role: 'assistant' as const, content: 'world' },
        ];
        const cpId = mgr.save('sess-1', msgs);
        const loaded = mgr.restore(cpId, 'sess-1');
        expect(loaded).toHaveLength(2);
        expect(loaded![0].content).toBe('hello');
        expect(loaded![1].content).toBe('world');
    });

    it('restore() 跨 session 访问返回 null', () => {
        const msgs = [{ id: 'm1', role: 'user' as const, content: 'hi' }];
        const cpId = mgr.save('sess-A', msgs);
        expect(mgr.restore(cpId, 'sess-B')).toBeNull();
    });

    it('restore() 不存在时返回 null', () => {
        expect(mgr.restore('nonexistent-id', 'sess-1')).toBeNull();
    });

    it('不同 session 的 list() 互相隔离', () => {
        const msgs = [{ id: 'm1', role: 'user' as const, content: 'hi' }];
        mgr.save('sess-A', msgs);
        mgr.save('sess-B', msgs);
        expect(mgr.list('sess-A').length).toBe(1);
        expect(mgr.list('sess-B').length).toBe(1);
    });
});
