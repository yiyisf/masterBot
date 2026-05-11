/**
 * Task 5g: OTel Hook
 * 将 Hook 事件桥接到 OtelObserver，为每个 agent session 和 tool call 创建 span。
 */

import type {
    SessionStartEvent,
    SessionEndEvent,
    PostToolUseEvent,
    PostToolUseFailureEvent,
    HookResult,
} from '../types.js';
import { otelObserver } from '../../../observability/otel.js';
import type { Span } from '@opentelemetry/api';

/** sessionId → agent-level Span */
const sessionSpans = new Map<string, Span>();

export async function otelSessionStartHook(event: SessionStartEvent): Promise<HookResult | void> {
    const span = otelObserver.startAgentSpan({
        sessionId: event.ctx.sessionId,
        userId: event.ctx.userId,
    });
    sessionSpans.set(event.ctx.sessionId, span);
}

export async function otelSessionEndHook(event: SessionEndEvent): Promise<HookResult | void> {
    const span = sessionSpans.get(event.ctx.sessionId);
    if (!span) return;

    otelObserver.endSpan(span, { result: `steps=${event.totalSteps}` });
    sessionSpans.delete(event.ctx.sessionId);
}

export async function otelToolSuccessHook(event: PostToolUseEvent): Promise<HookResult | void> {
    const parentSpan = sessionSpans.get(event.ctx.sessionId);
    const toolSpan = otelObserver.startToolSpan(event.toolName, parentSpan ?? createNoopSpan());
    otelObserver.endSpan(toolSpan, { result: 'ok' });
}

export async function otelToolFailureHook(event: PostToolUseFailureEvent): Promise<HookResult | void> {
    const parentSpan = sessionSpans.get(event.ctx.sessionId);
    const toolSpan = otelObserver.startToolSpan(event.toolName, parentSpan ?? createNoopSpan());
    otelObserver.endSpan(toolSpan, { error: event.error });
}

/** 没有 parent span 时提供一个临时 root span（不理想，但保证不崩溃） */
function createNoopSpan(): Span {
    return otelObserver.startGenericSpan('noop');
}
