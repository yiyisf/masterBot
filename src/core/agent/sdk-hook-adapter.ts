/**
 * Task 2: SDK Hook 适配器
 * 将 SDK 的 hooks 配置格式桥接到我们的 HookRegistry。
 * SDK hook 事件名与我们 P2 HookEvent 类型一一对应。
 */

import type { HookCallback, HookCallbackMatcher, HookEvent as SdkHookEvent, SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { HookRegistry } from '../hooks/registry.js';
import type { HookContext } from '../hooks/types.js';

// SDK 支持的与我们 P2 实现完全对应的事件子集
const BRIDGED_EVENTS: SdkHookEvent[] = [
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'UserPromptSubmit',
    'SessionStart',
    'SessionEnd',
    'SubagentStart',
    'SubagentStop',
    'PreCompact',
    'PermissionRequest',
    'Stop',
    'Notification',
];

/**
 * 从 HookRegistry 构建 SDK Options.hooks 配置对象。
 * 每个桥接事件对应一个 HookCallbackMatcher，内部调用 registry.run()。
 */
export function buildSdkHooks(
    registry: HookRegistry,
    ctx: Pick<HookContext, 'sessionId' | 'userId' | 'tenantId'>,
): Partial<Record<SdkHookEvent, HookCallbackMatcher[]>> {
    const result: Partial<Record<SdkHookEvent, HookCallbackMatcher[]>> = {};

    for (const sdkEvent of BRIDGED_EVENTS) {
        const cb: HookCallback = async (input, _toolUseID, _opts): Promise<SyncHookJSONOutput> => {
            const hookEvent = mapSdkInputToHookEvent(sdkEvent, input, ctx);
            if (!hookEvent) return { continue: true };

            const { aborted } = await registry.run(hookEvent as Parameters<typeof registry.run>[0]);

            if (aborted) {
                if (sdkEvent === 'PreToolUse') {
                    return {
                        continue: false,
                        hookSpecificOutput: {
                            hookEventName: 'PreToolUse',
                            permissionDecision: 'deny' as const,
                            permissionDecisionReason: 'Blocked by masterBot sandbox policy',
                        },
                    };
                }
                return { continue: false };
            }

            return { continue: true };
        };

        result[sdkEvent] = [{ hooks: [cb] }];
    }

    return result;
}

type AnyInput = Record<string, unknown>;

function mapSdkInputToHookEvent(
    sdkEvent: SdkHookEvent,
    input: AnyInput,
    ctx: HookContext,
): object | null {
    switch (sdkEvent) {
        case 'PreToolUse':
            return {
                type: 'PreToolUse',
                toolName: input['tool_name'] as string,
                toolInput: (input['tool_input'] as Record<string, unknown>) ?? {},
                ctx,
            };
        case 'PostToolUse':
            return {
                type: 'PostToolUse',
                toolName: input['tool_name'] as string,
                toolInput: (input['tool_input'] as Record<string, unknown>) ?? {},
                result: input['tool_response'],
                durationMs: (input['duration_ms'] as number | undefined) ?? 0,
                ctx,
            };
        case 'PostToolUseFailure':
            return {
                type: 'PostToolUseFailure',
                toolName: input['tool_name'] as string,
                toolInput: (input['tool_input'] as Record<string, unknown>) ?? {},
                error: String(input['error'] ?? input['tool_response'] ?? ''),
                durationMs: (input['duration_ms'] as number | undefined) ?? 0,
                ctx,
            };
        case 'UserPromptSubmit':
            return {
                type: 'UserPromptSubmit',
                prompt: input['prompt'] as string ?? '',
                rawPrompt: input['prompt'] as string ?? '',
                ctx,
            };
        case 'SessionStart':
            return { type: 'SessionStart', ctx };
        case 'SessionEnd':
            return { type: 'SessionEnd', totalSteps: 0, ctx };
        case 'SubagentStart':
            return { type: 'SubagentStart', workerId: String(input['agent_id'] ?? ''), agentSpec: String(input['agent_type'] ?? ''), ctx };
        case 'SubagentStop':
            return { type: 'SubagentStop', workerId: String(input['agent_id'] ?? ''), outcome: 'success', ctx };
        case 'PreCompact':
            return { type: 'PreCompact', droppedCount: 0, ctx };
        case 'PermissionRequest':
            // resolve 是 hitl-hook 调用的回调；SDK 路径下审批结果由返回值决定，此处提供空实现防止运行时报错
            return {
                type: 'PermissionRequest',
                toolName: input['tool_name'] as string ?? '',
                reason: String(input['reason'] ?? ''),
                resolve: (_approved: boolean) => { /* no-op: 决策通过 SyncHookJSONOutput 返回值传递 */ },
                ctx,
            };
        case 'Stop':
            return { type: 'Stop', reason: 'answer', ctx };
        case 'Notification':
            return { type: 'Notification', level: 'info', message: String(input['message'] ?? ''), ctx };
        default:
            return null;
    }
}
