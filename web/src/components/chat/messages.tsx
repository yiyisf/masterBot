"use client";

import { memo } from "react";
import {
    useMessage,
    useThreadRuntime,
    MessagePrimitive,
    ActionBarPrimitive,
    BranchPickerPrimitive,
    ComposerPrimitive,
} from "@assistant-ui/react";
import { BotMessageSquare, Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { ChatThinking } from "@/components/chat-thinking";
import { DagView } from "@/components/dag-view";
import { ConductorWorkflowCard } from "@/components/conductor-workflow-dialog";
import { MarkdownText } from "./code-block";
import { CopyButton, ReloadButton, FeedbackButton, SuggestionButtons, InlineCopyButton } from "./message-actions";
import { InterruptCard } from "./interrupt-card";

export const CustomAssistantMessage = memo(() => {
    const message = useMessage();
    const thread = useThreadRuntime();
    const custom = (message.metadata as any)?.custom || {};
    const steps = custom.steps || [];
    const assistantMessageId = custom.assistantMessageId || null;
    const suggestions: string[] = custom.suggestions || [];

    const searchParams = useSearchParams();
    const sessionId = searchParams.get("sessionId") || "";

    const handleSuggestionSelect = (text: string) => {
        thread.append({ role: "user", content: [{ type: "text", text }] });
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

                    <div className={`flex items-center gap-1 mt-2 transition-opacity ${showActionBar ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                        <CopyButton />
                        <ReloadButton />
                        <div className="w-px h-5 bg-border mx-1 self-center" />
                        <FeedbackButton rating="positive" messageId={assistantMessageId} sessionId={sessionId} />
                        <FeedbackButton rating="negative" messageId={assistantMessageId} sessionId={sessionId} />
                        <BranchPickerPrimitive.Root
                            hideWhenSingleBranch
                            className="flex items-center gap-0.5 border-l pl-2 ml-1 border-border"
                        >
                            <BranchPickerPrimitive.Previous asChild>
                                <button className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                </button>
                            </BranchPickerPrimitive.Previous>
                            <span className="text-[11px] text-muted-foreground tabular-nums min-w-[28px] text-center">
                                <BranchPickerPrimitive.Number /><span className="opacity-50">/</span><BranchPickerPrimitive.Count />
                            </span>
                            <BranchPickerPrimitive.Next asChild>
                                <button className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </BranchPickerPrimitive.Next>
                        </BranchPickerPrimitive.Root>
                        {completedAt && (
                            <span className="ml-auto text-[10px] text-muted-foreground/50 pl-2">{completedAt}</span>
                        )}
                    </div>

                    <SuggestionButtons suggestions={suggestions} onSelect={handleSuggestionSelect} />
                </div>
            </div>
        </div>
    );
});
CustomAssistantMessage.displayName = 'CustomAssistantMessage';

export const CustomUserMessage = memo(() => {
    const message = useMessage();

    const textContent = message.content
        .filter(c => c.type === 'text')
        .map(c => (c as { type: 'text'; text: string }).text)
        .join('');

    const sentAt = message.createdAt
        ? new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : null;

    return (
        <div className="group flex flex-col gap-1.5 items-end mb-10 w-full max-w-3xl mx-auto animate-in slide-in-from-right-4 fade-in duration-300">
            <div className="max-w-[75%] bg-muted/80 text-foreground px-5 py-3 rounded-2xl rounded-tr-none shadow-sm border border-border/50 backdrop-blur-sm">
                <div className="text-[15px] leading-relaxed">
                    <MessagePrimitive.Content components={{ Text: MarkdownText }} />
                </div>
            </div>
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                {sentAt && (
                    <span className="text-[10px] text-muted-foreground/50">{sentAt}</span>
                )}
                <InlineCopyButton text={textContent} />
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
CustomUserMessage.displayName = 'CustomUserMessage';

export const CustomUserEditComposer = memo(() => (
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
));
CustomUserEditComposer.displayName = 'CustomUserEditComposer';
