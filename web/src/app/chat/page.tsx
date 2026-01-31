"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { streamApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface ChatStep {
    thought?: string;
    action?: string;
    observation?: string;
}

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    steps?: ChatStep[];
    isStreaming?: boolean;
}

export default function ChatPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isTyping) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: "user",
            content: input,
        };

        setMessages((prev) => [...prev, userMessage]);
        setInput("");
        setIsTyping(true);

        const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: "",
            steps: [],
            isStreaming: true,
        };

        setMessages((prev) => [...prev, assistantMessage]);

        try {
            let currentContent = "";
            let currentSteps: ChatStep[] = [];

            for await (const chunk of streamApi("/api/chat", { message: input })) {
                if (chunk.type === "content") {
                    currentContent += chunk.content;
                } else if (chunk.type === "thought") {
                    currentSteps.push({ thought: chunk.content });
                } else if (chunk.type === "action") {
                    currentSteps.push({ action: JSON.stringify(chunk.tool) });
                } else if (chunk.type === "observation") {
                    if (currentSteps.length > 0) {
                        currentSteps[currentSteps.length - 1].observation = chunk.result;
                    }
                } else if (chunk.type === "answer") {
                    currentContent = chunk.content;
                }

                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === assistantMessage.id
                            ? { ...msg, content: currentContent, steps: [...currentSteps] }
                            : msg
                    )
                );
            }
        } catch (error) {
            console.error("Chat error:", error);
        } finally {
            setIsTyping(false);
            setMessages((prev) =>
                prev.map((msg) =>
                    msg.id === assistantMessage.id ? { ...msg, isStreaming: false } : msg
                )
            );
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-2rem)]">
            <div className="flex-1 overflow-hidden flex flex-col max-w-4xl mx-auto w-full">
                <ScrollArea className="flex-1 p-4" ref={scrollRef}>
                    <div className="space-y-6 pb-20">
                        {messages.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-[50vh] text-center space-y-4">
                                <div className="bg-primary/10 p-4 rounded-full">
                                    <Bot className="w-12 h-12 text-primary" />
                                </div>
                                <h2 className="text-2xl font-semibold">我可以如何帮您？</h2>
                                <p className="text-muted-foreground max-w-sm">
                                    我是您的企业智能助手，支持执行命令、管理文件以及通过技能扩展能力。
                                </p>
                            </div>
                        )}

                        {messages.map((message) => (
                            <div
                                key={message.id}
                                className={cn(
                                    "flex gap-4",
                                    message.role === "user" ? "flex-row-reverse" : "flex-row"
                                )}
                            >
                                <div className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                                    message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted border"
                                )}>
                                    {message.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                                </div>

                                <div className={cn(
                                    "flex flex-col space-y-2 max-w-[85%]",
                                    message.role === "user" ? "items-end" : "items-start"
                                )}>
                                    <div className={cn(
                                        "px-4 py-2 rounded-2xl",
                                        message.role === "user"
                                            ? "bg-primary text-primary-foreground rounded-tr-none"
                                            : "bg-muted border rounded-tl-none"
                                    )}>
                                        {message.content || (message.isStreaming && <Loader2 className="w-4 h-4 animate-spin my-1" />)}
                                    </div>

                                    {/* Thinking Steps */}
                                    <AnimatePresence>
                                        {message.steps && message.steps.length > 0 && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: "auto", opacity: 1 }}
                                                className="w-full space-y-2"
                                            >
                                                {message.steps.map((step, idx) => (
                                                    <Card key={idx} className="p-3 text-xs bg-muted/50 border-dashed">
                                                        {step.thought && (
                                                            <div className="flex gap-2">
                                                                <Sparkles className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                                                                <span className="italic text-muted-foreground truncate">{step.thought}</span>
                                                            </div>
                                                        )}
                                                        {step.action && (
                                                            <div className="mt-1 flex gap-2">
                                                                <ChevronRight className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                                                                <code className="bg-background px-1 rounded">调用工具: {step.action}</code>
                                                            </div>
                                                        )}
                                                    </Card>
                                                ))}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>

                {/* Input Area */}
                <div className="p-4 bg-background border-t">
                    <form onSubmit={handleSubmit} className="flex gap-2 max-w-4xl mx-auto">
                        <Input
                            placeholder="发送消息..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            className="flex-1 rounded-full px-6"
                            disabled={isTyping}
                        />
                        <Button type="submit" disabled={isTyping || !input.trim()} size="icon" className="rounded-full">
                            {isTyping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </Button>
                    </form>
                </div>
            </div>
        </div>
    );
}
