"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ComposerPrimitive, ThreadPrimitive, useAttachment, useAttachmentRuntime } from "@assistant-ui/react";
import { useComposerRuntime } from "@assistant-ui/react";
import { useRouter } from "next/navigation";
import {
    BookOpen,
    BrainCircuit,
    GitBranch,
    ListTodo,
    Paperclip,
    X,
    Zap,
    ArrowUp,
    Square,
} from "lucide-react";

// ── Slash command definitions ────────────────────────────────────────────────

interface SlashCommand {
    id: string;
    label: string;
    description: string;
    icon: React.ReactNode;
    /** Replace input text and close panel */
    text?: string;
    /** Navigate to a route and close panel */
    href?: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
    {
        id: "plan",
        label: "/plan",
        description: "分解任务为步骤，让 Agent 先规划再执行",
        icon: <ListTodo className="w-4 h-4" />,
        text: "请将以下任务分解为可执行步骤：\n",
    },
    {
        id: "memory",
        label: "/memory",
        description: "打开记忆库，搜索历史记忆",
        icon: <BrainCircuit className="w-4 h-4" />,
        href: "/memory",
    },
    {
        id: "skill",
        label: "/skill",
        description: "跳转技能管理，安装或生成新技能",
        icon: <Zap className="w-4 h-4" />,
        href: "/skills",
    },
    {
        id: "dag",
        label: "/dag",
        description: "展示当前会话的任务执行状态",
        icon: <GitBranch className="w-4 h-4" />,
        text: "显示当前会话的所有任务执行状态\n",
    },
    {
        id: "template",
        label: "/template",
        description: "浏览 Prompt 模板库，快速选用企业模板",
        icon: <BookOpen className="w-4 h-4" />,
        href: "/prompts",
    },
];

// ── Slash command panel ──────────────────────────────────────────────────────

function SlashPanel({
    query,
    onSelect,
    onClose,
}: {
    query: string;
    onSelect: (cmd: SlashCommand) => void;
    onClose: () => void;
}) {
    const [activeIdx, setActiveIdx] = useState(0);

    const filtered = SLASH_COMMANDS.filter(
        (c) =>
            query === "" ||
            c.id.startsWith(query.toLowerCase()) ||
            c.label.includes(query.toLowerCase())
    );

    // Keyboard navigation — listen on document while panel is open
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => (i + 1) % filtered.length);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
            } else if (e.key === "Enter" && filtered[activeIdx]) {
                e.preventDefault();
                e.stopPropagation();
                onSelect(filtered[activeIdx]);
            } else if (e.key === "Escape") {
                onClose();
            }
        };
        document.addEventListener("keydown", handler, true);
        return () => document.removeEventListener("keydown", handler, true);
    }, [filtered, activeIdx, onSelect, onClose]);

    // Reset active index when query changes
    useEffect(() => { setActiveIdx(0); }, [query]);

    if (filtered.length === 0) return null;

    return (
        <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
            <div className="rounded-xl border bg-popover shadow-lg overflow-hidden">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 pt-2 pb-1">
                    快捷命令
                </p>
                {filtered.map((cmd, i) => (
                    <button
                        key={cmd.id}
                        type="button"
                        onMouseDown={(e) => {
                            e.preventDefault(); // prevent textarea blur
                            onSelect(cmd);
                        }}
                        onMouseEnter={() => setActiveIdx(i)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                            i === activeIdx
                                ? "bg-accent text-accent-foreground"
                                : "hover:bg-accent/50"
                        }`}
                    >
                        <span className="text-muted-foreground shrink-0">{cmd.icon}</span>
                        <div className="min-w-0">
                            <p className="text-sm font-medium font-mono">{cmd.label}</p>
                            <p className="text-xs text-muted-foreground truncate">{cmd.description}</p>
                        </div>
                    </button>
                ))}
                <p className="text-[10px] text-muted-foreground px-3 py-1.5 border-t bg-muted/30">
                    ↑↓ 选择 · Enter 确认 · Esc 关闭
                </p>
            </div>
        </div>
    );
}

// ── Custom Composer with slash command support ────────────────────────────────

// ── Attachment preview pill ──────────────────────────────────────────────────

function AttachmentPreview() {
    const attachment = useAttachment();
    const runtime = useAttachmentRuntime();
    const isImage = attachment.type === "image";

    return (
        <div className="relative inline-flex items-center gap-1.5 bg-muted border rounded-lg px-2.5 py-1.5 text-xs max-w-[160px]">
            {isImage && (attachment as any).content?.[0]?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={(attachment as any).content[0].image}
                    alt={attachment.name}
                    className="h-8 w-8 object-cover rounded"
                />
            ) : (
                <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="truncate text-foreground/80">{attachment.name}</span>
            <button
                type="button"
                onClick={() => runtime.remove()}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                title="移除附件"
            >
                <X className="w-3 h-3" />
            </button>
        </div>
    );
}

/**
 * Drop-in replacement for the default Thread Composer.
 * Detects "/" at the start of input and shows a slash command panel.
 * Pass as: <Thread components={{ Composer: SlashComposer }} />
 */
export function SlashComposer() {
    const router = useRouter();
    const composerRuntime = useComposerRuntime();
    const [slashQuery, setSlashQuery] = useState<string | null>(null);
    const [attachmentCount, setAttachmentCount] = useState(0);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Track attachment count for button highlight
    useEffect(() => {
        const unsub = composerRuntime.subscribe(() => {
            const state = composerRuntime.getState();
            setAttachmentCount((state as any).attachments?.length ?? 0);
        });
        return unsub;
    }, [composerRuntime]);

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            const val = e.target.value;
            if (val === "/" || (val.startsWith("/") && !val.includes("\n") && val.length < 20)) {
                setSlashQuery(val.slice(1));
            } else {
                setSlashQuery(null);
            }
        },
        []
    );

    const handleSelect = useCallback(
        (cmd: SlashCommand) => {
            setSlashQuery(null);
            if (cmd.href) {
                composerRuntime.setText("");
                router.push(cmd.href);
            } else if (cmd.text !== undefined) {
                composerRuntime.setText(cmd.text);
                // Focus the input so user can continue typing after the preset text
                setTimeout(() => inputRef.current?.focus(), 50);
            }
        },
        [composerRuntime, router]
    );

    const handleClose = useCallback(() => setSlashQuery(null), []);

    // Auto-expand textarea height as user types, up to 240px
    const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
        const el = e.currentTarget;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 240) + 'px';
    }, []);

    // Reset height after message is sent (runtime clears the value → re-render → effect fires)
    useEffect(() => {
        if (inputRef.current && inputRef.current.value === '') {
            inputRef.current.style.height = 'auto';
        }
    });

    return (
        <ComposerPrimitive.Root className="aui-composer-root relative">
            {slashQuery !== null && (
                <SlashPanel
                    query={slashQuery}
                    onSelect={handleSelect}
                    onClose={handleClose}
                />
            )}

            {/* Attachment preview area */}
            <ComposerPrimitive.Attachments
                components={{
                    Attachment: AttachmentPreview,
                }}
            />

            <ComposerPrimitive.Input
                ref={inputRef}
                rows={1}
                autoFocus
                className="aui-composer-input max-h-60 overflow-y-auto"
                placeholder="输入消息… 按 / 打开命令"
                onChange={handleChange}
                onInput={handleInput}
            />

            {/* Paperclip add-attachment button — highlights when attachments exist */}
            <ComposerPrimitive.AddAttachment asChild>
                <button
                    type="button"
                    title={`添加附件 — 支持图片（PNG/JPG/GIF/WebP）、PDF、CSV、TXT、MD${attachmentCount > 0 ? `（已添加 ${attachmentCount} 个）` : ''}`}
                    className={`relative inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors shrink-0 ${
                        attachmentCount > 0
                            ? 'text-primary hover:bg-primary/10'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'
                    }`}
                >
                    <Paperclip className="w-4 h-4" />
                    {attachmentCount > 0 && (
                        <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center leading-none">
                            {attachmentCount > 9 ? '9+' : attachmentCount}
                        </span>
                    )}
                </button>
            </ComposerPrimitive.AddAttachment>

            <ThreadPrimitive.If running={false}>
                <ComposerPrimitive.Send asChild>
                    <button
                        type="button"
                        title="发送"
                        className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                    >
                        <ArrowUp className="w-4 h-4" />
                    </button>
                </ComposerPrimitive.Send>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running>
                <ComposerPrimitive.Cancel asChild>
                    <button
                        type="button"
                        title="终止"
                        className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border bg-background hover:bg-muted text-foreground transition-colors shrink-0"
                    >
                        <Square className="w-3.5 h-3.5 fill-current" />
                    </button>
                </ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
        </ComposerPrimitive.Root>
    );
}
