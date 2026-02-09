"use client";

import { AssistantRuntimeProvider, useLocalRuntime, useMessage, MessagePrimitive, useThreadRuntime, ActionBarPrimitive } from "@assistant-ui/react";
import {
    Thread,
    makeMarkdownText
} from "@assistant-ui/react-ui";
import { makeLightAsyncSyntaxHighlighter } from "@assistant-ui/react-syntax-highlighter";
import { MyRuntimeAdapter } from "@/lib/assistant-runtime";
import { ChatThinking } from "@/components/chat-thinking";
import { allToolUIs } from "@/components/tool-ui";
import { useMemo, memo, useRef, useEffect, useState, Suspense } from "react";
import "@assistant-ui/react-ui/styles/index.css";
import "@assistant-ui/react-ui/styles/markdown.css";
import { nanoid } from "nanoid";
import { useSearchParams } from "next/navigation";
import { fetchApi } from "@/lib/api";
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown } from "lucide-react";

import { Mermaid } from "@/components/mermaid";
import { Skeleton } from "@/components/ui/skeleton";
import remarkGfm from "remark-gfm";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const atomOneDark = require("react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark").default;

const SyntaxHighlighter = makeLightAsyncSyntaxHighlighter({ style: atomOneDark });

/**
 * Mermaid wrapper adapted to SyntaxHighlighterProps interface
 */
const MermaidHighlighter = ({ code }: { code: string }) => (
    <div className="my-4">
        <Mermaid code={code} />
    </div>
);

/**
 * Custom Markdown renderer with Mermaid support and syntax highlighting
 */
const MarkdownText = makeMarkdownText({
    remarkPlugins: [remarkGfm],
    components: {
        SyntaxHighlighter,
    },
    componentsByLanguage: {
        mermaid: {
            SyntaxHighlighter: MermaidHighlighter,
        },
    },
});

/**
 * Copy button with copied state feedback
 */
const CopyButton = () => {
    const [copied, setCopied] = useState(false);

    return (
        <ActionBarPrimitive.Copy
            asChild
            onClick={() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }}
        >
            <button
                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                title="复制"
            >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
        </ActionBarPrimitive.Copy>
    );
};

/**
 * Feedback button (thumbs up / thumbs down)
 */
const FeedbackButton = ({ rating, messageId, sessionId }: { rating: 'positive' | 'negative'; messageId: string | null; sessionId: string }) => {
    const [submitted, setSubmitted] = useState(false);
    const Icon = rating === 'positive' ? ThumbsUp : ThumbsDown;

    const handleClick = async () => {
        if (!messageId || submitted) return;
        try {
            await fetchApi('/api/feedback', {
                method: 'POST',
                body: JSON.stringify({ messageId, sessionId, rating }),
            });
            setSubmitted(true);
        } catch (err) {
            console.error('Feedback failed:', err);
        }
    };

    return (
        <button
            onClick={handleClick}
            className={`inline-flex items-center justify-center h-7 w-7 rounded-md transition-colors ${
                submitted
                    ? (rating === 'positive' ? 'text-green-500 bg-green-500/10' : 'text-red-500 bg-red-500/10')
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'
            }`}
            title={rating === 'positive' ? '有帮助' : '没帮助'}
            disabled={submitted}
        >
            <Icon className="h-3.5 w-3.5" />
        </button>
    );
};

/**
 * Dynamic follow-up suggestion buttons
 */
const SuggestionButtons = ({ suggestions, onSelect }: { suggestions: string[]; onSelect: (text: string) => void }) => {
    if (!suggestions || suggestions.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-2 mt-3">
            {suggestions.map((s, i) => (
                <button
                    key={i}
                    onClick={() => onSelect(s)}
                    className="text-xs px-3 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
                >
                    {s}
                </button>
            ))}
        </div>
    );
};

const CustomAssistantMessage = memo(() => {
    const message = useMessage();
    const thread = useThreadRuntime();
    const custom = (message.metadata as any)?.custom || {};
    const steps = custom.steps || [];
    const assistantMessageId = custom.assistantMessageId || null;
    const suggestions: string[] = custom.suggestions || [];

    // Get sessionId from URL search params
    const searchParams = useSearchParams();
    const sessionId = searchParams.get("sessionId") || "";

    const handleSuggestionSelect = (text: string) => {
        // Append the suggestion as a new user message
        thread.append({
            role: "user",
            content: [{ type: "text", text }],
        });
    };

    return (
        <div className="group flex flex-col gap-4 items-start mb-10 w-full max-w-3xl mx-auto animate-in fade-in duration-500">
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
                    {/* ActionBar: copy, retry, feedback */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 mt-2">
                        <CopyButton />
                        <ActionBarPrimitive.Reload asChild>
                            <button
                                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                                title="重试"
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                        </ActionBarPrimitive.Reload>
                        <div className="w-px h-5 bg-border mx-1 self-center" />
                        <FeedbackButton rating="positive" messageId={assistantMessageId} sessionId={sessionId} />
                        <FeedbackButton rating="negative" messageId={assistantMessageId} sessionId={sessionId} />
                    </div>
                    {/* Dynamic follow-up suggestions */}
                    <SuggestionButtons suggestions={suggestions} onSelect={handleSuggestionSelect} />
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
 * Thread hydrator for session history sync
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
    return <ChatSession key={sessionId || '__new__'} sessionId={sessionId} />;
}

function ChatSession({ sessionId }: { sessionId?: string }) {
    const [historyLoaded, setHistoryLoaded] = useState(false);

    const adapter = useMemo(() => new MyRuntimeAdapter(sessionId), [sessionId]);
    const runtime = useLocalRuntime(adapter);

    const handleLoaded = useMemo(() => () => setHistoryLoaded(true), []);

    return (
        <div className="h-full w-full flex flex-col overflow-hidden">
            <AssistantRuntimeProvider runtime={runtime}>
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
                            suggestions: [
                                { text: "列出当前目录文件", prompt: "帮我列出当前目录的文件" },
                                { text: "写一段 Python 代码", prompt: "用 Python 写一个快速排序算法" },
                                { text: "查看系统状态", prompt: "查看系统当前状态" },
                                { text: "搜索文件内容", prompt: "搜索当前项目中包含 TODO 的文件" },
                            ],
                        }}
                        tools={allToolUIs}
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
