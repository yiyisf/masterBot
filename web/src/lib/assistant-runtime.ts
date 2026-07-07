import { ChatModelAdapter, ChatModelRunOptions, ChatModelRunResult } from "@assistant-ui/react";
import { streamApi } from "./api";
import { nanoid } from "nanoid";

/**
 * Custom Runtime adapter connecting to backend SSE service
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

        // Transform history for backend
        const history = messages.slice(0, -1).map(m => ({
            role: m.role,
            content: m.content[0]?.type === "text" ? m.content[0].text : "",
        }));

        let currentContent = "";
        const currentSteps: any[] = [];
        let assistantMessageId: string | null = null;
        let suggestions: string[] | null = null;

        // Helper: build a yield payload with current state
        // NOTE: content array only contains text to avoid confusing @assistant-ui/react's
        // tool-call state machine, which prevents real-time text streaming when
        // tool-call/tool-result parts are present. Tool display is handled by ChatThinking
        // via metadata.custom.steps.
        const buildYield = (): ChatModelRunResult => ({
            content: currentContent
                ? [{ type: "text" as const, text: currentContent }]
                : [],
            metadata: { custom: { steps: [...currentSteps], assistantMessageId, suggestions } },
        });

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
                    currentSteps.push({
                        interrupt: {
                            id: chunk.interruptId,
                            tool: chunk.toolName,
                            args: chunk.toolInput ?? {},
                            reason: chunk.interruptReason ?? chunk.content ?? '操作需要确认',
                            // 应答必须发往 interrupt 实际挂起的 session（子 Agent 与 Chat session 不同）
                            sessionId: chunk.sessionId,
                            kind: chunk.interruptKind ?? 'approval',
                            options: chunk.toolInput?.options,
                            resolved: null, // null = pending user response
                        }
                    });
                    yield buildYield();

                } else if (chunk.delegatedFrom && chunk.harnessInstanceId) {
                    // 子 Agent 步骤：聚合到子任务分组。
                    // 必须排在 content/thought/action 等类型分支之前，
                    // 否则子 Agent 步骤会被父级分支拦截（content 混入父回答正文、
                    // thought/action/observation 混入父步骤列表），子任务面板只剩 answer。
                    const instanceId = chunk.harnessInstanceId;
                    const subTaskIdx = currentSteps.findIndex(
                        (s: any) => s.subTask?.instanceId === instanceId
                    );
                    if (subTaskIdx >= 0) {
                        // 不可变更新，保证下游 memo 组件能感知变化
                        const prev = currentSteps[subTaskIdx].subTask;
                        const nextSubTask = { ...prev, steps: [...prev.steps, chunk] };
                        if (chunk.type === 'answer') {
                            nextSubTask.status = 'completed';
                            nextSubTask.endTime = new Date();
                        }
                        if (chunk.type === 'grade_result') {
                            try {
                                const graderResult = JSON.parse(chunk.content ?? '{}');
                                nextSubTask.graderScore = graderResult.overallScore;
                            } catch { /* ignore */ }
                        }
                        currentSteps[subTaskIdx] = { subTask: nextSubTask };
                    } else {
                        currentSteps.push({
                            subTask: {
                                delegatedFrom: chunk.delegatedFrom,
                                instanceId,
                                steps: [chunk],
                                status: 'running',
                                startTime: new Date(),
                            }
                        });
                    }
                    yield buildYield();

                } else if (chunk.type === "content") {
                    currentContent += chunk.content;
                    const now = Date.now();
                    if (now - lastYieldTime >= YIELD_MIN_INTERVAL_MS) {
                        lastYieldTime = now;
                        yield buildYield();
                    }

                } else if (chunk.type === "thought") {
                    currentSteps.push({ thought: chunk.content });
                    yield buildYield();

                } else if (chunk.type === "plan") {
                    try {
                        const planSteps = typeof chunk.content === 'string' ? JSON.parse(chunk.content) : chunk.content;
                        currentSteps.push({ plan: planSteps });
                    } catch (e) {
                        console.warn("Failed to parse plan:", chunk.content);
                        currentSteps.push({ plan: ["Detail hidden"] });
                    }
                    yield buildYield();

                } else if (chunk.type === "action") {
                    // Use toolName as the action label (chunk.tool doesn't exist on the payload)
                    currentSteps.push({ action: chunk.toolName || chunk.content || "tool" });
                    yield buildYield();

                } else if (chunk.type === "observation") {
                    if (currentSteps.length > 0) {
                        // 用新对象替换而非原地修改，保证下游 memo 组件能感知变化
                        const last = currentSteps[currentSteps.length - 1];
                        currentSteps[currentSteps.length - 1] = {
                            ...last,
                            // Prefer chunk.content (always set by backend), fall back to chunk.result
                            observation: chunk.content ?? chunk.result ?? chunk.toolOutput ?? "",
                            ...(chunk.duration !== undefined ? { duration: chunk.duration } : {}),
                        };
                    }
                    yield buildYield();

                } else if (chunk.type === "task_created" || chunk.type === "task_completed" || chunk.type === "task_failed") {
                    currentSteps.push({ task: { type: chunk.type, taskId: chunk.taskId, content: chunk.content } });
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
                    currentSteps.push({
                        contextCompressed: {
                            droppedCount: chunk.droppedCount ?? 0,
                            summary: chunk.content ?? '对话历史已压缩',
                        }
                    });
                    yield buildYield();

                } else if (chunk.type === "workflow_generated") {
                    currentSteps.push({
                        workflow_generated: {
                            workflow: chunk.workflow,
                            subWorkflows: chunk.subWorkflows,
                            validation: chunk.validation,
                            allValid: chunk.allValid,
                            explanation: chunk.explanation,
                        }
                    });
                    yield buildYield();

                } else if (chunk.type === "grading" || chunk.type === "grade_result") {
                    // Harness Grader 评分步骤
                    currentSteps.push({
                        grading: {
                            type: chunk.type,
                            content: chunk.content,
                        }
                    });
                    yield buildYield();

                } else if (chunk.type === "answer") {
                    // Final answer replaces any partial content chunks
                    currentContent = chunk.content;
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
                    content: [{ type: "text", text: "抱歉，发生了错误。请检查后端连接。" }],
                };
            }
        }
    }
}
