/**
 * Task 5e: Auto-Retry Hook
 * 在 PostToolUseFailure 时，对 retryable 错误记录重试意图。
 * 实际重试逻辑由 Agent 主循环根据 HookResult 决定（当前返回 void，不改变流程）。
 * Phase 4 将引入完整重试状态机。
 */

import type { PostToolUseFailureEvent, HookResult } from '../types.js';
import type { Logger } from '../../../types.js';

export interface RetryHookConfig {
    maxRetries?: number;
    retryablePatterns?: RegExp[];
}

const DEFAULT_RETRYABLE: RegExp[] = [
    /rate.?limit/i,
    /timeout/i,
    /econnreset/i,
    /econnrefused/i,
    /503/,
    /429/,
];

export function createRetryHook(logger: Logger, config: RetryHookConfig = {}) {
    const patterns = config.retryablePatterns ?? DEFAULT_RETRYABLE;

    return async (event: PostToolUseFailureEvent): Promise<HookResult | void> => {
        const isRetryable = patterns.some(p => p.test(event.error));
        if (isRetryable) {
            logger.info?.(`[retry-hook] tool=${event.toolName} error="${event.error}" → retryable, Phase 4 will retry`);
        }
        // Phase 4 TODO: return { modified: { retryAfterMs: ... } } to trigger retry
        return;
    };
}
