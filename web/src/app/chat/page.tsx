"use client";

import { AssistantRuntimeProvider, useLocalRuntime, useMessage, MessagePrimitive, useThreadRuntime } from "@assistant-ui/react";
import {
    Thread,
    makeMarkdownText
} from "@assistant-ui/react-ui";
import { MyRuntimeAdapter } from "@/lib/assistant-runtime";
import { ChatThinking } from "@/components/chat-thinking";
import { useMemo, memo, useRef, useEffect, useState, Suspense } from "react";
import "@assistant-ui/react-ui/styles/index.css";
import "@assistant-ui/react-ui/styles/markdown.css";
import { nanoid } from "nanoid";
import { useSearchParams } from "next/navigation";
import { fetchApi } from "@/lib/api";

import { Mermaid } from "@/components/mermaid";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * 自定义 Markdown 渲染组件，集成 Mermaid 支持
 */
const MarkdownText = makeMarkdownText({
    components: {
        code: (props) => {
            const { children, className, ...rest } = props;
            const match = /language-(\w+)/.exec(className || "");
            if (match && match[1] === "mermaid") {
                return (
                    <div className="my-4">
                        <Mermaid code={String(children).replace(/\n$/, "")} />
                    </div>
                );
            }
            return <code className={className} {...rest}>{children}</code>;
        },
    },
});

const CustomAssistantMessage = memo(() => {
    const message = useMessage();
    const steps = (message.metadata as any)?.custom?.steps || [];

    return (
        <div className="flex flex-col gap-4 items-start mb-10 w-full max-w-3xl mx-auto animate-in fade-in duration-500">
            <div className="flex gap-4 items-start w-full">
                <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-1 shadow-sm">
                    <span className="text-[11px] font-bold text-primary">CM</span>
                </div>
                <div className="flex-1 max-w-full overflow-hidden">
                    <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed text-[15px] text-foreground/90">
                        <MessagePrimitive.Content components={{ Text: MarkdownText }} />
                    </div>
                    {steps.length > 0 && (
                        <div className="w-full mt-4 max-w-3xl">
                            <ChatThinking steps={steps} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

const CustomUserMessage = memo(() => {
    return (
        <div className="flex flex-col gap-3 items-end mb-10 w-full max-w-3xl mx-auto animate-in slide-in-from-right-4 fade-in duration-300">
            <div className="max-w-[75%] bg-muted/80 text-foreground px-5 py-3 rounded-2xl rounded-tr-none shadow-sm border border-border/50 backdrop-blur-sm">
                <div className="text-[15px] leading-relaxed">
                    <MessagePrimitive.Content components={{ Text: MarkdownText }} />
                </div>
            </div>
        </div>
    );
});

/**
 * 专门负责历史同步的内部组件
 */
function ThreadHydrator({ sessionId, onLoaded }: { sessionId: string, onLoaded: () => void }) {
    const thread = useThreadRuntime();
    const isHydrated = useRef(false);

    useEffect(() => {
        if (isHydrated.current) return;

        console.log(`[Hydrator] Syncing history for session ${sessionId}`);

        fetchApi<{ messages: any[] }>(`/api/sessions/${sessionId}/messages`)
            .then((data) => {
                if (isHydrated.current) return;

                if (data.messages && data.messages.length > 0) {
                    // 1. 数据清洗与格式标准化
                    // 注意：给 content 分段也加上 id，彻底规避库内部对 ID 的期待
                    const threadMessages = data.messages.map((m) => {
                        const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
                        const id = m.id ? String(m.id) : nanoid();
                        const createdAt = m.createdAt ? new Date(m.createdAt) : new Date();
                        const content = [{ type: "text" as const, text }];

                        if (m.role === "assistant") {
                            return {
                                id,
                                role: "assistant" as const,
                                content,
                                status: { type: "complete" as const, reason: "stop" as const },
                                createdAt,
                                metadata: {
                                    unstable_state: null,
                                    unstable_annotations: [] as readonly never[],
                                    unstable_data: [] as readonly never[],
                                    steps: [] as readonly never[],
                                    custom: (m.metadata?.custom ?? {}) as Record<string, unknown>,
                                },
                            };
                        }
                        return {
                            id,
                            role: "user" as const,
                            content,
                            createdAt,
                            attachments: [] as readonly never[],
                            metadata: {
                                custom: {} as Record<string, unknown>,
                            },
                        };
                    });

                    // 2. 注入历史。使用 ThreadState 完整结构。
                    // 延迟 800ms 确保 ThreadRuntime 内部状态完全稳定
                    setTimeout(() => {
                        try {
                            if (typeof (thread as any).import === 'function') {
                                console.log("[Hydrator] Executing thread.import with ID-safe messages");
                                (thread as any).import({
                                    messages: threadMessages.map((msg, idx) => ({
                                        message: msg,
                                        parentId: idx === 0 ? null : threadMessages[idx - 1].id,
                                    })),
                                });
                                isHydrated.current = true;
                                console.log("[Hydrator] Sync complete");
                            } else {
                                console.warn("[Hydrator] thread.import not available");
                            }
                        } catch (err) {
                            console.error("[Hydrator] Sync failed:", err);
                        } finally {
                            onLoaded();
                        }
                    }, 800);
                } else {
                    onLoaded();
                }
            })
            .catch((err) => {
                console.error("[Hydrator] Fetch failed:", err);
                onLoaded();
            });
    }, [sessionId, thread, onLoaded]);

    return null;
}

function ChatContent() {
    const searchParams = useSearchParams();
    const sessionId = searchParams.get("sessionId") || undefined;
    const [historyLoaded, setHistoryLoaded] = useState(false);

    const adapter = useMemo(() => new MyRuntimeAdapter(sessionId), [sessionId]);
    const runtime = useLocalRuntime(adapter);

    const handleLoaded = useMemo(() => () => setHistoryLoaded(true), []);

    return (
        <div className="h-full w-full flex flex-col overflow-hidden">
            <AssistantRuntimeProvider runtime={runtime}>
                {/* 仅在初始化且有 sessionId 时挂载同步器 */}
                {!historyLoaded && sessionId && (
                    <ThreadHydrator sessionId={sessionId} onLoaded={handleLoaded} />
                )}

                <div className="flex-1 overflow-hidden relative">
                    {/* Loading Skeleton Overlay */}
                    {!historyLoaded && sessionId && (
                        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center space-y-4 animate-in fade-in">
                            <div className="w-full max-w-2xl space-y-4 px-4">
                                <div className="flex items-start gap-4">
                                    <Skeleton className="h-10 w-10 rounded-full" />
                                    <div className="space-y-2 flex-1">
                                        <Skeleton className="h-4 w-[250px]" />
                                        <Skeleton className="h-4 w-[200px]" />
                                    </div>
                                </div>
                                <div className="flex items-start gap-4 flex-row-reverse">
                                    <Skeleton className="h-10 w-10 rounded-full" />
                                    <div className="space-y-2 flex-1 flex flex-col items-end">
                                        <Skeleton className="h-4 w-[250px]" />
                                        <Skeleton className="h-4 w-[200px]" />
                                    </div>
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground animate-pulse">正在同步历史记录...</p>
                        </div>
                    )}

                    <Thread
                        welcome={{
                            message: "您好！我是 CMaster Bot。您可以直接提问，或者尝试上传图片/文件进行分析！",
                        }}
                        components={{
                            AssistantMessage: CustomAssistantMessage,
                            UserMessage: CustomUserMessage,
                        }}
                    />
                </div>
            </AssistantRuntimeProvider>
        </div>
    );
}

export default function ChatPage() {
    return (
        <Suspense fallback={<div className="flex h-full items-center justify-center">加载对话中...</div>}>
            <ChatContent />
        </Suspense>
    );
}
