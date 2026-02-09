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

        const userContent = lastMessage.content[0]?.type === "text" ? lastMessage.content[0].text : "";

        // Transform history for backend
        const history = messages.slice(0, -1).map(m => ({
            role: m.role,
            content: m.content[0]?.type === "text" ? m.content[0].text : "",
        }));

        let currentContent = "";
        const currentSteps: any[] = [];
        const currentToolCalls: any[] = [];
        const currentToolResults: any[] = [];
        let pendingToolCallId: string | null = null;
        let assistantMessageId: string | null = null;
        let suggestions: string[] | null = null;

        try {
            const requestBody = {
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

            for await (const chunk of streamApi("/api/chat/stream", requestBody, abortSignal)) {
                if (chunk.type === "content") {
                    currentContent += chunk.content;
                    yield {
                        content: [
                            { type: "text" as const, text: currentContent },
                            ...currentToolCalls,
                            ...currentToolResults,
                        ],
                        metadata: { custom: { steps: [...currentSteps], assistantMessageId, suggestions } },
                    };
                } else if (chunk.type === "thought") {
                    currentSteps.push({ thought: chunk.content });
                    yield {
                        content: [
                            ...(currentContent ? [{ type: "text" as const, text: currentContent }] : []),
                            ...currentToolCalls,
                            ...currentToolResults,
                        ],
                        metadata: { custom: { steps: [...currentSteps], assistantMessageId, suggestions } },
                    };
                } else if (chunk.type === "plan") {
                    try {
                        const planSteps = typeof chunk.content === 'string' ? JSON.parse(chunk.content) : chunk.content;
                        currentSteps.push({ plan: planSteps });
                    } catch (e) {
                        console.warn("Failed to parse plan:", chunk.content);
                        currentSteps.push({ plan: ["Detail hidden"] });
                    }
                    yield {
                        content: [
                            ...(currentContent ? [{ type: "text" as const, text: currentContent }] : []),
                            ...currentToolCalls,
                            ...currentToolResults,
                        ],
                        metadata: { custom: { steps: [...currentSteps], assistantMessageId, suggestions } },
                    };
                } else if (chunk.type === "action") {
                    currentSteps.push({ action: JSON.stringify(chunk.tool) });

                    // Generate a tool-call content part for Tool UI rendering
                    const toolCallId = (chunk.toolName || "tool") + "-" + nanoid(8);
                    pendingToolCallId = toolCallId;

                    currentToolCalls.push({
                        type: "tool-call" as const,
                        toolCallId,
                        toolName: chunk.toolName || "unknown",
                        args: chunk.toolInput || {},
                    });

                    yield {
                        content: [
                            ...(currentContent ? [{ type: "text" as const, text: currentContent }] : []),
                            ...currentToolCalls,
                            ...currentToolResults,
                        ],
                        metadata: { custom: { steps: [...currentSteps], assistantMessageId, suggestions } },
                    };
                } else if (chunk.type === "observation") {
                    if (currentSteps.length > 0) {
                        currentSteps[currentSteps.length - 1].observation = chunk.result;
                    }

                    // Associate observation with pending tool-call as a tool-result
                    if (pendingToolCallId) {
                        currentToolResults.push({
                            type: "tool-result" as const,
                            toolCallId: pendingToolCallId,
                            toolName: chunk.toolName || "unknown",
                            result: chunk.result ?? chunk.toolOutput ?? chunk.content ?? "",
                        });
                        pendingToolCallId = null;
                    }

                    yield {
                        content: [
                            ...(currentContent ? [{ type: "text" as const, text: currentContent }] : []),
                            ...currentToolCalls,
                            ...currentToolResults,
                        ],
                        metadata: { custom: { steps: [...currentSteps], assistantMessageId, suggestions } },
                    };
                } else if (chunk.type === "task_created" || chunk.type === "task_completed" || chunk.type === "task_failed") {
                    currentSteps.push({ task: { type: chunk.type, taskId: chunk.taskId, content: chunk.content } });
                    yield {
                        content: [
                            ...(currentContent ? [{ type: "text" as const, text: currentContent }] : []),
                            ...currentToolCalls,
                            ...currentToolResults,
                        ],
                        metadata: { custom: { steps: [...currentSteps], assistantMessageId, suggestions } },
                    };
                } else if (chunk.type === "meta") {
                    // Capture assistant message ID for feedback
                    if (chunk.assistantMessageId) {
                        assistantMessageId = chunk.assistantMessageId;
                    }
                    yield {
                        content: [
                            ...(currentContent ? [{ type: "text" as const, text: currentContent }] : []),
                            ...currentToolCalls,
                            ...currentToolResults,
                        ],
                        metadata: { custom: { steps: [...currentSteps], assistantMessageId, suggestions } },
                    };
                } else if (chunk.type === "suggestions") {
                    suggestions = chunk.items || [];
                    yield {
                        content: [
                            ...(currentContent ? [{ type: "text" as const, text: currentContent }] : []),
                            ...currentToolCalls,
                            ...currentToolResults,
                        ],
                        metadata: { custom: { steps: [...currentSteps], assistantMessageId, suggestions } },
                    };
                } else if (chunk.type === "answer") {
                    currentContent = chunk.content;
                    yield {
                        content: [
                            { type: "text" as const, text: currentContent },
                            ...currentToolCalls,
                            ...currentToolResults,
                        ],
                        metadata: { custom: { steps: [...currentSteps], assistantMessageId, suggestions } },
                    };
                }
            }
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
