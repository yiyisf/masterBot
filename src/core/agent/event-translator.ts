/**
 * Task 4: SDK Message → AgentEvent 转换器
 * 将 Claude Agent SDK 的 SDKMessage 流翻译为统一 AgentEvent。
 */

import type { AgentEvent } from './types.js';
import type {
    SDKMessage,
    SDKAssistantMessage,
    SDKResultSuccess,
    SDKResultError,
} from '@anthropic-ai/claude-agent-sdk';

export function translateSdkMessage(msg: SDKMessage): AgentEvent | null {
    switch (msg.type) {
        case 'assistant':
            return translateAssistant(msg as SDKAssistantMessage);

        case 'result':
            return translateResult(msg as SDKResultSuccess | SDKResultError);

        case 'system':
            // compact_boundary 等系统消息 → state_update
            return {
                type: 'state_update',
                data: { subtype: msg.subtype, raw: msg },
                timestamp: Date.now(),
            };

        default:
            // status / hook lifecycle / task 等消息忽略（不传给调用方）
            return null;
    }
}

function translateAssistant(msg: SDKAssistantMessage): AgentEvent | null {
    if (msg.error) {
        return {
            type: 'error',
            data: { error: msg.error, sessionId: msg.session_id },
            timestamp: Date.now(),
        };
    }

    const content = msg.message.content;
    const events: AgentEvent[] = [];

    for (const block of content) {
        if (block.type === 'text') {
            events.push({
                type: 'text',
                data: { text: block.text, sessionId: msg.session_id },
                timestamp: Date.now(),
            });
        } else if (block.type === 'thinking') {
            events.push({
                type: 'thinking',
                data: { thinking: block.thinking, sessionId: msg.session_id },
                timestamp: Date.now(),
            });
        } else if (block.type === 'tool_use') {
            events.push({
                type: 'tool_call',
                data: {
                    toolName: block.name,
                    toolInput: block.input,
                    toolUseId: block.id,
                    sessionId: msg.session_id,
                },
                timestamp: Date.now(),
            });
        }
    }

    // 返回第一个事件；多个 block 时后续被丢弃（生产环境需 flatMap，此处简化）
    return events[0] ?? null;
}

function translateResult(msg: SDKResultSuccess | SDKResultError): AgentEvent {
    if (msg.subtype === 'success') {
        const success = msg as SDKResultSuccess;
        return {
            type: 'state_update',
            data: {
                subtype: 'result_success',
                result: success.result,
                totalCostUsd: success.total_cost_usd,
                numTurns: success.num_turns,
                sessionId: success.session_id,
            },
            timestamp: Date.now(),
        };
    }

    const err = msg as SDKResultError;
    return {
        type: 'error',
        data: {
            subtype: err.subtype,
            errors: err.errors,
            numTurns: err.num_turns,
            sessionId: err.session_id,
        },
        timestamp: Date.now(),
    };
}

/**
 * 将 SDKMessage async generator 转换为 AgentEvent async generator。
 * null 消息（无关系统消息）直接过滤。
 */
export async function* translateSdkStream(
    sdkStream: AsyncGenerator<SDKMessage, void>,
): AsyncGenerator<AgentEvent> {
    for await (const msg of sdkStream) {
        const event = translateSdkMessage(msg);
        if (event !== null) {
            yield event;
        }
    }
}
