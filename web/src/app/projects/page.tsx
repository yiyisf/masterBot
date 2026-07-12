"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { TwoPhasePrototype } from "./two-phase-prototype";

// ─────────────────────────── 领域模型（对齐后端 repository） ───────────────────────────

type RequirementStatus =
    | "synced" | "queued" | "in_progress" | "waiting_input"
    | "implemented" | "merged" | "failed" | "cancelled";

type ExecutionEngineKind = "claude-code" | "codex" | "opencode" | "pi";

interface Project {
    id: string;
    name: string;
    dir: string;
    description: string | null;
    syncSource: string;
    lastSyncedAt: string | null;
    maxConcurrentRuns: number;
}

interface Requirement {
    id: string;
    projectId: string;
    reqKey: string;
    source: string;
    sourceKey: string;
    title: string;
    description: string | null;
    labels: string[];
    status: RequirementStatus;
    sourceUrl: string | null;
    sourceClosed: boolean;
    updatedAt: string;
}

interface RequirementRun {
    id: string;
    requirementId: string;
    engine: string;
    status: "running" | "waiting_input" | "succeeded" | "failed" | "cancelled";
    retryNo: number;
    prUrl: string | null;
    errorMessage: string | null;
    sessionId: string;
    startedAt: string;
    finishedAt: string | null;
}

interface AgentStepPayload {
    type: string;
    content?: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    interruptId?: string;
    interruptReason?: string;
}

interface SessionEvent {
    id: string;
    sessionId: string;
    timestamp: number;
    type: string;
    payload: Record<string, unknown>;
}

const STATUS_COLUMNS: RequirementStatus[] = [
    "synced", "queued", "in_progress", "waiting_input",
    "implemented", "merged", "failed", "cancelled",
];

const STATUS_META: Record<RequirementStatus, { label: string; cls: string }> = {
    synced: { label: "已同步", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    queued: { label: "已排队", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
    in_progress: { label: "实施中", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
    waiting_input: { label: "等待回答", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
    implemented: { label: "待核验", cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
    merged: { label: "已完成", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
    failed: { label: "失败", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
    cancelled: { label: "已取消", cls: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
};

const AGENTS: ExecutionEngineKind[] = ["claude-code", "codex", "opencode", "pi"];
const STARTABLE_STATUSES: RequirementStatus[] = ["synced", "queued"];
const BOARD_POLL_MS = 3000;
const SHEET_POLL_MS = 3000;

const STEP_ICON: Record<string, string> = {
    meta: "ⓘ", thought: "💭", action: "⚙", observation: "👁",
    content: "💬", answer: "✅", interrupt: "❓",
};

function StatusBadge({ status }: { status: RequirementStatus }) {
    const meta = STATUS_META[status];
    return <Badge variant="outline" className={`border-transparent ${meta.cls}`}>{meta.label}</Badge>;
}

function Timeline({ events }: { events: SessionEvent[] }) {
    const steps = events.filter((e) => e.type === "agent_step");
    if (steps.length === 0) {
        return <p className="text-sm text-muted-foreground">暂无执行记录。</p>;
    }
    return (
        <ol className="space-y-2">
            {steps.map((e) => {
                const p = e.payload as unknown as AgentStepPayload;
                const isInterrupt = p.type === "interrupt";
                return (
                    <li
                        key={e.id}
                        className={`flex gap-2 rounded-md border p-2 text-sm ${isInterrupt ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : "border-border"}`}
                    >
                        <span className="shrink-0">{STEP_ICON[p.type] ?? "•"}</span>
                        <div className="min-w-0 flex-1">
                            <div className="break-words">
                                {p.toolName && (
                                    <span className="mr-1 rounded bg-muted px-1 font-mono text-xs">{p.toolName}</span>
                                )}
                                {p.content || (isInterrupt ? p.interruptReason : "")}
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                                {new Date(e.timestamp).toLocaleTimeString()}
                            </div>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}

function QuestionCard({ onAnswer }: { onAnswer: (text: string) => Promise<void> }) {
    const [text, setText] = useState("");
    const [submitting, setSubmitting] = useState(false);
    return (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/30">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                ❓ Agent 需要你的回答
            </div>
            <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="输入你的回答…"
                className="mb-2 bg-background"
                rows={2}
                disabled={submitting}
            />
            <Button
                size="sm"
                disabled={!text.trim() || submitting}
                onClick={async () => {
                    setSubmitting(true);
                    try {
                        await onAnswer(text);
                        setText("");
                    } finally {
                        setSubmitting(false);
                    }
                }}
            >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : "提交回答，继续执行"}
            </Button>
        </div>
    );
}

function NewProjectDialog({ open, onOpenChange, onCreated }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (project: Project) => void;
}) {
    const [name, setName] = useState("");
    const [dir, setDir] = useState("");
    const [description, setDescription] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!name.trim() || !dir.trim()) return;
        setSubmitting(true);
        setError(null);
        try {
            const project = await fetchApi<Project>("/api/projects", {
                method: "POST",
                body: JSON.stringify({ name: name.trim(), dir: dir.trim(), description: description.trim() || undefined }),
            });
            onCreated(project);
            setName(""); setDir(""); setDescription("");
            onOpenChange(false);
        } catch (err: any) {
            setError(err.message ?? "创建失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>新建项目</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <Label htmlFor="project-name">项目名（req_key 前缀，唯一）</Label>
                        <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="cmasterBot" />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="project-dir">主分支目录（绝对路径）</Label>
                        <Input id="project-dir" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="/Users/you/work/cmasterBot" />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="project-desc">描述（可选）</Label>
                        <Textarea id="project-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                </div>
                <DialogFooter>
                    <Button disabled={!name.trim() || !dir.trim() || submitting} onClick={submit}>
                        {submitting ? <Loader2 className="size-4 animate-spin" /> : "创建"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function NewRequirementDialog({ open, onOpenChange, projectId, onCreated }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    onCreated: () => void;
}) {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!title.trim()) return;
        setSubmitting(true);
        setError(null);
        try {
            await fetchApi(`/api/projects/${projectId}/requirements`, {
                method: "POST",
                body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined }),
            });
            setTitle(""); setDescription("");
            onOpenChange(false);
            onCreated();
        } catch (err: any) {
            setError(err.message ?? "创建失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>手动创建需求</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <Label htmlFor="req-title">标题</Label>
                        <Input id="req-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="req-desc">描述（可选）</Label>
                        <Textarea id="req-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                </div>
                <DialogFooter>
                    <Button disabled={!title.trim() || submitting} onClick={submit}>
                        {submitting ? <Loader2 className="size-4 animate-spin" /> : "创建"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function RequirementDetailSheet({ requirement, onOpenChange, onChanged }: {
    requirement: Requirement | null;
    onOpenChange: (open: boolean) => void;
    onChanged: () => void;
}) {
    const [agent, setAgent] = useState<ExecutionEngineKind>("claude-code");
    const [runs, setRuns] = useState<RequirementRun[]>([]);
    const [events, setEvents] = useState<SessionEvent[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const latestRun = runs[0] ?? null;

    const loadDetail = useCallback(async () => {
        if (!requirement) return;
        try {
            const runList = await fetchApi<RequirementRun[]>(`/api/requirements/${requirement.id}/runs`);
            setRuns(runList);
            const latest = runList[0];
            if (latest) {
                const { events: evts } = await fetchApi<{ events: SessionEvent[] }>(
                    `/api/requirements/${requirement.id}/runs/${latest.id}/events`
                );
                setEvents(evts);
            } else {
                setEvents([]);
            }
        } catch {
            // 静默失败：不打断详情面板的其他交互
        }
    }, [requirement]);

    useEffect(() => {
        setRuns([]); setEvents([]); setError(null);
        if (!requirement) return;
        loadDetail();
        const timer = setInterval(loadDetail, SHEET_POLL_MS);
        return () => clearInterval(timer);
    }, [requirement, loadDetail]);

    if (!requirement) return null;

    const runAction = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await fn();
            await loadDetail();
            onChanged();
        } catch (err: any) {
            setError(err.message ?? "操作失败");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet open={!!requirement} onOpenChange={onOpenChange}>
            <SheetContent className="w-[480px] overflow-y-auto sm:max-w-[480px]">
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                        <span className="font-mono text-sm text-muted-foreground">{requirement.reqKey}</span>
                        <StatusBadge status={requirement.status} />
                    </SheetTitle>
                </SheetHeader>
                <div className="space-y-3 px-4 pb-6">
                    <h3 className="font-medium">{requirement.title}</h3>
                    {requirement.description && (
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{requirement.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1">
                        {requirement.labels.map((l) => <Badge key={l} variant="secondary" className="text-[10px]">{l}</Badge>)}
                        {requirement.sourceUrl && (
                            <a href={requirement.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                                查看来源
                            </a>
                        )}
                        {requirement.sourceClosed && <span className="text-xs text-red-500">（远程已关闭）</span>}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {STARTABLE_STATUSES.includes(requirement.status) && (
                            <span className="inline-flex items-center gap-1">
                                <Select value={agent} onValueChange={(v) => setAgent(v as ExecutionEngineKind)}>
                                    <SelectTrigger size="sm" className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {AGENTS.map((a) => (
                                            <SelectItem key={a} value={a}>
                                                {a}{a !== "claude-code" ? "（无人值守）" : ""}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button size="sm" disabled={busy} onClick={() => runAction(() =>
                                    fetchApi(`/api/requirements/${requirement.id}/start`, { method: "POST", body: JSON.stringify({ engine: agent }) })
                                )}>
                                    发起研发
                                </Button>
                            </span>
                        )}
                        {requirement.status === "failed" && (
                            <Button size="sm" disabled={busy} onClick={() => runAction(() =>
                                fetchApi(`/api/requirements/${requirement.id}/retry`, { method: "POST" })
                            )}>
                                重试
                            </Button>
                        )}
                        {(requirement.status === "in_progress" || requirement.status === "waiting_input") && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => runAction(() =>
                                fetchApi(`/api/requirements/${requirement.id}/cancel`, { method: "POST" })
                            )}>
                                取消
                            </Button>
                        )}
                        {requirement.status === "implemented" && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => runAction(() =>
                                fetchApi(`/api/requirements/${requirement.id}/merge`, { method: "POST" })
                            )}>
                                ✓ 核验通过，合并 PR
                            </Button>
                        )}
                        {latestRun?.prUrl && (
                            <a href={latestRun.prUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                                查看 PR
                            </a>
                        )}
                    </div>
                    {latestRun && (
                        <p className="text-xs text-muted-foreground">
                            引擎：{latestRun.engine}{latestRun.retryNo > 0 ? ` · 第 ${latestRun.retryNo + 1} 次尝试` : ""}
                            {latestRun.errorMessage ? ` · ${latestRun.errorMessage}` : ""}
                        </p>
                    )}
                    {error && <p className="text-sm text-destructive">{error}</p>}

                    {requirement.status === "waiting_input" && latestRun && (
                        <QuestionCard onAnswer={(text) => runAction(() =>
                            fetchApi(`/api/sessions/${latestRun.sessionId}/interrupt-response`, {
                                method: "POST",
                                body: JSON.stringify({ approved: true, response: text }),
                            })
                        )} />
                    )}

                    <Separator />
                    <div className="text-sm font-medium">执行过程</div>
                    <Timeline events={events} />
                </div>
            </SheetContent>
        </Sheet>
    );
}

export default function ProjectsPage() {
    // PROTOTYPE（ticket #82）：?variant=A|B|C 打开两阶段详情面板原型，评审后整体移除
    const [prototypeVariant, setPrototypeVariant] = useState<string | null>(() =>
        typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("variant"));
    const changePrototypeVariant = (v: string | null) => {
        setPrototypeVariant(v);
        const url = new URL(window.location.href);
        if (v) url.searchParams.set("variant", v); else url.searchParams.delete("variant");
        window.history.replaceState(null, "", url.toString());
    };

    const [projects, setProjects] = useState<Project[]>([]);
    const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
    const [requirements, setRequirements] = useState<Requirement[]>([]);
    const [sheetRequirement, setSheetRequirement] = useState<Requirement | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const [newRequirementOpen, setNewRequirementOpen] = useState(false);

    const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

    const loadProjects = useCallback(async () => {
        try {
            const list = await fetchApi<Project[]>("/api/projects");
            setProjects(list);
            setActiveProjectId((current) => current && list.some((p) => p.id === current) ? current : (list[0]?.id ?? null));
        } catch (err: any) {
            setError(err.message ?? "加载项目失败");
        } finally {
            setLoading(false);
        }
    }, []);

    const loadRequirements = useCallback(async () => {
        if (!activeProjectId) { setRequirements([]); return; }
        try {
            const list = await fetchApi<Requirement[]>(`/api/projects/${activeProjectId}/requirements`);
            setRequirements(list);
        } catch (err: any) {
            setError(err.message ?? "加载需求失败");
        }
    }, [activeProjectId]);

    useEffect(() => { loadProjects(); }, [loadProjects]);

    useEffect(() => {
        loadRequirements();
        const timer = setInterval(loadRequirements, BOARD_POLL_MS);
        return () => clearInterval(timer);
    }, [loadRequirements]);

    // Sheet 打开时展示的需求要跟着看板轮询到的最新状态走
    useEffect(() => {
        if (!sheetRequirement) return;
        const updated = requirements.find((r) => r.id === sheetRequirement.id);
        if (updated && updated.status !== sheetRequirement.status) setSheetRequirement(updated);
    }, [requirements, sheetRequirement]);

    const handleSync = async () => {
        if (!activeProjectId) return;
        setSyncing(true);
        setError(null);
        try {
            await fetchApi(`/api/projects/${activeProjectId}/sync`, { method: "POST" });
            await loadRequirements();
        } catch (err: any) {
            setError(err.message ?? "同步失败");
        } finally {
            setSyncing(false);
        }
    };

    // PROTOTYPE（ticket #82）：有 ?variant 时叠加原型面板，宿主页其余行为不变
    const prototypeOverlay = prototypeVariant ? (
        <TwoPhasePrototype variant={prototypeVariant}
            onVariantChange={changePrototypeVariant}
            onClose={() => changePrototypeVariant(null)} />
    ) : null;

    if (loading) {
        return <div className="flex h-[calc(100vh-3rem)] items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" />{prototypeOverlay}</div>;
    }

    if (!activeProject) {
        return (
            <div className="flex h-[calc(100vh-3rem)] flex-col items-center justify-center gap-3 text-muted-foreground">
                <p>还没有项目，创建一个开始使用研发流程管理。</p>
                <Button onClick={() => setNewProjectOpen(true)}><Plus className="mr-1 size-4" />新建项目</Button>
                <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} onCreated={(p) => { setProjects((ps) => [p, ...ps]); setActiveProjectId(p.id); }} />
                {prototypeOverlay}
            </div>
        );
    }

    return (
        <div className="flex h-[calc(100vh-3rem)] flex-col">
            <div className="flex items-center gap-3 border-b p-3">
                <Select value={activeProject.id} onValueChange={setActiveProjectId}>
                    <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                <span className="truncate text-xs text-muted-foreground">
                    {activeProject.dir} · {activeProject.syncSource}
                    {activeProject.lastSyncedAt && ` · 上次同步 ${new Date(activeProject.lastSyncedAt).toLocaleString()}`}
                </span>
                <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setNewProjectOpen(true)}>
                        <Plus className="mr-1 size-4" />新建项目
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setNewRequirementOpen(true)}>
                        + 手动创建需求
                    </Button>
                    <Button size="sm" disabled={syncing} onClick={handleSync}>
                        {syncing ? <Loader2 className="mr-1 size-4 animate-spin" /> : <RefreshCw className="mr-1 size-4" />}
                        同步需求
                    </Button>
                </div>
            </div>

            {error && <div className="border-b bg-destructive/10 px-3 py-1.5 text-sm text-destructive">{error}</div>}

            <div className="flex flex-1 gap-3 overflow-x-auto p-3">
                {STATUS_COLUMNS.map((status) => {
                    const items = requirements.filter((r) => r.status === status);
                    return (
                        <div key={status} className="flex w-60 shrink-0 flex-col rounded-lg bg-muted/40">
                            <div className="flex items-center gap-2 p-2 text-sm font-medium">
                                <StatusBadge status={status} />
                                <span className="text-muted-foreground">{items.length}</span>
                            </div>
                            <ScrollArea className="flex-1 px-2 pb-2">
                                {items.map((r) => (
                                    <Card key={r.id} className="mb-2 cursor-pointer py-3 hover:border-primary" onClick={() => setSheetRequirement(r)}>
                                        <CardContent className="px-3">
                                            <div className="font-mono text-xs text-muted-foreground">{r.reqKey}</div>
                                            <div className="mt-1 text-sm leading-snug">{r.title}</div>
                                            {r.labels.length > 0 && (
                                                <div className="mt-2 flex flex-wrap items-center gap-1">
                                                    {r.labels.map((l) => <Badge key={l} variant="secondary" className="text-[10px]">{l}</Badge>)}
                                                </div>
                                            )}
                                            {r.status === "waiting_input" && (
                                                <div className="mt-2 rounded bg-amber-100 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                                    ❓ 有问题等你回答
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                ))}
                            </ScrollArea>
                        </div>
                    );
                })}
            </div>

            <RequirementDetailSheet
                requirement={sheetRequirement}
                onOpenChange={(open) => !open && setSheetRequirement(null)}
                onChanged={loadRequirements}
            />
            <NewProjectDialog
                open={newProjectOpen}
                onOpenChange={setNewProjectOpen}
                onCreated={(p) => { setProjects((ps) => [p, ...ps]); setActiveProjectId(p.id); }}
            />
            {activeProjectId && (
                <NewRequirementDialog
                    open={newRequirementOpen}
                    onOpenChange={setNewRequirementOpen}
                    projectId={activeProjectId}
                    onCreated={loadRequirements}
                />
            )}
            {prototypeOverlay}
        </div>
    );
}
