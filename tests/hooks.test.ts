/**
 * Phase 2: HookRegistry + builtin hooks 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookRegistry } from '../src/core/hooks/registry.js';
import type {
    PreToolUseEvent,
    PostToolUseEvent,
    PostToolUseFailureEvent,
    UserPromptSubmitEvent,
    SessionStartEvent,
    SessionEndEvent,
    PermissionRequestEvent,
    HookResult,
} from '../src/core/hooks/types.js';
import { createSandboxHook } from '../src/core/hooks/builtin/sandbox-hook.js';

// ─── HookRegistry ─────────────────────────────────────────────────────────────

describe('HookRegistry', () => {
    let registry: HookRegistry;

    beforeEach(() => {
        registry = new HookRegistry();
    });

    it('register + run 基本 hook', async () => {
        const called: string[] = [];
        registry.register<SessionStartEvent>({
            id: 'test-start',
            eventType: 'SessionStart',
            fn: async () => { called.push('start'); },
        });

        const event: SessionStartEvent = {
            type: 'SessionStart',
            ctx: { sessionId: 's1', userId: 'u1', tenantId: 't1' },
        };
        const { aborted } = await registry.run(event);
        expect(aborted).toBe(false);
        expect(called).toEqual(['start']);
    });

    it('abort 后停止后续 hook', async () => {
        const called: string[] = [];
        registry.register<PreToolUseEvent>({
            id: 'abort-hook',
            eventType: 'PreToolUse',
            priority: 0,
            fn: async () => {
                called.push('first');
                return { abort: true };
            },
        });
        registry.register<PreToolUseEvent>({
            id: 'never-called',
            eventType: 'PreToolUse',
            priority: 10,
            fn: async () => { called.push('second'); },
        });

        const event: PreToolUseEvent = {
            type: 'PreToolUse',
            toolName: 'shell',
            toolInput: { command: 'ls' },
            ctx: { sessionId: 's1', userId: 'u1', tenantId: 't1' },
        };
        const { aborted } = await registry.run(event);
        expect(aborted).toBe(true);
        expect(called).toEqual(['first']);
    });

    it('priority 排序正确', async () => {
        const order: number[] = [];
        for (const priority of [30, 10, 20]) {
            registry.register<SessionEndEvent>({
                id: `hook-p${priority}`,
                eventType: 'SessionEnd',
                priority,
                fn: async () => { order.push(priority); },
            });
        }
        const event: SessionEndEvent = {
            type: 'SessionEnd',
            totalSteps: 5,
            ctx: { sessionId: 's1', userId: 'u1', tenantId: 't1' },
        };
        await registry.run(event);
        expect(order).toEqual([10, 20, 30]);
    });

    it('hook 抛异常不中止后续 hook', async () => {
        const called: string[] = [];
        registry.register<SessionStartEvent>({
            id: 'throws',
            eventType: 'SessionStart',
            priority: 0,
            fn: async () => { throw new Error('oops'); },
        });
        registry.register<SessionStartEvent>({
            id: 'continues',
            eventType: 'SessionStart',
            priority: 10,
            fn: async () => { called.push('ok'); },
        });

        const event: SessionStartEvent = {
            type: 'SessionStart',
            ctx: { sessionId: 's1', userId: 'u1', tenantId: 't1' },
        };
        const { aborted } = await registry.run(event);
        expect(aborted).toBe(false);
        expect(called).toEqual(['ok']);
    });

    it('modified 事件透传到下一个 hook', async () => {
        registry.register<UserPromptSubmitEvent>({
            id: 'modifier',
            eventType: 'UserPromptSubmit',
            priority: 0,
            fn: async (e) => ({
                modified: { ...e, prompt: 'MODIFIED: ' + e.prompt },
            }),
        });

        let receivedPrompt = '';
        registry.register<UserPromptSubmitEvent>({
            id: 'receiver',
            eventType: 'UserPromptSubmit',
            priority: 10,
            fn: async (e) => { receivedPrompt = e.prompt; },
        });

        const event: UserPromptSubmitEvent = {
            type: 'UserPromptSubmit',
            prompt: 'hello',
            rawPrompt: 'hello',
            ctx: { sessionId: 's1', userId: 'u1', tenantId: 't1' },
        };
        const { event: finalEvent } = await registry.run(event);
        expect((finalEvent as UserPromptSubmitEvent).prompt).toBe('MODIFIED: hello');
        expect(receivedPrompt).toBe('MODIFIED: hello');
    });

    it('unregister 移除 hook', async () => {
        const called: string[] = [];
        registry.register<SessionStartEvent>({
            id: 'to-remove',
            eventType: 'SessionStart',
            fn: async () => { called.push('should-not-run'); },
        });
        registry.unregister('to-remove');

        const event: SessionStartEvent = {
            type: 'SessionStart',
            ctx: { sessionId: 's1', userId: 'u1', tenantId: 't1' },
        };
        await registry.run(event);
        expect(called).toEqual([]);
    });

    it('stats 返回各类型数量', () => {
        registry.register<SessionStartEvent>({ id: 'a', eventType: 'SessionStart', fn: async () => {} });
        registry.register<SessionStartEvent>({ id: 'b', eventType: 'SessionStart', fn: async () => {} });
        registry.register<SessionEndEvent>({ id: 'c', eventType: 'SessionEnd', fn: async () => {} });
        expect(registry.stats()).toEqual({ SessionStart: 2, SessionEnd: 1 });
    });

    it('没有注册 hook 时 run 不报错', async () => {
        const event: SessionStartEvent = {
            type: 'SessionStart',
            ctx: { sessionId: 's1', userId: 'u1', tenantId: 't1' },
        };
        const result = await registry.run(event);
        expect(result.aborted).toBe(false);
    });
});

// ─── SandboxHook ──────────────────────────────────────────────────────────────

describe('SandboxHook', () => {
    const hook = createSandboxHook({
        enabled: true,
        mode: 'blocklist',
    });

    it('允许安全命令', async () => {
        const event: PreToolUseEvent = {
            type: 'PreToolUse',
            toolName: 'shell',
            toolInput: { command: 'ls -la' },
            ctx: { sessionId: 's1', userId: 'u1', tenantId: 't1' },
        };
        const result = await hook(event);
        expect(result).toBeUndefined();
    });

    it('拦截 rm -rf', async () => {
        const event: PreToolUseEvent = {
            type: 'PreToolUse',
            toolName: 'shell',
            toolInput: { command: 'rm -rf /' },
            ctx: { sessionId: 's1', userId: 'u1', tenantId: 't1' },
        };
        const result = await hook(event) as HookResult;
        expect(result?.abort).toBe(true);
    });

    it('非 shell 工具不拦截', async () => {
        const event: PreToolUseEvent = {
            type: 'PreToolUse',
            toolName: 'file_manager',
            toolInput: { path: '/tmp', command: 'rm -rf /' },
            ctx: { sessionId: 's1', userId: 'u1', tenantId: 't1' },
        };
        const result = await hook(event);
        expect(result).toBeUndefined();
    });

    it('sandbox 禁用时不拦截任何命令', async () => {
        const disabledHook = createSandboxHook({ enabled: false, mode: 'blocklist' });
        const event: PreToolUseEvent = {
            type: 'PreToolUse',
            toolName: 'shell',
            toolInput: { command: 'rm -rf /' },
            ctx: { sessionId: 's1', userId: 'u1', tenantId: 't1' },
        };
        const result = await disabledHook(event);
        expect(result).toBeUndefined();
    });
});

// ─── AgentRouter ──────────────────────────────────────────────────────────────

describe('AgentRouter', () => {
    it('forceLegacy=true 时走 legacy', async () => {
        const { AgentRouter, EnvFeatureFlagService } = await import('../src/core/agent/router.js');
        const legacyCalled: string[] = [];
        const claudeCalled: string[] = [];

        const legacyFactory = () => ({
            // eslint-disable-next-line require-yield
            async *execute() { legacyCalled.push('legacy'); },
            async *resume() {},
            async fork() { return ''; },
            async checkpoint() { return ''; },
            capabilities: () => ({ supportsStreaming: true, supportsFork: false, supportsCheckpoint: false, maxContextTokens: 100000 }),
        });
        const claudeFactory = () => ({
            // eslint-disable-next-line require-yield
            async *execute() { claudeCalled.push('claude'); },
            async *resume() {},
            async fork() { return ''; },
            async checkpoint() { return ''; },
            capabilities: () => ({ supportsStreaming: true, supportsFork: false, supportsCheckpoint: false, maxContextTokens: 200000 }),
        });

        const flags = new EnvFeatureFlagService({ 'claude-managed-agent': true });
        const router = new AgentRouter({
            legacyFactory,
            claudeFactory,
            featureFlags: flags,
            logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
        });

        // forceLegacy=true → legacy 即使 provider=anthropic
        const gen = router.execute({
            message: 'hi',
            sessionId: 's1', userId: 'u1', tenantId: 't1',
            provider: 'anthropic',
            forceLegacy: true,
        });
        for await (const _ of gen) { /* consume */ }
        expect(legacyCalled).toEqual(['legacy']);
        expect(claudeCalled).toEqual([]);
    });

    it('flag 未开启时 anthropic 也走 legacy', async () => {
        const { AgentRouter, EnvFeatureFlagService } = await import('../src/core/agent/router.js');
        const legacyCalled: string[] = [];
        const legacyFactory = () => ({
            // eslint-disable-next-line require-yield
            async *execute() { legacyCalled.push('legacy'); },
            async *resume() {},
            async fork() { return ''; },
            async checkpoint() { return ''; },
            capabilities: () => ({ supportsStreaming: true, supportsFork: false, supportsCheckpoint: false, maxContextTokens: 100000 }),
        });
        const flags = new EnvFeatureFlagService({ 'claude-managed-agent': false });
        const router = new AgentRouter({
            legacyFactory,
            featureFlags: flags,
            logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
        });
        const gen = router.execute({
            message: 'hi',
            sessionId: 's1', userId: 'u1', tenantId: 't1',
            provider: 'anthropic',
        });
        for await (const _ of gen) { /* consume */ }
        expect(legacyCalled).toEqual(['legacy']);
    });

    it('EnvFeatureFlagService 读取 env 变量', async () => {
        const { EnvFeatureFlagService } = await import('../src/core/agent/router.js');
        process.env['FEATURE_MY_FLAG'] = 'true';
        const svc = new EnvFeatureFlagService();
        expect(svc.isEnabled('my-flag')).toBe(true);
        delete process.env['FEATURE_MY_FLAG'];
    });
});
