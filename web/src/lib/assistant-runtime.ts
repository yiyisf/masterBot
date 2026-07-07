import {
    ChatModelAdapter,
    ChatModelRunOptions,
    ChatModelRunResult,
    ThreadAssistantMessagePart,
} from "@assistant-ui/react";
import { streamApi } from "./api";
import { nanoid } from "nanoid";

/** 子 Agent 托管任务的聚合状态（data part: name="subTask"） */
export interface SubTaskData {
    delegatedFrom: string;
    instanceId: string;
    steps: Array<Record<string, unknown>>;
    status: 'running' | 'completed' | 'failed';
    startTime: number;
    endTime?: number;
    graderScore?: number;
}

/** DAG 任务事件的聚合状态（data part: name="tasks"） */
export interface TasksData {
    events: Array<{ type: string; taskId?: string; content: string }>;
}

/**
 * Custom Runtime adapter connecting to backend SSE service.
 *
 * 后端 SSE chunk 映射为 assistant-ui 标准 message parts：
 * - thought → reasoning part（官方 Reasoning/GroupedParts 折叠渲染）
 * - action/observation → tool-call part（observation 回填 result，
 *   具名工具走 tool-ui.tsx 注册的富 UI，其余走 ToolFallback）
 * - plan/tasks/subTask/grading/workflow/contextCompressed/interrupt →
 *   data part（chat/data-renderers.tsx 注册的 renderer 内联渲染）
 * - content/answer → text part
 * meta/suggestions 保留在 metadata.custom。
 */
export class MyRuntimeAdapter implements ChatModelAdapter {
    private sessionId: string;

    constructor(sessionId?: string) {
        this.sessionId = sessionId || nanoid();
    }

    async *run(options: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult, void> {
        const { messages, abortSignal } = options;
        const lastMessage = messages[messages.length - 1];

        // Extract attachments from the last message (user message)
        const attachments = (lastMessage as any).attachments || [];

        // Build multimodal content array from message content parts
        // @assistant-ui/react uses type:"image" internally; we map to type:"image_url" for the backend
        const contentParts = Array.isArray(lastMessage.content) ? lastMessage.content : [];
        const hasNonText = contentParts.some((p: any) => p.type !== "text");

        const userContent = contentParts.length > 0 && contentParts[0]?.type === "text"
            ? (contentParts[0] as any).text
            : (typeof lastMessage.content === "string" ? lastMessage.content : "");

        // Build messageContent for multimodal requests
        const messageContent = hasNonText ? contentParts.map((p: any) => {
            if (p.type === "image" && p.image) {
                return { type: "image_url" as const, image_url: { url: p.image } };
            }
            if (p.type === "image_url") {
                return { type: "image_url" as const, image_url: { url: p.image_url?.url ?? "" } };
            }
            return { type: "text" as const, text: p.text ?? "" };
        }) : undefined;

        // Transform history for backend（工具调用/思考过程不回传，正文优先取 text part）
        const history = messages.slice(0, -1).map(m => ({
            role: m.role,
            content: (m.content.find((c: any) => c.type === "text") as any)?.text ?? "",
        }));

        // 按到达顺序累积的 message parts。每次 yield 全量替换（assistant-ui 协议要求）。
        const parts: ThreadAssistantMessagePart[] = [];
        let textIdx = -1;          // 流式正文 text part 的位置
        let pendingToolIdx = -1;   // 最近一个等待 observation 回填的 tool-call
        let tasksIdx = -1;         // DAG 任务事件聚合 data part 的位置
        const subTaskIdxByInstance = new Map<string, number>();
        let assistantMessageId: string | null = null;
        let suggestions: string[] | null = null;

        const buildYield = (): ChatModelRunResult => ({
            content: [...parts],
            metadata: { custom: { assistantMessageId, suggestions } },
        });

        const appendContent = (delta: string) => {
            if (textIdx < 0) {
                textIdx = parts.length;
                parts.push({ type: "text", text: delta });
            } else {
                const prev = parts[textIdx] as { type: "text"; text: string };
                parts[textIdx] = { type: "text", text: prev.text + delta };
            }
        };

        // 渲染节流：content token 高频到达时按最小间隔合并 yield，
        // 避免每个 token 触发一次全量 re-render 导致大输出场景页面卡死。
        // 非 content 的结构性步骤（thought/action/observation 等）立即 yield。
        const YIELD_MIN_INTERVAL_MS = 50;
        let lastYieldTime = 0;

        try {
            const requestBody: Record<string, unknown> = {
                message: userContent,
                sessionId: this.sessionId,
                history: history,
                attachments: attachments.map((a: any) => ({
                    id: a.id,
                    name: a.name,
                    type: a.contentType,
                    url: (a as any).url
                }))
            };
            if (messageContent) {
                requestBody.messageContent = messageContent;
            }

            for await (const chunk of streamApi("/api/chat/stream", requestBody, abortSignal)) {
                if (chunk.type === "interrupt") {
                    // Human-in-the-Loop: agent 挂起等待用户应答（危险操作确认 / ask_user 提问）。
                    // 必须排在 delegatedFrom 之前：子 Agent 的 interrupt 也要弹出顶层应答卡片。
                    parts.push({
                        type: "data",
                        name: "interrupt",
                        data: {
                            id: chunk.interruptId,
                            tool: chunk.toolName,
                            args: chunk.toolInput ?? {},
                            reason: chunk.interruptReason ?? chunk.content ?? '操作需要确认',
                            // 应答必须发往 interrupt 实际挂起的 session（子 Agent 与 Chat session 不同）
                            sessionId: chunk.sessionId,
                            kind: chunk.interruptKind ?? 'approval',
                            options: chunk.toolInput?.options,
                            resolved: null, // null = pending user response
                        },
                    });
                    yield buildYield();

                } else if (chunk.delegatedFrom && chunk.harnessInstanceId) {
                    // 子 Agent 步骤：聚合到子任务 data part。
                    // 必须排在 content/thought/action 等类型分支之前，
                    // 否则子 Agent 步骤会被父级分支拦截（content 混入父回答正文、
                    // thought/action/observation 混入父步骤列表），子任务面板只剩 answer。
                    const instanceId = chunk.harnessInstanceId as string;
                    const idx = subTaskIdxByInstance.get(instanceId) ?? -1;
                    if (idx >= 0) {
                        // 不可变更新，保证下游 memo 组件能感知变化
                        const prev = (parts[idx] as { type: "data"; name: string; data: SubTaskData }).data;
                        const next: SubTaskData = { ...prev, steps: [...prev.steps, chunk] };
                        if (chunk.type === 'answer') {
                            next.status = 'completed';
                            next.endTime = Date.now();
                        }
                        if (chunk.type === 'grade_result') {
                            try {
                                const graderResult = JSON.parse(chunk.content ?? '{}');
                                next.graderScore = graderResult.overallScore;
                            } catch { /* ignore */ }
                        }
                        parts[idx] = { type: "data", name: "subTask", data: next };
                    } else {
                        subTaskIdxByInstance.set(instanceId, parts.length);
                        parts.push({
                            type: "data",
                            name: "subTask",
                            data: {
                                delegatedFrom: chunk.delegatedFrom,
                                instanceId,
                                steps: [chunk],
                                status: 'running',
                                startTime: Date.now(),
                            } satisfies SubTaskData,
                        });
                    }
                    yield buildYield();

                } else if (chunk.type === "content") {
                    appendContent(chunk.content);
                    const now = Date.now();
                    if (now - lastYieldTime >= YIELD_MIN_INTERVAL_MS) {
                        lastYieldTime = now;
                        yield buildYield();
                    }

                } else if (chunk.type === "thought") {
                    parts.push({ type: "reasoning", text: chunk.content });
                    yield buildYield();

                } else if (chunk.type === "plan") {
                    try {
                        const planSteps = typeof chunk.content === 'string' ? JSON.parse(chunk.content) : chunk.content;
                        parts.push({ type: "data", name: "plan", data: planSteps });
                    } catch {
                        console.warn("Failed to parse plan:", chunk.content);
                        parts.push({ type: "data", name: "plan", data: ["Detail hidden"] });
                    }
                    yield buildYield();

                } else if (chunk.type === "action") {
                    const args = chunk.toolInput ?? {};
                    pendingToolIdx = parts.length;
                    parts.push({
                        type: "tool-call",
                        toolCallId: nanoid(),
                        toolName: chunk.toolName || "tool",
                        args,
                        argsText: JSON.stringify(args),
                    });
                    yield buildYield();

                } else if (chunk.type === "observation") {
                    if (pendingToolIdx >= 0) {
                        // 用新对象替换而非原地修改，保证下游 memo 组件能感知变化
                        const prev = parts[pendingToolIdx] as Extract<ThreadAssistantMessagePart, { type: "tool-call" }>;
                        const result = chunk.content ?? chunk.result ?? chunk.toolOutput ?? "";
                        parts[pendingToolIdx] = {
                            ...prev,
                            result,
                            ...(chunk.duration !== undefined
                                ? { artifact: { duration: chunk.duration } }
                                : {}),
                        };
                        pendingToolIdx = -1;
                    }
                    yield buildYield();

                } else if (chunk.type === "task_created" || chunk.type === "task_completed" || chunk.type === "task_failed") {
                    const event = { type: chunk.type, taskId: chunk.taskId, content: chunk.content };
                    if (tasksIdx < 0) {
                        tasksIdx = parts.length;
                        parts.push({ type: "data", name: "tasks", data: { events: [event] } satisfies TasksData });
                    } else {
                        const prev = (parts[tasksIdx] as { type: "data"; name: string; data: TasksData }).data;
                        parts[tasksIdx] = { type: "data", name: "tasks", data: { events: [...prev.events, event] } };
                    }
                    yield buildYield();

                } else if (chunk.type === "meta") {
                    if (chunk.assistantMessageId) {
                        assistantMessageId = chunk.assistantMessageId;
                    }
                    yield buildYield();

                } else if (chunk.type === "suggestions") {
                    suggestions = chunk.items || [];
                    yield buildYield();

                } else if (chunk.type === "context_compressed") {
                    // 上下文压缩通知
                    parts.push({
                        type: "data",
                        name: "contextCompressed",
                        data: {
                            droppedCount: chunk.droppedCount ?? 0,
                            summary: chunk.content ?? '对话历史已压缩',
                        },
                    });
                    yield buildYield();

                } else if (chunk.type === "workflow_generated") {
                    parts.push({
                        type: "data",
                        name: "workflow",
                        data: {
                            workflow: chunk.workflow,
                            subWorkflows: chunk.subWorkflows,
                            validation: chunk.validation,
                            allValid: chunk.allValid,
                            explanation: chunk.explanation,
                        },
                    });
                    yield buildYield();

                } else if (chunk.type === "grading" || chunk.type === "grade_result") {
                    // Harness Grader 评分步骤
                    parts.push({
                        type: "data",
                        name: "grading",
                        data: { type: chunk.type, content: chunk.content },
                    });
                    yield buildYield();

                } else if (chunk.type === "answer") {
                    // Final answer replaces any partial content chunks
                    if (textIdx < 0) {
                        textIdx = parts.length;
                        parts.push({ type: "text", text: chunk.content });
                    } else {
                        parts[textIdx] = { type: "text", text: chunk.content };
                    }
                    yield buildYield();
                }
            }
            // 流结束：flush 节流期间可能被跳过的最后一批 content
            yield buildYield();
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log('Fetch aborted');
            } else {
                console.error("MyRuntimeAdapter Error:", error);
                yield {
                    content: [...parts, { type: "text", text: "抱歉，发生了错误。请检查后端连接。" }],
                };
            }
        }
    }
}
