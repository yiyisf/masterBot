"use client";

import { AssistantRuntimeProvider, useLocalRuntime, useMessage, MessagePrimitive, useThreadRuntime, ActionBarPrimitive, BranchPickerPrimitive, ComposerPrimitive, CompositeAttachmentAdapter, SimpleImageAttachmentAdapter, SimpleTextAttachmentAdapter } from "@assistant-ui/react";
import {
    Thread,
    makeMarkdownText
} from "@assistant-ui/react-ui";
import { makeLightAsyncSyntaxHighlighter } from "@assistant-ui/react-syntax-highlighter";
import { MyRuntimeAdapter } from "@/lib/assistant-runtime";
import { ChatThinking } from "@/components/chat-thinking";
import { DagView } from "@/components/dag-view";
import { ConductorWorkflowCard } from "@/components/conductor-workflow-dialog";
import { allToolUIs, FallbackToolUI } from "@/components/tool-ui";
import { useMemo, memo, useRef, useEffect, useState, Suspense, useCallback } from "react";
import "@assistant-ui/react-ui/styles/index.css";
import "@assistant-ui/react-ui/styles/markdown.css";
import { nanoid } from "nanoid";
import { useSearchParams } from "next/navigation";
import { fetchApi } from "@/lib/api";
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, ChevronLeft, ChevronRight, BotMessageSquare, Pencil, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";

import { Mermaid } from "@/components/mermaid";
import { Skeleton } from "@/components/ui/skeleton";
import { SlashComposer } from "@/components/slash-composer";
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
 * Code block with language label and copy button header.
 * Accepts the full SyntaxHighlighter props so required fields (like `components`) are forwarded.
 */
type SHProps = React.ComponentPropsWithoutRef<typeof SyntaxHighlighter>;

const CodeBlock = (props: SHProps) => {
    const { code, language } = props;
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [code]);

    return (
        <div className="not-prose my-4 rounded-lg overflow-hidden border border-zinc-700/60">
            <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800 border-b border-zinc-700/60">
                <span className="text-[11px] text-zinc-400 font-mono">
                    {language && language !== 'text' ? language : 'code'}
                </span>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                    {copied
                        ? <><Check className="h-3 w-3 text-green-400" /><span>已复制</span></>
                        : <><Copy className="h-3 w-3" /><span>复制</span></>
                    }
                </button>
            </div>
            <Suspense fallback={<pre className="bg-zinc-900 p-4 text-zinc-300 font-mono text-sm overflow-x-auto">{code}</pre>}>
                <SyntaxHighlighter {...props} />
            </Suspense>
        </div>
    );
};

/**
 * Custom Markdown renderer with Mermaid support and syntax highlighting
 */
const MarkdownText = makeMarkdownText({
    remarkPlugins: [remarkGfm],
    components: {
        SyntaxHighlighter: CodeBlock,
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
            className={`inline-flex items-center justify-center h-7 w-7 rounded-md transition-colors ${submitted
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
        <div className="mt-4 space-y-1">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">您还可以问：</p>
            <div className="flex flex-col gap-1.5">
                {suggestions.map((s, i) => (
                    <button
                        key={i}
                        onClick={() => onSelect(s)}
                        className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-border/50 bg-muted/30 hover:bg-muted/70 hover:border-primary/30 text-foreground/80 hover:text-foreground transition-all text-left"
                    >
                        <ChevronRight className="w-3.5 h-3.5 text-primary/60 shrink-0" />
                        <span>{s}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};

/**
 * Human-in-the-Loop confirmation card.
 * Shown when the agent detects a dangerous operation and pauses for user approval.
 */
interface InterruptInfo {
    id: string;
    tool: string;
    args: Record<string, unknown>;
    reason: string;
    resolved: boolean | null;
}

const InterruptCard = ({
    interrupt,
    sessionId,
}: {
    interrupt: InterruptInfo;
    sessionId: string;
}) => {
    const [status, setStatus] = useState<'pending' | 'loading' | 'approved' | 'rejected'>(
        interrupt.resolved === true ? 'approved' : interrupt.resolved === false ? 'rejected' : 'pending'
    );

    const respond = useCallback(async (approved: boolean) => {
        setStatus('loading');
        try {
            await fetchApi(`/api/sessions/${sessionId}/interrupt-response`, {
                method: 'POST',
                body: JSON.stringify({ approved }),
            });
            setStatus(approved ? 'approved' : 'rejected');
        } catch {
            setStatus('pending'); // allow retry on network error
        }
    }, [sessionId]);

    const cmdPreview = interrupt.args?.command
        ? String(interrupt.args.command).slice(0, 120)
        : interrupt.args?.query
            ? String(interrupt.args.query).slice(0, 120)
            : JSON.stringify(interrupt.args).slice(0, 120);

    return (
        <div className="my-3 rounded-xl border border-amber-300/60 dark:border-amber-700/60 bg-amber-50/80 dark:bg-amber-950/30 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-100/80 dark:bg-amber-900/30 border-b border-amber-300/40 dark:border-amber-700/40">
                <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">高危操作确认</span>
                <span className="ml-auto text-[11px] text-amber-600/70 dark:text-amber-400/70 font-mono">{interrupt.tool}</span>
            </div>

            {/* Body */}
            <div className="px-4 py-3 space-y-2">
                <p className="text-sm text-amber-900 dark:text-amber-200">
                    Agent 即将执行以下操作，请确认是否继续：
                </p>
                <div className="text-xs text-amber-800/80 dark:text-amber-300/80 font-medium">
                    ⚠️ {interrupt.reason}
                </div>
                {cmdPreview && (
                    <pre className="text-xs bg-black/10 dark:bg-white/5 rounded-md px-3 py-2 text-amber-900 dark:text-amber-200 overflow-x-auto whitespace-pre-wrap break-all">
                        {cmdPreview}
                    </pre>
                )}
            </div>

            {/* Footer — action buttons or resolved state */}
            <div className="px-4 py-2.5 border-t border-amber-300/40 dark:border-amber-700/40 flex items-center gap-2">
                {status === 'pending' && (
                    <>
                        <button
                            onClick={() => respond(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors"
                        >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            确认执行
                        </button>
                        <button
                            onClick={() => respond(false)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400/60 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-xs font-medium transition-colors"
                        >
                            <ShieldX className="w-3.5 h-3.5" />
                            取消操作
                        </button>
                        <span className="ml-auto text-[10px] text-amber-600/60">等待您的确认…</span>
                    </>
                )}
                {status === 'loading' && (
                    <span className="text-xs text-amber-600 animate-pulse">处理中…</span>
                )}
                {status === 'approved' && (
                    <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
                        <ShieldCheck className="w-3.5 h-3.5" /> 已确认，Agent 继续执行
                    </span>
                )}
                {status === 'rejected' && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                        <ShieldX className="w-3.5 h-3.5" /> 已取消操作
                    </span>
                )}
            </div>
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
        thread.append({
            role: "user",
            content: [{ type: "text", text }],
        });
    };

    const isRunning = message.status?.type === 'running';
    const isComplete = message.status?.type === 'complete';
    const isIncomplete = message.status?.type === 'incomplete';
    const hasContent = message.content.some(
        (c) => c.type === 'text' && (c as { type: 'text'; text: string }).text.trim().length > 0
    );
    const showActionBar = isComplete && hasContent;

    const completedAt = isComplete && message.createdAt
        ? new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : null;

    return (
        <div className="group flex flex-col gap-4 items-start mb-10 w-full max-w-3xl mx-auto animate-in fade-in duration-500">
            <div className="flex gap-4 items-start w-full">
                {/* Avatar — with streaming indicator dot */}
                <div className="relative shrink-0 mt-1">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-sm">
                        <BotMessageSquare className="w-4 h-4 text-white" />
                    </div>
                    {isRunning && (
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-background animate-pulse" />
                    )}
                </div>

                <div className="flex-1 max-w-full overflow-hidden">
                    <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed text-[15px] text-foreground/90">
                        <MessagePrimitive.Content components={{ Text: MarkdownText }} />
                        {/* Typing dots — shown while waiting for first token */}
                        {isRunning && !hasContent && (
                            <div className="flex gap-1.5 items-center py-1">
                                {[0, 150, 300].map((delay, i) => (
                                    <span
                                        key={i}
                                        className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce"
                                        style={{ animationDelay: `${delay}ms` }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Incomplete/error state */}
                    {isIncomplete && (
                        <div className="mt-2 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-md px-3 py-2">
                            <span className="font-medium">响应中断，可点击重试</span>
                        </div>
                    )}

                    {steps.length > 0 && (
                        <div className="w-full mt-4 max-w-3xl">
                            <ChatThinking steps={steps} />
                            <DagView steps={steps} />
                        </div>
                    )}

                    {/* Human-in-the-Loop interrupt cards */}
                    {steps
                        .filter((s: any) => s.interrupt)
                        .map((s: any, i: number) => (
                            <InterruptCard
                                key={s.interrupt.id ?? i}
                                interrupt={s.interrupt}
                                sessionId={sessionId}
                            />
                        ))
                    }

                    {/* Conductor Workflow Generated cards */}
                    {steps
                        .filter((s: any) => s.workflow_generated)
                        .map((s: any, i: number) => (
                            <ConductorWorkflowCard
                                key={`workflow-${i}`}
                                workflowDef={s.workflow_generated.workflow}
                                explanation={s.workflow_generated.explanation}
                            />
                        ))
                    }

                    {/* ActionBar: copy, retry, feedback — only visible after completion with content */}
                    <div className={`flex items-center gap-1 mt-2 transition-opacity ${showActionBar ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
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
                        <BranchPickerPrimitive.Root
                            hideWhenSingleBranch
                            className="flex items-center gap-0.5 border-l pl-2 ml-1 border-border"
                        >
                            <BranchPickerPrimitive.Previous asChild>
                                <button
                                    className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                </button>
                            </BranchPickerPrimitive.Previous>
                            <span className="text-[11px] text-muted-foreground tabular-nums min-w-[28px] text-center">
                                <BranchPickerPrimitive.Number /><span className="opacity-50">/</span><BranchPickerPrimitive.Count />
                            </span>
                            <BranchPickerPrimitive.Next asChild>
                                <button
                                    className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </BranchPickerPrimitive.Next>
                        </BranchPickerPrimitive.Root>
                        {completedAt && (
                            <span className="ml-auto text-[10px] text-muted-foreground/50 pl-2">{completedAt}</span>
                        )}
                    </div>

                    {/* Dynamic follow-up suggestions */}
                    <SuggestionButtons suggestions={suggestions} onSelect={handleSuggestionSelect} />
                </div>
            </div>
        </div>
    );
});

const CustomUserMessage = memo(() => {
    const message = useMessage();
    const [copied, setCopied] = useState(false);

    const textContent = message.content
        .filter(c => c.type === 'text')
        .map(c => (c as { type: 'text'; text: string }).text)
        .join('');

    const sentAt = message.createdAt
        ? new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : null;

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(textContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [textContent]);

    return (
        <div className="group flex flex-col gap-1.5 items-end mb-10 w-full max-w-3xl mx-auto animate-in slide-in-from-right-4 fade-in duration-300">
            <div className="max-w-[75%] bg-muted/80 text-foreground px-5 py-3 rounded-2xl rounded-tr-none shadow-sm border border-border/50 backdrop-blur-sm">
                <div className="text-[15px] leading-relaxed">
                    <MessagePrimitive.Content components={{ Text: MarkdownText }} />
                </div>
            </div>
            {/* Footer: timestamp + copy + edit — visible on hover */}
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                {sentAt && (
                    <span className="text-[10px] text-muted-foreground/50">{sentAt}</span>
                )}
                {textContent && (
                    <button
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        title="复制消息"
                    >
                        {copied
                            ? <><Check className="w-3 h-3 text-green-500" /><span>已复制</span></>
                            : <><Copy className="w-3 h-3" /><span>复制</span></>
                        }
                    </button>
                )}
                <ActionBarPrimitive.Edit asChild>
                    <button
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                        title="编辑消息"
                    >
                        <Pencil className="w-3 h-3" /><span>编辑</span>
                    </button>
                </ActionBarPrimitive.Edit>
            </div>
        </div>
    );
});

/**
 * Inline edit composer for user messages (renders when editing mode is active)
 */
const CustomUserEditComposer = memo(() => {
    return (
        <div className="flex flex-col gap-1.5 items-end mb-10 w-full max-w-3xl mx-auto animate-in fade-in duration-200">
            <ComposerPrimitive.Root className="w-full max-w-[75%]">
                <div className="rounded-2xl rounded-tr-none border border-primary/50 bg-muted/80 px-4 py-3 shadow-sm">
                    <ComposerPrimitive.Input
                        className="w-full bg-transparent text-[15px] leading-relaxed resize-none outline-none min-h-[60px] max-h-[240px] overflow-y-auto"
                        rows={2}
                    />
                </div>
                <div className="flex justify-end gap-2 mt-2 pr-1">
                    <ComposerPrimitive.Cancel asChild>
                        <button className="text-xs px-3 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted/60 transition-colors">
                            取消
                        </button>
                    </ComposerPrimitive.Cancel>
                    <ComposerPrimitive.Send asChild>
                        <button className="text-xs px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                            重新发送
                        </button>
                    </ComposerPrimitive.Send>
                </div>
            </ComposerPrimitive.Root>
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

/**
 * Reads ?prompt= from URL and auto-sends it once the thread is ready.
 * Must be rendered inside AssistantRuntimeProvider.
 */
function PromptAutoSender({ initPrompt, historyLoaded }: { initPrompt: string | null; historyLoaded: boolean }) {
    const thread = useThreadRuntime();
    const sent = useRef(false);

    useEffect(() => {
        if (!initPrompt || sent.current || !historyLoaded) return;
        sent.current = true;
        // Small delay to ensure thread is fully ready
        setTimeout(() => {
            try {
                thread.append({ role: "user", content: [{ type: "text", text: decodeURIComponent(initPrompt) }] });
            } catch (err) {
                console.error("[PromptAutoSender] Failed:", err);
            }
        }, 200);
    }, [initPrompt, historyLoaded, thread]);

    return null;
}

function ChatSession({ sessionId }: { sessionId?: string }) {
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const searchParams = useSearchParams();
    const initPrompt = searchParams.get("prompt");

    const adapter = useMemo(() => new MyRuntimeAdapter(sessionId), [sessionId]);
    const attachmentAdapter = useMemo(() => new CompositeAttachmentAdapter([
        new SimpleImageAttachmentAdapter(),
        new SimpleTextAttachmentAdapter(),
    ]), []);
    const runtime = useLocalRuntime(adapter, {
        adapters: { attachments: attachmentAdapter },
    });

    const handleLoaded = useMemo(() => () => setHistoryLoaded(true), []);

    return (
        <div className="h-full w-full flex flex-col overflow-hidden">
            <AssistantRuntimeProvider runtime={runtime}>
                {!historyLoaded && sessionId && (
                    <ThreadHydrator sessionId={sessionId} onLoaded={handleLoaded} />
                )}
                {/* Auto-send ?prompt= URL parameter once thread is ready */}
                <PromptAutoSender
                    initPrompt={initPrompt}
                    historyLoaded={!sessionId || historyLoaded}
                />

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
                        assistantMessage={{
                            components: {
                                ToolFallback: FallbackToolUI,
                            },
                        }}
                        welcome={{
                            message: "您好！我是 CMaster Bot — 您的企业 AI 工作助手。\n我能查询企业数据、检索内部知识、自动化重复流程，还会在工作中持续学习新技能。",
                            suggestions: [
                                { text: "查询假期余额", prompt: "查询我今年剩余的年假天数" },
                                { text: "生成本周销售报表", prompt: "查询本周各产品线的销售数据并生成可视化报表" },
                                { text: "检索企业知识库", prompt: "搜索关于差旅报销流程的相关规定" },
                                { text: "分析日志异常", prompt: "分析最近 1 小时的应用日志，找出高频错误" },
                                { text: "自动生成新技能", prompt: "帮我生成一个能查询 ERP 订单状态的技能" },
                                { text: "浏览器自动化操作", prompt: "打开 OA 系统，截图展示我的待审批列表" },
                                { text: "处理上传的文档", prompt: "请分析我上传的合同文件，提取关键条款和风险点" },
                                { text: "了解我的全部能力", prompt: "详细介绍你能帮企业员工做哪些事，每项给出示例" },
                            ],
                        }}
                        tools={allToolUIs}
                        components={{
                            AssistantMessage: CustomAssistantMessage,
                            UserMessage: CustomUserMessage,
                            EditComposer: CustomUserEditComposer,
                            Composer: SlashComposer,
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
