"use client";

import { useState, useCallback } from "react";
import { useThreadRuntime } from "@assistant-ui/react";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bookmark, RotateCcw, Trash2, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

/** 历史消息水合时每条消息的最大显示字符数，超出部分折叠提示 */
const HYDRATION_MAX_CHARS = 20_000;

interface CheckpointInfo {
    id: string;
    sessionId: string;
    label: string;
    messageCount: number;
    createdAt: string;
}

interface CheckpointPanelProps {
    sessionId: string;
    /** 恢复并导入线程成功后的额外回调（可选） */
    onRestore?: () => void;
}

export function CheckpointPanel({ sessionId, onRestore }: CheckpointPanelProps) {
    const thread = useThreadRuntime();
    const [open, setOpen] = useState(false);
    const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const fetchCheckpoints = useCallback(async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/checkpoints`);
            if (res.ok) setCheckpoints(await res.json());
        } catch {
            toast.error("获取检查点列表失败");
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    const handleOpenChange = (v: boolean) => {
        setOpen(v);
        if (v) fetchCheckpoints();
    };

    const handleSave = async () => {
        if (!sessionId) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/checkpoints`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            const { messageCount } = await res.json();
            toast.success(`检查点已创建（${messageCount} 条消息）`);
            await fetchCheckpoints();
        } catch (err: any) {
            toast.error(`创建失败：${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleRestore = async (cpId: string, label: string) => {
        try {
            const res = await fetch(`/api/sessions/${sessionId}/checkpoints/${cpId}/restore`, {
                method: "POST",
            });
            if (!res.ok) throw new Error((await res.json()).error);
            const { messages } = await res.json();

            // 将 DB 格式消息转换为 thread 格式，并通过 thread.import 重置对话视图
            const threadMessages = (messages as any[])
                .filter((m: any) => m.role === "user" || m.role === "assistant")
                .map((m: any) => {
                    let text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
                    if (text.length > HYDRATION_MAX_CHARS) {
                        text = text.slice(0, HYDRATION_MAX_CHARS) + `\n\n… [历史内容已折叠，共 ${text.length} 字符]`;
                    }
                    const id = m.id ? String(m.id) : nanoid();
                    const createdAt = m.createdAt ? new Date(m.createdAt) : new Date();
                    const content = [{ type: "text" as const, text }];

                    if (m.role === "assistant") {
                        return {
                            id, role: "assistant" as const, content,
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
                        id, role: "user" as const, content, createdAt,
                        attachments: [] as readonly never[],
                        metadata: { custom: {} as Record<string, unknown> },
                    };
                });

            if (typeof (thread as any).import === "function") {
                (thread as any).import({
                    messages: threadMessages.map((msg, idx) => ({
                        message: msg,
                        parentId: idx === 0 ? null : threadMessages[idx - 1].id,
                    })),
                });
            }

            toast.success(`已恢复到「${label}」`);
            setOpen(false);
            onRestore?.();
        } catch (err: any) {
            toast.error(`恢复失败：${err.message}`);
        }
    };

    const handleDelete = async (cpId: string) => {
        try {
            const res = await fetch(`/api/sessions/${sessionId}/checkpoints/${cpId}`, {
                method: "DELETE",
            });
            if (!res.ok) throw new Error((await res.json()).error);
            setCheckpoints(prev => prev.filter(c => c.id !== cpId));
            toast.success("检查点已删除");
        } catch (err: any) {
            toast.error(`删除失败：${err.message}`);
        }
    };

    const formatTime = (iso: string) => {
        try {
            return new Date(iso).toLocaleString("zh-CN", {
                month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit",
            });
        } catch {
            return iso;
        }
    };

    return (
        <DropdownMenu open={open} onOpenChange={handleOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-2 gap-1.5 text-muted-foreground hover:text-foreground">
                    <Bookmark className="h-4 w-4" />
                    <span className="text-xs hidden sm:inline">检查点</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-80 p-0" align="end">
                <div className="flex items-center justify-between px-3 py-2 border-b">
                    <span className="text-sm font-medium">对话检查点</span>
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 gap-1 text-xs"
                        onClick={handleSave}
                        disabled={saving || !sessionId}
                    >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        保存当前
                    </Button>
                </div>

                <ScrollArea className="max-h-64">
                    {loading ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : checkpoints.length === 0 ? (
                        <p className="text-center text-xs text-muted-foreground py-6">
                            暂无检查点<br />
                            <span className="text-[11px]">点击「保存当前」创建一个</span>
                        </p>
                    ) : (
                        <div className="divide-y">
                            {checkpoints.map(cp => (
                                <div key={cp.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium truncate">{cp.label}</p>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <span className="text-[11px] text-muted-foreground">{formatTime(cp.createdAt)}</span>
                                            <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                                                {cp.messageCount} 条
                                            </Badge>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <Button
                                            variant="ghost" size="icon"
                                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                            onClick={() => handleRestore(cp.id, cp.label)}
                                            title="恢复到此检查点"
                                        >
                                            <RotateCcw className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost" size="icon"
                                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                            onClick={() => handleDelete(cp.id)}
                                            title="删除检查点"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>
                <div className="px-3 py-1.5 border-t">
                    <p className="text-[11px] text-muted-foreground">
                        恢复后对话视图重置到该节点，不影响已有消息记录
                    </p>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
