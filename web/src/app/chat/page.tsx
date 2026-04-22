"use client";

import {
    AssistantRuntimeProvider,
    useLocalRuntime,
    CompositeAttachmentAdapter,
    SimpleImageAttachmentAdapter,
    SimpleTextAttachmentAdapter,
} from "@assistant-ui/react";
import { Thread } from "@assistant-ui/react-ui";
import { MyRuntimeAdapter } from "@/lib/assistant-runtime";
import { allToolUIs, FallbackToolUI } from "@/components/tool-ui";
import { SlashComposer } from "@/components/slash-composer";
import { Skeleton } from "@/components/ui/skeleton";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import "@assistant-ui/react-ui/styles/index.css";
import "@assistant-ui/react-ui/styles/markdown.css";

import { CustomAssistantMessage, CustomUserMessage, CustomUserEditComposer } from "@/components/chat/messages";
import { ThreadHydrator, PromptAutoSender } from "@/components/chat/thread-utils";
import { CheckpointPanel } from "@/components/chat/checkpoint-panel";

function ChatContent() {
    const searchParams = useSearchParams();
    const sessionId = searchParams.get("sessionId") || undefined;
    return <ChatSession key={sessionId || '__new__'} sessionId={sessionId} />;
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
                <PromptAutoSender
                    initPrompt={initPrompt}
                    historyLoaded={!sessionId || historyLoaded}
                />

                {/* 检查点工具栏（仅有 sessionId 时显示） */}
                {sessionId && (
                    <div className="flex justify-end px-3 py-1 border-b shrink-0">
                        <CheckpointPanel sessionId={sessionId} />
                    </div>
                )}

                <div className="flex-1 overflow-hidden relative">
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
                            components: { ToolFallback: FallbackToolUI },
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
