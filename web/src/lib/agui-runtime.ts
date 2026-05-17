"use client";

/**
 * AG-UI Runtime
 *
 * 将后端 SSE 流（自定义 chunk format）解析为 AG-UI 兼容的事件序列，
 * 供新版 Chat UI 消费。保持与现有 assistant-runtime.ts 并行，不破坏现有功能。
 *
 * AG-UI 事件类型（按规范简化实现）：
 *   TEXT_MESSAGE_START / CHUNK / END
 *   TOOL_CALL_START / ARGS_DELTA / END
 *   THINKING_START / CHUNK / END
 *   STATE_UPDATE
 *   HUMAN_IN_THE_LOOP_REQUEST / RESPONSE
 *   RUN_FINISHED
 */

import { streamApi } from "./api";

// ── Event Types ─────────────────────────────────────────────────────────────

export type AguiEventType =
  | 'TEXT_MESSAGE_START'
  | 'TEXT_MESSAGE_CHUNK'
  | 'TEXT_MESSAGE_END'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_ARGS_DELTA'
  | 'TOOL_CALL_END'
  | 'THINKING_START'
  | 'THINKING_CHUNK'
  | 'THINKING_END'
  | 'STATE_UPDATE'
  | 'HUMAN_IN_THE_LOOP_REQUEST'
  | 'HUMAN_IN_THE_LOOP_RESPONSE'
  | 'RUN_FINISHED'
  | 'RUN_ERROR';

export interface AguiEvent {
  type: AguiEventType;
  messageId?: string;
  toolCallId?: string;
  toolName?: string;
  delta?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  state?: Record<string, unknown>;
  interruptId?: string;
  interruptReason?: string;
  error?: string;
}

// ── Request ─────────────────────────────────────────────────────────────────

export interface AguiRunOptions {
  message: string;
  sessionId: string;
  history?: Array<{ role: string; content: string }>;
  attachments?: unknown[];
  abortSignal?: AbortSignal;
}

// ── Runtime ──────────────────────────────────────────────────────────────────

export async function* runAgui(options: AguiRunOptions): AsyncGenerator<AguiEvent> {
  const { message, sessionId, history, attachments, abortSignal } = options;
  let msgCounter = 0;
  const nextId = () => `msg-${++msgCounter}-${Date.now()}`;

  let currentTextId: string | null = null;
  let currentThinkingId: string | null = null;
  const toolCallIds: Map<string, string> = new Map(); // toolName → toolCallId

  try {
    for await (const chunk of streamApi('/api/chat/stream', {
      message,
      sessionId,
      history: history ?? [],
      attachments: attachments ?? [],
    }, abortSignal)) {
      const c = chunk as Record<string, unknown>;

      switch (c.type) {
        case 'content': {
          if (!currentTextId) {
            currentTextId = nextId();
            yield { type: 'TEXT_MESSAGE_START', messageId: currentTextId };
          }
          yield { type: 'TEXT_MESSAGE_CHUNK', messageId: currentTextId, delta: String(c.content ?? '') };
          break;
        }

        case 'thought': {
          if (!currentThinkingId) {
            currentThinkingId = nextId();
            yield { type: 'THINKING_START', messageId: currentThinkingId };
          }
          yield { type: 'THINKING_CHUNK', messageId: currentThinkingId, delta: String(c.content ?? '') };
          break;
        }

        case 'action': {
          const toolName = String(c.tool ?? c.toolName ?? 'unknown');
          const toolCallId = nextId();
          toolCallIds.set(toolName, toolCallId);
          yield {
            type: 'TOOL_CALL_START',
            toolCallId,
            toolName,
            args: (c.input as Record<string, unknown>) ?? {},
          };
          break;
        }

        case 'observation': {
          // Try to match back to a tool call
          const toolName = String(c.tool ?? '');
          const toolCallId = toolCallIds.get(toolName) ?? nextId();
          yield { type: 'TOOL_CALL_END', toolCallId, result: c.content };
          break;
        }

        case 'plan': {
          yield {
            type: 'STATE_UPDATE',
            state: { plan: c.content },
          };
          break;
        }

        case 'interrupt': {
          yield {
            type: 'HUMAN_IN_THE_LOOP_REQUEST',
            interruptId: String(c.interruptId ?? nextId()),
            toolName: String(c.toolName ?? ''),
            args: (c.toolInput as Record<string, unknown>) ?? {},
            interruptReason: String(c.interruptReason ?? c.content ?? '操作需要确认'),
          };
          break;
        }

        case 'answer': {
          // Close any open text stream, then emit final answer
          if (currentTextId) {
            yield { type: 'TEXT_MESSAGE_END', messageId: currentTextId };
            currentTextId = null;
          }
          if (currentThinkingId) {
            yield { type: 'THINKING_END', messageId: currentThinkingId };
            currentThinkingId = null;
          }
          // Emit the answer as a complete message
          const answerId = nextId();
          yield { type: 'TEXT_MESSAGE_START', messageId: answerId };
          yield { type: 'TEXT_MESSAGE_CHUNK', messageId: answerId, delta: String(c.content ?? '') };
          yield { type: 'TEXT_MESSAGE_END', messageId: answerId };
          break;
        }

        case 'context_compressed': {
          yield {
            type: 'STATE_UPDATE',
            state: { contextCompressed: { droppedCount: c.droppedCount, summary: c.content } },
          };
          break;
        }

        default:
          // Pass through unrecognised chunks as state updates
          if (c.type && c.type !== 'meta') {
            yield { type: 'STATE_UPDATE', state: c as Record<string, unknown> };
          }
      }
    }

    yield { type: 'RUN_FINISHED' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'RUN_ERROR', error: message };
  }
}
