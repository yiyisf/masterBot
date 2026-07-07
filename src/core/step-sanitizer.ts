/**
 * step-sanitizer.ts — ExecutionStep 传输层瘦身
 *
 * observation 等步骤的 content/toolOutput 可能携带 MB 级数据（MCP 响应、
 * 文件读取、skill 输出），直接下发会导致前端渲染卡死。本模块在传输边界
 * （SSE/WS 写出、AgentPool 步骤缓存）统一截断展示内容。
 *
 * 注意：只影响 UI 展示层；LLM 上下文中的 tool result 不经过此处，保持完整。
 */

import type { ExecutionStep } from '../types.js';

/** 单步 content 最大下发字符数（可用 STREAM_MAX_STEP_CHARS 环境变量覆盖） */
export const MAX_STEP_CONTENT_CHARS = Number(process.env.STREAM_MAX_STEP_CHARS) > 0
    ? Number(process.env.STREAM_MAX_STEP_CHARS)
    : 4000;

/** toolOutput 序列化后最大下发字符数 */
export const MAX_TOOL_OUTPUT_CHARS = Number(process.env.STREAM_MAX_TOOL_OUTPUT_CHARS) > 0
    ? Number(process.env.STREAM_MAX_TOOL_OUTPUT_CHARS)
    : 2000;

/** 流式正文与最终回答必须保持完整，不参与截断 */
const FULL_CONTENT_TYPES = new Set(['content', 'answer']);

/**
 * 截断单个步骤用于传输/缓存。未超限时原样返回（保持引用相等，便于前端 memo）。
 */
export function sanitizeStepForStream(step: ExecutionStep): ExecutionStep {
    if (FULL_CONTENT_TYPES.has(step.type)) return step;

    let changed = false;
    let content = step.content;
    if (typeof content === 'string' && content.length > MAX_STEP_CONTENT_CHARS) {
        content = content.slice(0, MAX_STEP_CONTENT_CHARS)
            + `\n\n…[输出已截断，完整内容共 ${step.content.length} 字符，模型已收到完整结果]`;
        changed = true;
    }

    let toolOutput = (step as { toolOutput?: unknown }).toolOutput;
    if (toolOutput !== undefined) {
        try {
            const serialized = JSON.stringify(toolOutput);
            if (serialized === undefined || serialized.length > MAX_TOOL_OUTPUT_CHARS) {
                toolOutput = { _truncated: true, originalChars: serialized?.length ?? -1 };
                changed = true;
            }
        } catch {
            // 循环引用等不可序列化对象：直接丢弃，避免 JSON.stringify(step) 在写出时抛错
            toolOutput = { _truncated: true, originalChars: -1 };
            changed = true;
        }
    }

    if (!changed) return step;
    return { ...step, content, toolOutput } as ExecutionStep;
}
