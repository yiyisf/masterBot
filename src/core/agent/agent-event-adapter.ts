/**
 * AgentEvent → ExecutionStep 适配器
 * 将 IAgent.execute() 输出的 AgentEvent 转换为现有 GatewayServer SSE 期望的 ExecutionStep 格式。
 * 保证前端无需改动即可接收 ClaudeManagedAgent 的输出。
 */

import type { AgentEvent } from './types.js';
import type { ExecutionStep } from '../../types.js';

export function agentEventToExecutionStep(event: AgentEvent): ExecutionStep | null {
    const base = { timestamp: new Date(event.timestamp) };
    const data = event.data as Record<string, unknown>;

    switch (event.type) {
        case 'text': {
            const text = (data['text'] as string | undefined) ?? '';
            // 最后一条 result_success 会作为 answer
            if (data['subtype'] === 'result_success') {
                return { ...base, type: 'answer', content: (data['result'] as string | undefined) ?? text };
            }
            return { ...base, type: 'content', content: text };
        }

        case 'thinking':
            return {
                ...base,
                type: 'thought',
                content: (data['thinking'] as string | undefined) ?? '',
            };

        case 'tool_call':
            return {
                ...base,
                type: 'action',
                content: `调用工具: ${data['toolName'] as string}`,
                toolName: data['toolName'] as string | undefined,
                toolInput: data['toolInput'] as Record<string, unknown> | undefined,
            };

        case 'tool_result':
            return {
                ...base,
                type: 'observation',
                content: typeof data['result'] === 'string'
                    ? data['result']
                    : JSON.stringify(data['result']),
                toolName: data['toolName'] as string | undefined,
            };

        case 'state_update': {
            const subtype = data['subtype'] as string | undefined;
            if (subtype === 'result_success') {
                return { ...base, type: 'answer', content: (data['result'] as string | undefined) ?? '' };
            }
            if (subtype === 'context_compressed') {
                return {
                    ...base,
                    type: 'context_compressed' as any,
                    content: (data['result'] as string | undefined) ?? '',
                    droppedCount: data['droppedCount'] as number | undefined,
                };
            }
            // 透传 plan/task_*/interrupt/grading/grade_result 等类型
            if (subtype && subtype !== 'meta') {
                return { ...base, type: subtype as any, content: (data['result'] as string | undefined) ?? '', ...(data as any) };
            }
            return { ...base, type: 'meta', content: (data['result'] as string | undefined) ?? JSON.stringify(data) };
        }

        case 'error':
            return {
                ...base,
                type: 'meta',
                content: `[SDK Error] ${JSON.stringify(data)}`,
            };

        default:
            return null;
    }
}

/**
 * 将 AgentEvent async generator 适配为 ExecutionStep async generator。
 * 过滤掉 null 结果（无需呈现的内部消息）。
 */
export async function* adaptAgentEvents(
    events: AsyncGenerator<AgentEvent>,
): AsyncGenerator<ExecutionStep> {
    for await (const event of events) {
        const step = agentEventToExecutionStep(event);
        if (step !== null) {
            yield step;
        }
    }
}
