"use client";

import { useEffect, useState } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Clock,
    Play,
    Plus,
    Trash2,
    Pencil,
    Loader2,
    AlertCircle,
    CheckCircle2,
    CalendarClock,
} from "lucide-react";
import { fetchApi } from "@/lib/api";

interface ScheduledTask {
    id: string;
    name: string;
    cronExpr: string;
    prompt: string;
    enabled: boolean;
    lastRun?: string;
    nextRun?: string;
    createdAt: string;
}

interface TaskForm {
    name: string;
    cronExpr: string;
    prompt: string;
    enabled: boolean;
}

const CRON_EXAMPLES = [
    { expr: "0 9 * * *", label: "每天 9 点" },
    { expr: "0 */2 * * *", label: "每 2 小时" },
    { expr: "0 9 * * 1", label: "每周一 9 点" },
    { expr: "*/30 * * * *", label: "每 30 分钟" },
    { expr: "0 0 1 * *", label: "每月 1 日" },
];

const EMPTY_FORM: TaskForm = {
    name: "",
    cronExpr: "",
    prompt: "",
    enabled: true,
};

function formatDate(iso?: string) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return iso;
    }
}

export default function ScheduledPage() {
    const [tasks, setTasks] = useState<ScheduledTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
    const [form, setForm] = useState<TaskForm>(EMPTY_FORM);
    const [formError, setFormError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const [triggeringId, setTriggeringId] = useState<string | null>(null);
    const [triggeredId, setTriggeredId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const loadTasks = () => {
        setLoading(true);
        setError(null);
        fetchApi<ScheduledTask[]>("/api/scheduled-tasks")
            .then((data) => {
                setTasks(Array.isArray(data) ? data : []);
                setLoading(false);
            })
            .catch((err) => {
                console.error(err);
                setError("加载定时任务失败。");
                setTasks([]);
                setLoading(false);
            });
    };

    useEffect(() => {
        loadTasks();
    }, []);

    const openCreate = () => {
        setEditingTask(null);
        setForm(EMPTY_FORM);
        setFormError(null);
        setDialogOpen(true);
    };

    const openEdit = (task: ScheduledTask) => {
        setEditingTask(task);
        setForm({
            name: task.name,
            cronExpr: task.cronExpr,
            prompt: task.prompt,
            enabled: task.enabled,
        });
        setFormError(null);
        setDialogOpen(true);
    };

    const handleSave = async () => {
        setFormError(null);
        if (!form.name.trim()) {
            setFormError("任务名称不能为空。");
            return;
        }
        if (!form.cronExpr.trim()) {
            setFormError("Cron 表达式不能为空。");
            return;
        }
        if (!form.prompt.trim()) {
            setFormError("提示词不能为空。");
            return;
        }

        setSaving(true);
        try {
            if (editingTask) {
                await fetchApi(`/api/scheduled-tasks/${editingTask.id}`, {
                    method: "PATCH",
                    body: JSON.stringify(form),
                });
            } else {
                await fetchApi("/api/scheduled-tasks", {
                    method: "POST",
                    body: JSON.stringify(form),
                });
            }
            setDialogOpen(false);
            loadTasks();
        } catch (err: any) {
            setFormError("保存失败: " + err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleToggleEnabled = async (task: ScheduledTask) => {
        try {
            await fetchApi(`/api/scheduled-tasks/${task.id}`, {
                method: "PATCH",
                body: JSON.stringify({ ...task, enabled: !task.enabled }),
            });
            setTasks((prev) =>
                prev.map((t) =>
                    t.id === task.id ? { ...t, enabled: !t.enabled } : t
                )
            );
        } catch (err) {
            console.error("Toggle failed", err);
        }
    };

    const handleTrigger = async (id: string) => {
        setTriggeringId(id);
        try {
            await fetchApi(`/api/scheduled-tasks/${id}/trigger`, {
                method: "POST",
            });
            setTriggeredId(id);
            setTimeout(() => setTriggeredId(null), 2500);
        } catch (err: any) {
            alert("触发失败: " + err.message);
        } finally {
            setTriggeringId(null);
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`确认删除任务 "${name}"？`)) return;
        setDeletingId(id);
        try {
            await fetchApi(`/api/scheduled-tasks/${id}`, {
                method: "DELETE",
            });
            setTasks((prev) => prev.filter((t) => t.id !== id));
        } catch (err: any) {
            alert("删除失败: " + err.message);
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="h-full overflow-y-auto w-full max-w-5xl mx-auto p-6 space-y-8 pb-10">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">
                        定时任务
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        配置 Cron 定时任务，让 Agent 自动执行周期性工作。
                    </p>
                </div>
                <Button onClick={openCreate} className="gap-2">
                    <Plus className="w-4 h-4" />
                    新建任务
                </Button>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            )}

            {/* Cron Reference */}
            <Card className="bg-muted/30">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2 font-medium">
                        <Clock className="w-4 h-4 text-primary" />
                        Cron 表达式参考
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-2">
                        {CRON_EXAMPLES.map((ex) => (
                            <div
                                key={ex.expr}
                                className="flex items-center gap-2 bg-background rounded-md border px-3 py-1.5 text-sm"
                            >
                                <code className="font-mono text-primary text-xs">
                                    {ex.expr}
                                </code>
                                <span className="text-muted-foreground text-xs">
                                    {ex.label}
                                </span>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Task Table */}
            {loading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <div
                            key={i}
                            className="h-16 rounded-lg border bg-card animate-pulse"
                        />
                    ))}
                </div>
            ) : tasks.length > 0 ? (
                <div className="rounded-xl border overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/40">
                                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                                        名称
                                    </th>
                                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                                        Cron 表达式
                                    </th>
                                    <th className="text-left px-4 py-3 font-medium text-muted-foreground max-w-[200px]">
                                        提示词
                                    </th>
                                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                                        状态
                                    </th>
                                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                                        下次执行
                                    </th>
                                    <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">
                                        上次执行
                                    </th>
                                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                                        操作
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {tasks.map((task) => (
                                    <tr
                                        key={task.id}
                                        className="group hover:bg-muted/20 transition-colors"
                                    >
                                        <td className="px-4 py-3 font-medium">
                                            {task.name}
                                        </td>
                                        <td className="px-4 py-3">
                                            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-primary">
                                                {task.cronExpr}
                                            </code>
                                        </td>
                                        <td className="px-4 py-3 max-w-[200px]">
                                            <span
                                                className="truncate block text-muted-foreground text-xs"
                                                title={task.prompt}
                                            >
                                                {task.prompt.length > 60
                                                    ? task.prompt.slice(
                                                          0,
                                                          60
                                                      ) + "…"
                                                    : task.prompt}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <Switch
                                                checked={task.enabled}
                                                onCheckedChange={() =>
                                                    handleToggleEnabled(task)
                                                }
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                            <span className="flex items-center gap-1">
                                                <CalendarClock className="w-3 h-3" />
                                                {formatDate(task.nextRun)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                                            {formatDate(task.lastRun)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-1">
                                                {triggeredId === task.id ? (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[10px] text-green-500 border-green-500/30 gap-1"
                                                    >
                                                        <CheckCircle2 className="w-3 h-3" />
                                                        已触发
                                                    </Badge>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-7 px-2 gap-1 text-xs"
                                                        onClick={() =>
                                                            handleTrigger(
                                                                task.id
                                                            )
                                                        }
                                                        disabled={
                                                            triggeringId ===
                                                            task.id
                                                        }
                                                        title="立即触发"
                                                    >
                                                        {triggeringId ===
                                                        task.id ? (
                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                        ) : (
                                                            <Play className="w-3 h-3" />
                                                        )}
                                                        触发
                                                    </Button>
                                                )}
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-7 px-2 gap-1 text-xs"
                                                    onClick={() =>
                                                        openEdit(task)
                                                    }
                                                    title="编辑"
                                                >
                                                    <Pencil className="w-3 h-3" />
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                    onClick={() =>
                                                        handleDelete(
                                                            task.id,
                                                            task.name
                                                        )
                                                    }
                                                    disabled={
                                                        deletingId === task.id
                                                    }
                                                    title="删除"
                                                >
                                                    {deletingId === task.id ? (
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="w-3 h-3" />
                                                    )}
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="py-24 text-center border-2 border-dashed rounded-xl space-y-4">
                    <Clock className="w-12 h-12 text-muted-foreground mx-auto" />
                    <div>
                        <p className="font-medium text-muted-foreground">
                            暂无定时任务
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                            点击「新建任务」创建第一个定时 Agent 任务。
                        </p>
                    </div>
                </div>
            )}

            {/* Create / Edit Dialog */}
            <Dialog
                open={dialogOpen}
                onOpenChange={(open) => {
                    setDialogOpen(open);
                    if (!open) setFormError(null);
                }}
            >
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {editingTask ? "编辑任务" : "新建定时任务"}
                        </DialogTitle>
                        <DialogDescription>
                            配置 Cron 表达式和 Agent 提示词，系统将按计划自动执行。
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-1.5">
                            <Label>任务名称</Label>
                            <Input
                                placeholder="例：每日报告生成"
                                value={form.name}
                                onChange={(e) =>
                                    setForm({ ...form, name: e.target.value })
                                }
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>
                                Cron 表达式
                                <span className="ml-2 text-xs text-muted-foreground font-normal">
                                    (分 时 日 月 周)
                                </span>
                            </Label>
                            <Input
                                placeholder="0 9 * * *"
                                value={form.cronExpr}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        cronExpr: e.target.value,
                                    })
                                }
                                className="font-mono"
                            />
                            <div className="flex flex-wrap gap-1 mt-1">
                                {CRON_EXAMPLES.map((ex) => (
                                    <button
                                        key={ex.expr}
                                        type="button"
                                        className="text-[10px] px-2 py-0.5 rounded border bg-muted hover:bg-muted/70 font-mono transition-colors"
                                        onClick={() =>
                                            setForm({
                                                ...form,
                                                cronExpr: ex.expr,
                                            })
                                        }
                                    >
                                        {ex.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Agent 提示词</Label>
                            <Textarea
                                placeholder="请生成今日业务摘要报告，包含关键指标和异常情况..."
                                value={form.prompt}
                                onChange={(e) =>
                                    setForm({ ...form, prompt: e.target.value })
                                }
                                className="min-h-[100px] resize-y"
                            />
                        </div>
                        <div className="flex items-center gap-3">
                            <Switch
                                id="enabled"
                                checked={form.enabled}
                                onCheckedChange={(checked) =>
                                    setForm({ ...form, enabled: checked })
                                }
                            />
                            <Label htmlFor="enabled">启用任务</Label>
                        </div>
                        {formError && (
                            <div className="flex items-center gap-2 text-sm text-destructive">
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                {formError}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDialogOpen(false)}
                        >
                            取消
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={saving}
                            className="gap-2"
                        >
                            {saving && (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            )}
                            {editingTask ? "保存修改" : "创建任务"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
