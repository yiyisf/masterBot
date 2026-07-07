"use client";

import { useEffect, useState } from "react";
import {
    BookOpen,
    BrainCircuit,
    GitBranch,
    ListTodo,
    Zap,
} from "lucide-react";

// ── Slash command definitions ────────────────────────────────────────────────

export interface SlashCommand {
    id: string;
    label: string;
    description: string;
    icon: React.ReactNode;
    /** Replace input text and close panel */
    text?: string;
    /** Navigate to a route and close panel */
    href?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
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

export function SlashPanel({
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
