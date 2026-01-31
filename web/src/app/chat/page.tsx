"use client";

import { AssistantRuntimeProvider, useLocalRuntime, useMessage, MessagePrimitive } from "@assistant-ui/react";
import {
    Thread,
    makeMarkdownText
} from "@assistant-ui/react-ui";
import { MyRuntimeAdapter } from "@/lib/assistant-runtime";
import { ChatThinking } from "@/components/chat-thinking";
import { useMemo, memo } from "react";
import "@assistant-ui/react-ui/styles/index.css";
import "@assistant-ui/react-ui/styles/markdown.css";

import { Mermaid } from "@/components/mermaid";

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
        <div className="flex flex-col gap-4 items-start mb-10 w-full animate-in fade-in duration-500">
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
        <div className="flex flex-col gap-3 items-end mb-10 w-full animate-in slide-in-from-right-4 fade-in duration-300">
            <div className="max-w-[75%] bg-muted/80 text-foreground px-5 py-3 rounded-2xl rounded-tr-none shadow-sm border border-border/50 backdrop-blur-sm">
                <div className="text-[15px] leading-relaxed">
                    <MessagePrimitive.Content components={{ Text: MarkdownText }} />
                </div>
            </div>
        </div>
    );
});

export default function ChatPage() {
    const adapter = useMemo(() => new MyRuntimeAdapter(), []);
    const runtime = useLocalRuntime(adapter);

    return (
        <div className="h-full w-full flex flex-col overflow-hidden">
            <AssistantRuntimeProvider runtime={runtime}>
                <div className="flex-1 overflow-hidden">
                    <Thread
                        welcome={{
                            message: "您好！我是 CMaster Bot。您可以直接提问，或者尝试输入以下指令：\n\n- `/help` 查看帮助\n- `列出当前目录下的文件`",
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
