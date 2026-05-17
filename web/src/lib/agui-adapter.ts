"use client";

/**
 * AguiRuntimeAdapter
 *
 * 将 AG-UI 事件流（runAgui）适配为 @assistant-ui/react 的 ChatModelAdapter 接口。
 * AG-UI 是前后端通信的协议层；@assistant-ui/react 是渲染 UI 的框架层。
 * 两层职责分离：协议变化只改 agui-runtime.ts，UI 框架变化只改此文件。
 */

import type { ChatModelAdapter, ChatModelRunOptions, ChatModelRunResult } from "@assistant-ui/react";
import { runAgui } from "./agui-runtime";
import { nanoid } from "nanoid";

export class AguiRuntimeAdapter implements ChatModelAdapter {
    private sessionId: string;

    constructor(sessionId?: string) {
        this.sessionId = sessionId || nanoid();
    }

    async *run(options: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult> {
        const { messages, abortSignal } = options;
        const lastMessage = messages[messages.length - 1];

        // 提取文本内容与多模态内容
        const contentParts = Array.isArray(lastMessage.content) ? lastMessage.content : [];
        const hasNonText = contentParts.some((p: any) => p.type !== "text");
        const userText =
            contentParts.length > 0 && contentParts[0]?.type === "text"
                ? (contentParts[0] as any).text
                : typeof lastMessage.content === "string"
                ? lastMessage.content
                : "";

        const messageContent = hasNonText
            ? contentParts.map((p: any) => {
                  if (p.type === "image" && p.image) {
                      return { type: "image_url" as const, image_url: { url: p.image } };
                  }
                  if (p.type === "image_url") {
                      return { type: "image_url" as const, image_url: { url: p.image_url?.url ?? "" } };
                  }
                  return { type: "text" as const, text: p.text ?? "" };
              })
            : undefined;

        const attachments = ((lastMessage as any).attachments || []).map((a: any) => ({
            id: a.id,
            name: a.name,
            type: a.contentType,
            url: (a as any).url,
        }));

        const history = messages.slice(0, -1).map((m) => ({
            role: m.role,
            content: Array.isArray(m.content)
                ? m.content[0]?.type === "text"
                    ? (m.content[0] as any).text
                    : ""
                : (m.content ?? ""),
        }));

        // 运行时状态
        let currentContent = "";
        const currentSteps: any[] = [];
        let assistantMessageId: string | null = null;
        let suggestions: string[] | null = null;
        // 用于区分"流式内容"文本消息和最终"answer"消息
        let prevTextClosed = false;

        const buildYield = (): ChatModelRunResult => ({
            content: currentContent ? [{ type: "text" as const, text: currentContent }] : [],
            metadata: {
                custom: { steps: [...currentSteps], assistantMessageId, suggestions },
            },
        });

        try {
            for await (const event of runAgui({
                message: userText,
                sessionId: this.sessionId,
                history,
                attachments,
                messageContent,
                abortSignal,
            })) {
                switch (event.type) {
                    case "TEXT_MESSAGE_START":
                        // 第二条文本消息（answer）开始：清空流式累积内容
                        if (prevTextClosed) {
                            currentContent = "";
                            prevTextClosed = false;
                        }
                        break;

                    case "TEXT_MESSAGE_CHUNK":
                        currentContent += event.delta ?? "";
                        yield buildYield();
                        break;

                    case "TEXT_MESSAGE_END":
                        prevTextClosed = true;
                        break;

                    case "THINKING_START":
                        // 在 steps 中预占一个 thought 槽位，后续 CHUNK 追加
                        currentSteps.push({ thought: "" });
                        break;

                    case "THINKING_CHUNK": {
                        // 追加到最后一个 thought 槽位
                        const lastThought = currentSteps.findLast((s: any) => "thought" in s);
                        if (lastThought) {
                            lastThought.thought += event.delta ?? "";
                        } else {
                            currentSteps.push({ thought: event.delta ?? "" });
                        }
                        yield buildYield();
                        break;
                    }

                    case "THINKING_END":
                        break;

                    case "TOOL_CALL_START":
                        currentSteps.push({ action: event.toolName ?? "tool" });
                        yield buildYield();
                        break;

                    case "TOOL_CALL_END": {
                        // 更新最后一个 action step 的 observation 和 duration
                        const lastAction = currentSteps.findLast((s: any) => "action" in s);
                        if (lastAction) {
                            lastAction.observation =
                                typeof event.result === "string"
                                    ? event.result
                                    : JSON.stringify(event.result ?? "");
                            if (event.duration !== undefined) {
                                lastAction.duration = event.duration;
                            }
                        }
                        yield buildYield();
                        break;
                    }

                    case "STATE_UPDATE": {
                        const state = event.state ?? {};
                        this.handleStateUpdate(state, currentSteps, (id) => { assistantMessageId = id; }, (s) => { suggestions = s; });
                        yield buildYield();
                        break;
                    }

                    case "HUMAN_IN_THE_LOOP_REQUEST":
                        currentSteps.push({
                            interrupt: {
                                id: event.interruptId,
                                tool: event.toolName,
                                args: event.args ?? {},
                                reason: event.interruptReason ?? "操作需要确认",
                                resolved: null,
                            },
                        });
                        yield buildYield();
                        break;

                    case "RUN_FINISHED":
                        yield buildYield();
                        break;

                    case "RUN_ERROR":
                        throw new Error(event.error ?? "AG-UI stream error");
                }
            }
        } catch (error: any) {
            if (error.name === "AbortError") {
                // 用户主动取消，静默处理
            } else {
                console.error("[AguiRuntimeAdapter]", error);
                yield {
                    content: [{ type: "text" as const, text: "抱歉，发生了错误。请检查后端连接。" }],
                };
            }
        }
    }

    private handleStateUpdate(
        state: Record<string, unknown>,
        steps: any[],
        setAssistantId: (id: string) => void,
        setSuggestions: (s: string[]) => void,
    ) {
        const type = state.type as string | undefined;

        if ("plan" in state) {
            try {
                const planData = typeof state.plan === "string" ? JSON.parse(state.plan as string) : state.plan;
                steps.push({ plan: planData });
            } catch {
                steps.push({ plan: ["Detail hidden"] });
            }
        } else if ("contextCompressed" in state) {
            const cc = state.contextCompressed as any;
            steps.push({ contextCompressed: { droppedCount: cc?.droppedCount ?? 0, summary: cc?.summary ?? "对话历史已压缩" } });
        } else if (type === "meta") {
            if (state.assistantMessageId) setAssistantId(state.assistantMessageId as string);
        } else if (type === "suggestions") {
            setSuggestions((state as any).items || []);
        } else if (type === "workflow_generated") {
            steps.push({ workflow_generated: state });
        } else if (type === "grading" || type === "grade_result") {
            steps.push({ grading: { type, content: (state as any).content } });
        } else if (type === "task_created" || type === "task_completed" || type === "task_failed") {
            steps.push({ task: state });
        } else if (state.delegatedFrom && state.harnessInstanceId) {
            // Harness 子 Agent 步骤聚合
            const instanceId = state.harnessInstanceId as string;
            const existing = steps.find((s: any) => s.subTask?.instanceId === instanceId);
            if (existing) {
                existing.subTask.steps.push(state);
                if (type === "answer") existing.subTask.status = "completed";
                if (type === "grade_result") {
                    try {
                        const gr = JSON.parse((state as any).content ?? "{}");
                        existing.subTask.graderScore = gr.overallScore;
                    } catch { /* ignore */ }
                }
            } else {
                steps.push({
                    subTask: {
                        delegatedFrom: state.delegatedFrom,
                        instanceId,
                        steps: [state],
                        status: "running",
                        startTime: new Date(),
                    },
                });
            }
        }
    }
}
