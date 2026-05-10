/**
 * Phase 2: 默认 Hook 注册器
 * 在应用启动时调用 setupDefaultHooks()，将内置 Hook 挂载到 globalHookRegistry。
 * Phase 3 ClaudeManagedAgent 上线后即可自动获益于这些 Hook。
 */

import { globalHookRegistry } from './registry.js';
import { createSandboxHook } from './builtin/sandbox-hook.js';
import {
    auditSessionStartHook,
    auditSessionEndHook,
    auditToolSuccessHook,
    auditToolFailureHook,
} from './builtin/audit-hook.js';
import {
    otelSessionStartHook,
    otelSessionEndHook,
    otelToolSuccessHook,
    otelToolFailureHook,
} from './builtin/otel-hook.js';
import { createRetryHook } from './builtin/retry-hook.js';
import type { SandboxConfig } from '../../skills/sandbox.js';
import type { Logger } from '../../types.js';

export interface DefaultHookOptions {
    sandbox?: SandboxConfig;
    logger: Logger;
}

export function setupDefaultHooks(opts: DefaultHookOptions): void {
    const registry = globalHookRegistry;

    // 5a: Sandbox — 最高优先级，拦截危险 shell 命令
    const sandboxConfig: SandboxConfig = opts.sandbox ?? { enabled: true, mode: 'blocklist' };
    registry.register({
        id: 'builtin:sandbox',
        eventType: 'PreToolUse',
        priority: 0,
        fn: createSandboxHook(sandboxConfig),
    });

    // 5e: Auto-retry logger (stub)
    registry.register({
        id: 'builtin:retry',
        eventType: 'PostToolUseFailure',
        priority: 0,
        fn: createRetryHook(opts.logger),
    });

    // 5f: Audit — session 生命周期
    registry.register({ id: 'builtin:audit:session-start', eventType: 'SessionStart', priority: 10, fn: auditSessionStartHook });
    registry.register({ id: 'builtin:audit:session-end',   eventType: 'SessionEnd',   priority: 10, fn: auditSessionEndHook });
    registry.register({ id: 'builtin:audit:tool-success',  eventType: 'PostToolUse',         priority: 10, fn: auditToolSuccessHook });
    registry.register({ id: 'builtin:audit:tool-failure',  eventType: 'PostToolUseFailure',  priority: 10, fn: auditToolFailureHook });

    // 5g: OTel — session + tool span
    registry.register({ id: 'builtin:otel:session-start', eventType: 'SessionStart', priority: 20, fn: otelSessionStartHook });
    registry.register({ id: 'builtin:otel:session-end',   eventType: 'SessionEnd',   priority: 20, fn: otelSessionEndHook });
    registry.register({ id: 'builtin:otel:tool-success',  eventType: 'PostToolUse',         priority: 20, fn: otelToolSuccessHook });
    registry.register({ id: 'builtin:otel:tool-failure',  eventType: 'PostToolUseFailure',  priority: 20, fn: otelToolFailureHook });

    opts.logger.info(`[hooks] 注册内置 Hooks：${JSON.stringify(registry.stats())}`);
}
