"use client";

import { useEffect, useState, useRef } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Plus,
    Play,
    Trash2,
    Loader2,
    AlertCircle,
    GitBranch,
    ChevronDown,
    Pencil,
    X,
    GripVertical,
    CheckCircle2,
    Circle,
    Zap,
    ArrowDown,
    Save,
    SquarePlay,
} from "lucide-react";
import { fetchApi, streamApi } from "@/lib/api";

type NodeType = "start" | "skill" | "condition" | "agent" | "end";

interface WorkflowNode {
    id: string;
    type: NodeType;
    label: string;
    config?: Record<string, string>;
}

interface WorkflowDefinition {
    id?: string;
    name: string;
    nodes: WorkflowNode[];
    createdAt?: string;
    updatedAt?: string;
}

const NODE_TYPE_CONFIG: Record<
    NodeType,
    { label: string; color: string; icon: React.ReactNode }
> = {
    start: {
        label: "开始",
        color: "bg-green-500/10 text-green-600 border-green-500/30",
        icon: <Circle className="w-3.5 h-3.5" />,
    },
    skill: {
        label: "技能",
        color: "bg-blue-500/10 text-blue-600 border-blue-500/30",
        icon: <Zap className="w-3.5 h-3.5" />,
    },
    condition: {
        label: "条件",
        color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
        icon: <GitBranch className="w-3.5 h-3.5" />,
    },
    agent: {
        label: "Agent",
        color: "bg-purple-500/10 text-purple-600 border-purple-500/30",
        icon: <SquarePlay className="w-3.5 h-3.5" />,
    },
    end: {
        label: "结束",
        color: "bg-red-500/10 text-red-600 border-red-500/30",
        icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    },
};

function generateId() {
    return Math.random().toString(36).slice(2, 9);
}

const DEFAULT_NEW_WORKFLOW: WorkflowDefinition = {
    name: "新建工作流",
    nodes: [
        { id: generateId(), type: "start", label: "开始" },
        { id: generateId(), type: "agent", label: "执行 Agent", config: { prompt: "" } },
        { id: generateId(), type: "end", label: "结束" },
    ],
};

// ---- Node Editor Component ----
function NodeCard({
    node,
    index,
    total,
    onUpdate,
    onDelete,
}: {
    node: WorkflowNode;
    index: number;
    total: number;
    onUpdate: (updated: WorkflowNode) => void;
    onDelete: () => void;
}) {
    const cfg = NODE_TYPE_CONFIG[node.type];
    const [expanded, setExpanded] = useState(false);

    const configEntries = Object.entries(node.config ?? {});

    return (
        <div className="relative">
            <div className={`rounded-lg border ${cfg.color} bg-card`}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                    <GripVertical className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${cfg.color}`}>
                        {cfg.icon}
                        {cfg.label}
                    </span>
                    <Input
                        className="h-7 flex-1 border-0 bg-transparent p-0 text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
                        value={node.label}
                        onChange={(e) =>
                            onUpdate({ ...node, label: e.target.value })
                        }
                        placeholder="节点标签..."
                    />
                    <div className="flex items-center gap-1 shrink-0">
                        {configEntries.length > 0 && (
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                onClick={() => setExpanded((v) => !v)}
                                title="展开配置"
                            >
                                <ChevronDown
                                    className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                                />
                            </Button>
                        )}
                        {/* Type selector */}
                        <select
                            className="text-[10px] bg-transparent border-0 outline-none cursor-pointer text-muted-foreground"
                            value={node.type}
                            onChange={(e) => {
                                const type = e.target.value as NodeType;
                                const defaultConfig: Record<string, string> =
                                    type === "skill"
                                        ? { skillName: "", params: "" }
                                        : type === "condition"
                                          ? { expression: "" }
                                          : type === "agent"
                                            ? { prompt: "" }
                                            : {};
                                onUpdate({ ...node, type, config: defaultConfig });
                            }}
                        >
                            {Object.entries(NODE_TYPE_CONFIG).map(([val, c]) => (
                                <option key={val} value={val}>
                                    {c.label}
                                </option>
                            ))}
                        </select>
                        {index !== 0 && index !== total - 1 && (
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={onDelete}
                            >
                                <X className="w-3.5 h-3.5" />
                            </Button>
                        )}
                    </div>
                </div>

                {expanded && configEntries.length > 0 && (
                    <div className="border-t px-3 py-2 space-y-1.5 bg-muted/20">
                        {configEntries.map(([key, value]) => (
                            <div key={key} className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-muted-foreground w-20 shrink-0">
                                    {key}
                                </span>
                                <Input
                                    className="h-6 text-xs flex-1"
                                    value={value}
                                    onChange={(e) =>
                                        onUpdate({
                                            ...node,
                                            config: {
                                                ...node.config,
                                                [key]: e.target.value,
                                            },
                                        })
                                    }
                                    placeholder={`配置 ${key}...`}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {/* Arrow between nodes */}
            {index < total - 1 && (
                <div className="flex justify-center py-1">
                    <ArrowDown className="w-4 h-4 text-muted-foreground/50" />
                </div>
            )}
        </div>
    );
}

// ---- Main Page ----
export default function WorkflowPage() {
    const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Editor state
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingWorkflow, setEditingWorkflow] =
        useState<WorkflowDefinition | null>(null);
    const [workflowDraft, setWorkflowDraft] = useState<WorkflowDefinition>(
        DEFAULT_NEW_WORKFLOW
    );
    const [savingWorkflow, setSavingWorkflow] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Execution state
    const [executingId, setExecutingId] = useState<string | null>(null);
    const [executionOutput, setExecutionOutput] = useState<
        Record<string, string[]>
    >({});
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const loadWorkflows = () => {
        setLoading(true);
        setError(null);
        fetchApi<WorkflowDefinition[]>("/api/workflows")
            .then((data) => {
                setWorkflows(Array.isArray(data) ? data : []);
                setLoading(false);
            })
            .catch((err) => {
                console.error("Failed to load workflows", err);
                setError("加载工作流失败。");
                setWorkflows([]);
                setLoading(false);
            });
    };

    useEffect(() => {
        loadWorkflows();
    }, []);

    const openCreate = () => {
        setEditingWorkflow(null);
        setWorkflowDraft({
            name: "新建工作流",
            nodes: [
                { id: generateId(), type: "start", label: "开始" },
                {
                    id: generateId(),
                    type: "agent",
                    label: "执行 Agent",
                    config: { prompt: "" },
                },
                { id: generateId(), type: "end", label: "结束" },
            ],
        });
        setSaveError(null);
        setEditorOpen(true);
    };

    const openEdit = (wf: WorkflowDefinition) => {
        setEditingWorkflow(wf);
        setWorkflowDraft({ ...wf });
        setSaveError(null);
        setEditorOpen(true);
    };

    const handleAddNode = () => {
        const newNode: WorkflowNode = {
            id: generateId(),
            type: "skill",
            label: "新节点",
            config: { skillName: "", params: "" },
        };
        // Insert before the last "end" node
        const nodes = [...workflowDraft.nodes];
        const lastIdx = nodes.length - 1;
        const insertAt =
            nodes[lastIdx]?.type === "end" ? lastIdx : nodes.length;
        nodes.splice(insertAt, 0, newNode);
        setWorkflowDraft({ ...workflowDraft, nodes });
    };

    const handleUpdateNode = (index: number, updated: WorkflowNode) => {
        const nodes = [...workflowDraft.nodes];
        nodes[index] = updated;
        setWorkflowDraft({ ...workflowDraft, nodes });
    };

    const handleDeleteNode = (index: number) => {
        const nodes = workflowDraft.nodes.filter((_, i) => i !== index);
        setWorkflowDraft({ ...workflowDraft, nodes });
    };

    const handleSaveWorkflow = async () => {
        setSaveError(null);
        if (!workflowDraft.name.trim()) {
            setSaveError("工作流名称不能为空。");
            return;
        }
        if (workflowDraft.nodes.length < 2) {
            setSaveError("工作流至少需要 2 个节点。");
            return;
        }
        setSavingWorkflow(true);
        try {
            if (editingWorkflow?.id) {
                await fetchApi(`/api/workflows/${editingWorkflow.id}`, {
                    method: "PUT",
                    body: JSON.stringify(workflowDraft),
                });
            } else {
                await fetchApi("/api/workflows", {
                    method: "POST",
                    body: JSON.stringify(workflowDraft),
                });
            }
            setEditorOpen(false);
            loadWorkflows();
        } catch (err: any) {
            setSaveError("保存失败: " + err.message);
        } finally {
            setSavingWorkflow(false);
        }
    };

    const handleExecute = async (id: string) => {
        if (executingId) return;
        setExecutingId(id);
        setExecutionOutput((prev) => ({ ...prev, [id]: ["开始执行工作流..."] }));

        abortRef.current = new AbortController();
        try {
            const gen = streamApi(
                `/api/workflows/${id}/execute`,
                {},
                abortRef.current.signal
            );
            for await (const chunk of gen) {
                const text =
                    typeof chunk === "string"
                        ? chunk
                        : chunk.content ?? chunk.text ?? JSON.stringify(chunk);
                setExecutionOutput((prev) => ({
                    ...prev,
                    [id]: [...(prev[id] ?? []), text],
                }));
            }
            setExecutionOutput((prev) => ({
                ...prev,
                [id]: [...(prev[id] ?? []), "✓ 执行完成"],
            }));
        } catch (err: any) {
            if (err.name !== "AbortError") {
                setExecutionOutput((prev) => ({
                    ...prev,
                    [id]: [...(prev[id] ?? []), `✗ 执行出错: ${err.message}`],
                }));
            }
        } finally {
            setExecutingId(null);
            abortRef.current = null;
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`确认删除工作流 "${name}"？`)) return;
        setDeletingId(id);
        try {
            await fetchApi(`/api/workflows/${id}`, { method: "DELETE" });
            setWorkflows((prev) => prev.filter((w) => w.id !== id));
            setExecutionOutput((prev) => {
                const copy = { ...prev };
                delete copy[id!];
                return copy;
            });
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
                        工作流
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        可视化编排多步 Agent 工作流，串联技能与条件判断。
                    </p>
                </div>
                <Button onClick={openCreate} className="gap-2">
                    <Plus className="w-4 h-4" />
                    新建工作流
                </Button>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            )}

            {/* Workflow List */}
            {loading ? (
                <div className="grid gap-4 md:grid-cols-2">
                    {[1, 2, 3].map((i) => (
                        <div
                            key={i}
                            className="h-40 rounded-xl border bg-card animate-pulse"
                        />
                    ))}
                </div>
            ) : workflows.length > 0 ? (
                <div className="space-y-6">
                    {workflows.map((wf) => (
                        <Card key={wf.id} className="overflow-hidden">
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="space-y-1">
                                        <CardTitle className="flex items-center gap-2 text-base">
                                            <GitBranch className="w-4 h-4 text-primary" />
                                            {wf.name}
                                        </CardTitle>
                                        <CardDescription className="flex items-center gap-3 text-xs">
                                            <Badge
                                                variant="secondary"
                                                className="text-[10px]"
                                            >
                                                {wf.nodes.length} 个节点
                                            </Badge>
                                            {wf.createdAt && (
                                                <span>
                                                    {new Date(
                                                        wf.createdAt
                                                    ).toLocaleDateString(
                                                        "zh-CN"
                                                    )}
                                                </span>
                                            )}
                                        </CardDescription>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-8 px-2 gap-1 text-xs"
                                            onClick={() => openEdit(wf)}
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                            编辑
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-8 px-2 gap-1 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                            onClick={() =>
                                                handleDelete(wf.id!, wf.name)
                                            }
                                            disabled={deletingId === wf.id}
                                        >
                                            {deletingId === wf.id ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <Trash2 className="w-3.5 h-3.5" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {/* Node flow preview */}
                                <div className="flex flex-wrap items-center gap-1">
                                    {wf.nodes.map((node, i) => {
                                        const cfg = NODE_TYPE_CONFIG[node.type];
                                        return (
                                            <div
                                                key={node.id}
                                                className="flex items-center gap-1"
                                            >
                                                <span
                                                    className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${cfg.color}`}
                                                >
                                                    {cfg.icon}
                                                    {node.label}
                                                </span>
                                                {i < wf.nodes.length - 1 && (
                                                    <span className="text-muted-foreground text-xs">
                                                        →
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Execution result */}
                                {executionOutput[wf.id!] && (
                                    <div className="rounded-md bg-muted/40 border p-3 space-y-1 max-h-40 overflow-y-auto">
                                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                                            执行输出
                                        </p>
                                        {executionOutput[wf.id!].map(
                                            (line, i) => (
                                                <p
                                                    key={i}
                                                    className="text-xs font-mono text-foreground/80"
                                                >
                                                    {line}
                                                </p>
                                            )
                                        )}
                                        {executingId === wf.id && (
                                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                执行中...
                                            </div>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="border-t pt-3">
                                <Button
                                    size="sm"
                                    onClick={() => handleExecute(wf.id!)}
                                    disabled={!!executingId}
                                    className="gap-2"
                                >
                                    {executingId === wf.id ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <Play className="w-3.5 h-3.5" />
                                    )}
                                    执行工作流
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            ) : (
                <div className="py-24 text-center border-2 border-dashed rounded-xl space-y-4">
                    <GitBranch className="w-12 h-12 text-muted-foreground mx-auto" />
                    <div>
                        <p className="font-medium text-muted-foreground">
                            暂无工作流
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                            点击「新建工作流」开始编排你的第一个 Agent 流程。
                        </p>
                    </div>
                </div>
            )}

            {/* Workflow Editor Dialog */}
            <Dialog
                open={editorOpen}
                onOpenChange={(open) => {
                    setEditorOpen(open);
                    if (!open) setSaveError(null);
                }}
            >
                <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>
                            {editingWorkflow ? "编辑工作流" : "新建工作流"}
                        </DialogTitle>
                        <DialogDescription>
                            在下方编辑节点流程，可调整节点类型、标签和配置。
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
                        <div className="grid gap-1.5">
                            <Label>工作流名称</Label>
                            <Input
                                value={workflowDraft.name}
                                onChange={(e) =>
                                    setWorkflowDraft({
                                        ...workflowDraft,
                                        name: e.target.value,
                                    })
                                }
                                placeholder="工作流名称..."
                            />
                        </div>

                        <div className="space-y-0">
                            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                                节点流程
                            </Label>
                            <div className="mt-2 space-y-0">
                                {workflowDraft.nodes.map((node, index) => (
                                    <NodeCard
                                        key={node.id}
                                        node={node}
                                        index={index}
                                        total={workflowDraft.nodes.length}
                                        onUpdate={(updated) =>
                                            handleUpdateNode(index, updated)
                                        }
                                        onDelete={() => handleDeleteNode(index)}
                                    />
                                ))}
                            </div>
                        </div>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleAddNode}
                            className="w-full gap-2 border-dashed"
                        >
                            <Plus className="w-4 h-4" />
                            添加节点
                        </Button>

                        {saveError && (
                            <div className="flex items-center gap-2 text-sm text-destructive">
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                {saveError}
                            </div>
                        )}
                    </div>

                    <DialogFooter className="border-t pt-4 mt-2">
                        <Button
                            variant="outline"
                            onClick={() => setEditorOpen(false)}
                        >
                            取消
                        </Button>
                        <Button
                            onClick={handleSaveWorkflow}
                            disabled={savingWorkflow}
                            className="gap-2"
                        >
                            {savingWorkflow ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Save className="w-4 h-4" />
                            )}
                            {editingWorkflow ? "保存修改" : "创建工作流"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
