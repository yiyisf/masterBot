import { ChatModelAdapter, ChatModelRunOptions, ChatModelRunResult } from "@assistant-ui/react";
import { streamApi } from "./api";
import { nanoid } from "nanoid";

/**
 * 自定义 Runtime 适配器，连接后端 SSE 服务
 */
export class MyRuntimeAdapter implements ChatModelAdapter {
    private sessionId: string;

    constructor() {
        // Initialize or restore session ID
        if (typeof window !== "undefined") {
            const stored = localStorage.getItem("cm_chat_session_id");
            if (stored) {
                this.sessionId = stored;
            } else {
                this.sessionId = nanoid();
                localStorage.setItem("cm_chat_session_id", this.sessionId);
            }
        } else {
            this.sessionId = nanoid();
        }
    }

    async *run(options: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult, void> {
        const { messages } = options;
        const lastMessage = messages[messages.length - 1];
        const userContent = lastMessage.content[0]?.type === "text" ? lastMessage.content[0].text : "";

        // Transform history for backend
        const history = messages.slice(0, -1).map(m => ({
            role: m.role,
            content: m.content[0]?.type === "text" ? m.content[0].text : "",
        }));

        let currentContent = "";
        const currentSteps: any[] = [];

        try {
            const requestBody = {
                message: userContent,
                sessionId: this.sessionId,
                history: history
            };

            for await (const chunk of streamApi("/api/chat/stream", requestBody)) {
                if (chunk.type === "content") {
                    currentContent += chunk.content;
                    yield {
                        content: [{ type: "text", text: currentContent }],
                    };
                } else if (chunk.type === "thought") {
                    currentSteps.push({ thought: chunk.content });
                    yield {
                        metadata: { custom: { steps: [...currentSteps] } },
                    };
                } else if (chunk.type === "action") {
                    currentSteps.push({ action: JSON.stringify(chunk.tool) });
                    yield {
                        metadata: { custom: { steps: [...currentSteps] } },
                    };
                } else if (chunk.type === "observation") {
                    if (currentSteps.length > 0) {
                        currentSteps[currentSteps.length - 1].observation = chunk.result;
                    }
                    yield {
                        metadata: { custom: { steps: [...currentSteps] } },
                    };
                } else if (chunk.type === "answer") {
                    currentContent = chunk.content;
                    yield {
                        content: [{ type: "text", text: currentContent }],
                        metadata: { custom: { steps: [...currentSteps] } },
                    };
                }
            }
        } catch (error) {
            console.error("MyRuntimeAdapter Error:", error);
            yield {
                content: [{ type: "text", text: "抱歉，发生了错误。请检查后端连接。" }],
            };
        }
    }
}
