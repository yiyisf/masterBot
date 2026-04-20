"use client";

import { useState, useCallback } from "react";
import { ActionBarPrimitive } from "@assistant-ui/react";
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, ChevronLeft, ChevronRight } from "lucide-react";
import { fetchApi } from "@/lib/api";

/** Copy button with copied state feedback */
export const CopyButton = () => {
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

/** Reload (retry) button */
export const ReloadButton = () => (
    <ActionBarPrimitive.Reload asChild>
        <button
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            title="重试"
        >
            <RefreshCw className="h-3.5 w-3.5" />
        </button>
    </ActionBarPrimitive.Reload>
);

/** Thumbs up / thumbs down feedback button */
export const FeedbackButton = ({
    rating,
    messageId,
    sessionId,
}: {
    rating: 'positive' | 'negative';
    messageId: string | null;
    sessionId: string;
}) => {
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

/** Branch picker (previous / next response branch) */
export const BranchPicker = () => (
    <div className="flex items-center gap-0.5 border-l pl-2 ml-1 border-border">
        <button className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] text-muted-foreground tabular-nums min-w-[28px] text-center">–</span>
        <button className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
        </button>
    </div>
);

/** Dynamic follow-up suggestion buttons */
export const SuggestionButtons = ({
    suggestions,
    onSelect,
}: {
    suggestions: string[];
    onSelect: (text: string) => void;
}) => {
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

/** Inline copy button for user messages */
export const InlineCopyButton = ({ text }: { text: string }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [text]);

    if (!text) return null;
    return (
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
    );
};
