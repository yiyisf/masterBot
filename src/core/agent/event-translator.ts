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

/** 将单条 SDKAssistantMessage 的所有 content blocks 逐一 yield。 */
async function* translateAssistantBlocks(msg: SDKAssistantMessage): AsyncGenerator<AgentEvent> {
    if (msg.error) {
        yield {
            type: 'error',
            data: { error: msg.error, sessionId: msg.session_id },
            timestamp: Date.now(),
        };
        return;
    }

    for (const block of msg.message.content) {
        if (block.type === 'text') {
            yield {
                type: 'text',
                data: { text: block.text, sessionId: msg.session_id },
                timestamp: Date.now(),
            };
        } else if (block.type === 'thinking') {
            yield {
                type: 'thinking',
                data: { thinking: block.thinking, sessionId: msg.session_id },
                timestamp: Date.now(),
            };
        } else if (block.type === 'tool_use') {
            yield {
                type: 'tool_call',
                data: {
                    toolName: block.name,
                    toolInput: block.input,
                    toolUseId: block.id,
                    sessionId: msg.session_id,
                },
                timestamp: Date.now(),
            };
        }
    }
}

/**
 * 将 SDKMessage async generator 转换为 AgentEvent async generator。
 * assistant 消息的每个 content block 单独 yield，避免多 block 时内容丢失。
 */
export async function* translateSdkStream(
    sdkStream: AsyncGenerator<SDKMessage, void>,
): AsyncGenerator<AgentEvent> {
    for await (const msg of sdkStream) {
        if (msg.type === 'assistant') {
            yield* translateAssistantBlocks(msg as SDKAssistantMessage);
        } else if (msg.type === 'result') {
            yield translateResult(msg as SDKResultSuccess | SDKResultError);
        } else if (msg.type === 'system') {
            yield {
                type: 'state_update',
                data: { subtype: (msg as { subtype?: string }).subtype, raw: msg },
                timestamp: Date.now(),
            };
            // status / hook lifecycle / task 等消息忽略
        }
    }
}
