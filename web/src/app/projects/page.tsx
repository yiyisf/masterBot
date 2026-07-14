"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

// ─────────────────────────── 领域模型（对齐后端 repository） ───────────────────────────

type RequirementStatus =
    | "synced" | "queued" | "in_progress" | "waiting_input" | "analyzed"
    | "implemented" | "merged" | "failed" | "cancelled";

type RequirementPhase = "analysis" | "implementation" | null;

type ExecutionEngineKind = "claude-code" | "codex" | "opencode" | "pi";

interface AnalysisSpec {
    goal?: string;
    scope?: string;
    acceptance?: string;
}

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
    phase: RequirementPhase;
    analysisSpec: AnalysisSpec | null;
    parentId: string | null;
    cardNo: number | null;
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

interface PendingQuestion {
    id: string;
    question: string;
    context?: string;
    options?: Array<{ label: string; description?: string }>;
    recommended?: number;
}

interface PendingQuestionSet {
    id: string;
    requirementId: string;
    questions: PendingQuestion[];
    status: "pending" | "answered" | "cancelled";
    answers: string[] | null;
}

// ─────────────────────────── 看板列（分析中/实现中按 phase 从 in_progress 里拆出虚拟列）───────────────────────────

type ColumnKey = RequirementStatus | "analyzing" | "implementing";

const COLUMN_ORDER: ColumnKey[] = [
    "synced", "queued", "analyzing", "waiting_input", "analyzed",
    "implementing", "implemented", "merged", "failed", "cancelled",
];

const COLUMN_META: Record<ColumnKey, { label: string; cls: string }> = {
    synced: { label: "已同步", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
    queued: { label: "已排队", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
    analyzing: { label: "分析中", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
    waiting_input: { label: "等待回答", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
    analyzed: { label: "待核验分析", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
    in_progress: { label: "实施中", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
    implementing: { label: "实现中", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
    implemented: { label: "待核验合并", cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
    merged: { label: "已完成", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
    failed: { label: "失败", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
    cancelled: { label: "已取消", cls: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
};

function columnKeyFor(r: Requirement): ColumnKey {
    if (r.status === "in_progress") return r.phase === "analysis" ? "analyzing" : "implementing";
    return r.status;
}

function StatusBadge({ status, phase }: { status: RequirementStatus; phase?: RequirementPhase }) {
    const key: ColumnKey = status === "in_progress" ? (phase === "analysis" ? "analyzing" : "implementing") : status;
    const meta = COLUMN_META[key];
    return <Badge variant="outline" className={`border-transparent ${meta.cls}`}>{meta.label}</Badge>;
}

const CARD_STATUS_META: Record<string, { label: string; cls: string }> = {
    queued: { label: "排队中", cls: "bg-muted text-muted-foreground" },
    in_progress: { label: "执行中", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
    waiting_input: { label: "等待回答", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
    implemented: { label: "已完成", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
    failed: { label: "失败", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
    cancelled: { label: "已跳过", cls: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
};

const AGENTS: ExecutionEngineKind[] = ["claude-code", "codex", "opencode", "pi"];
const ANALYSIS_STARTABLE: RequirementStatus[] = ["synced", "queued", "failed"];
const LEGACY_STARTABLE: RequirementStatus[] = ["synced", "queued"];
const BOARD_POLL_MS = 3000;
const SHEET_POLL_MS = 3000;

const STEP_ICON: Record<string, string> = {
    meta: "ⓘ", thought: "💭", action: "⚙", observation: "👁",
    content: "💬", answer: "✅", interrupt: "❓",
};

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

// ─────────────────────────── 变体 C：右栏「当前动作」区的问答表单（逐题作答） ───────────────────────────

function QuestionForm({ questionSet, onSubmit }: { questionSet: PendingQuestionSet; onSubmit: (answers: string[]) => Promise<void> }) {
    const [index, setIndex] = useState(0);
    const [answers, setAnswers] = useState<string[]>(() => questionSet.questions.map(() => ""));
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setIndex(0);
        setAnswers(questionSet.questions.map(() => ""));
    }, [questionSet.id]);

    const question = questionSet.questions[index];
    const isLast = index === questionSet.questions.length - 1;
    const setAnswer = (v: string) => setAnswers((a) => a.map((x, i) => (i === index ? v : x)));

    const submit = async () => {
        setSubmitting(true);
        setError(null);
        try {
            await onSubmit(answers);
        } catch (err: any) {
            setError(err.message ?? "提交失败");
        } finally {
            setSubmitting(false);
        }
    };

    if (!question) return null;

    return (
        <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>❓ Agent 需要你的回答</span>
                {questionSet.questions.length > 1 && <span>{index + 1} / {questionSet.questions.length}</span>}
            </div>
            <div className="text-sm font-medium">{question.question}</div>
            {question.context && <div className="mt-1 text-xs text-muted-foreground">{question.context}</div>}

            {question.options && question.options.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                    {question.options.map((o, oi) => (
                        <label
                            key={oi}
                            className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm ${answers[index] === o.label ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}
                        >
                            <input
                                type="radio"
                                name={`q-${question.id}`}
                                className="mt-1 accent-[var(--primary)]"
                                checked={answers[index] === o.label}
                                onChange={() => setAnswer(o.label)}
                            />
                            <span>
                                <span className="font-medium">{o.label}</span>
                                {question.recommended === oi && (
                                    <Badge variant="outline" className="ml-2 border-primary px-1 py-0 text-[10px] text-primary">推荐</Badge>
                                )}
                                {o.description && <div className="text-xs text-muted-foreground">{o.description}</div>}
                            </span>
                        </label>
                    ))}
                </div>
            ) : (
                <Textarea
                    value={answers[index]}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="输入你的回答…"
                    className="mt-2"
                    rows={2}
                    disabled={submitting}
                />
            )}

            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

            <div className="mt-3 flex gap-2">
                {!isLast ? (
                    <Button size="sm" disabled={!answers[index]?.trim()} onClick={() => setIndex((i) => i + 1)}>
                        下一题
                    </Button>
                ) : (
                    <Button size="sm" disabled={!answers[index]?.trim() || submitting} onClick={submit}>
                        {submitting ? <Loader2 className="size-4 animate-spin" /> : "提交回答，继续执行"}
                    </Button>
                )}
                {index > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setIndex((i) => i - 1)}>上一题</Button>
                )}
            </div>
        </div>
    );
}

// ─────────────────────────── 变体 C：左栏规格 + 卡片列表 ───────────────────────────

function SpecPanel({ requirement, editable, onSaved }: { requirement: Requirement; editable: boolean; onSaved: () => void }) {
    const spec = requirement.analysisSpec;
    const [draft, setDraft] = useState<AnalysisSpec>(spec ?? {});
    const [saving, setSaving] = useState(false);
    useEffect(() => setDraft(spec ?? {}), [spec]);

    if (!spec && !editable) {
        return <p className="text-sm text-muted-foreground">分析进行中，规格将在完成后展示……</p>;
    }

    const save = async () => {
        setSaving(true);
        try {
            await fetchApi(`/api/requirements/${requirement.id}/analysis-spec`, { method: "PATCH", body: JSON.stringify(draft) });
            onSaved();
        } finally {
            setSaving(false);
        }
    };

    const field = (key: keyof AnalysisSpec, label: string) => (
        <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
            {editable ? (
                <Textarea
                    value={draft[key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                    onBlur={save}
                    rows={2}
                    className="text-sm"
                />
            ) : (
                <p className="text-sm text-muted-foreground">{spec?.[key] || "—"}</p>
            )}
        </div>
    );

    return (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            {field("goal", "目标")}
            {field("scope", "范围")}
            {field("acceptance", "验收")}
            {saving && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        </div>
    );
}

function CardEditor({ requirement, cards, onChanged }: { requirement: Requirement; cards: Requirement[]; onChanged: () => void }) {
    const [newTitle, setNewTitle] = useState("");
    const [busy, setBusy] = useState(false);

    const addCard = async () => {
        if (!newTitle.trim()) return;
        setBusy(true);
        try {
            await fetchApi(`/api/requirements/${requirement.id}/cards`, { method: "POST", body: JSON.stringify({ title: newTitle.trim() }) });
            setNewTitle("");
            onChanged();
        } finally {
            setBusy(false);
        }
    };

    const rename = async (cardId: string, title: string) => {
        await fetchApi(`/api/requirements/${requirement.id}/cards/${cardId}`, { method: "PATCH", body: JSON.stringify({ title }) });
        onChanged();
    };

    const remove = async (cardId: string) => {
        setBusy(true);
        try {
            await fetchApi(`/api/requirements/${requirement.id}/cards/${cardId}`, { method: "DELETE" });
            onChanged();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-1.5">
            {cards.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <span className="w-5 text-xs tabular-nums text-muted-foreground">{c.cardNo}</span>
                    <input
                        defaultValue={c.title}
                        onBlur={(e) => { if (e.target.value.trim() && e.target.value !== c.title) rename(c.id, e.target.value.trim()); }}
                        className="flex-1 rounded bg-transparent px-1 outline-none hover:bg-muted/60"
                    />
                    <button
                        className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                        aria-label="删除卡"
                        disabled={busy}
                        onClick={() => remove(c.id)}
                    >
                        ✕
                    </button>
                </div>
            ))}
            <div className="flex gap-2">
                <Input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="添加一张卡片"
                    className="h-8 text-sm"
                    onKeyDown={(e) => { if (e.key === "Enter") addCard(); }}
                />
                <Button size="sm" variant="outline" disabled={!newTitle.trim() || busy} onClick={addCard}>＋</Button>
            </div>
        </div>
    );
}

function CardProgress({ requirement, cards, onChanged, onOpenCard }: {
    requirement: Requirement;
    cards: Requirement[];
    onChanged: () => void;
    onOpenCard: (card: Requirement) => void;
}) {
    const [busyCardId, setBusyCardId] = useState<string | null>(null);

    const retryCard = async () => {
        setBusyCardId(requirement.id);
        try {
            await fetchApi(`/api/requirements/${requirement.id}/implementation`, { method: "POST" });
            onChanged();
        } finally {
            setBusyCardId(null);
        }
    };

    const skipCard = async (cardId: string) => {
        setBusyCardId(cardId);
        try {
            await fetchApi(`/api/requirements/${requirement.id}/cards/${cardId}/skip`, { method: "POST" });
            await fetchApi(`/api/requirements/${requirement.id}/implementation`, { method: "POST" });
            onChanged();
        } finally {
            setBusyCardId(null);
        }
    };

    return (
        <div className="divide-y rounded-lg border">
            {cards.map((c) => {
                const meta = CARD_STATUS_META[c.status] ?? CARD_STATUS_META.queued;
                return (
                    <div key={c.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                        <span className="w-5 text-xs tabular-nums text-muted-foreground">{c.cardNo}</span>
                        <button
                            className={`flex-1 truncate text-left ${c.status === "queued" ? "text-muted-foreground" : ""} hover:underline`}
                            onClick={() => onOpenCard(c)}
                        >
                            {c.title}
                        </button>
                        <Badge variant="outline" className={`border-transparent text-[11px] ${meta.cls}`}>{meta.label}</Badge>
                        <div className="flex gap-1">
                            {c.status === "failed" && (
                                <Button size="sm" className="h-6 px-2 text-xs" disabled={busyCardId === requirement.id} onClick={retryCard}>
                                    从此卡重试
                                </Button>
                            )}
                            {(c.status === "failed" || c.status === "queued") && (
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={busyCardId === c.id} onClick={() => skipCard(c.id)}>
                                    跳过
                                </Button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─────────────────────────── 现有对话框（不变） ───────────────────────────

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

// ─────────────────────────── 变体 C：双栏详情面板（选定方向，原型见 prototype/two-phase-ui-82 分支）───────────────────────────

function RequirementDetailSheet({ requirement, onOpenChange, onChanged }: {
    requirement: Requirement | null;
    onOpenChange: (open: boolean) => void;
    onChanged: () => void;
}) {
    const [agent, setAgent] = useState<ExecutionEngineKind>("claude-code");
    const [runs, setRuns] = useState<RequirementRun[]>([]);
    const [events, setEvents] = useState<SessionEvent[]>([]);
    const [cards, setCards] = useState<Requirement[]>([]);
    const [pendingQuestionSet, setPendingQuestionSet] = useState<PendingQuestionSet | null>(null);
    const [openCard, setOpenCard] = useState<Requirement | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 卡片内嵌时间线（点开卡片查看执行过程）沿用同一份 runs/events 状态，openCard 时切换目标
    const timelineTarget = openCard ?? requirement;
    const latestRun = runs[0] ?? null;

    const loadDetail = useCallback(async () => {
        if (!requirement) return;
        try {
            const [parentCards, questionSet] = await Promise.all([
                requirement.parentId ? Promise.resolve([]) : fetchApi<Requirement[]>(`/api/requirements/${requirement.id}/cards`),
                fetchApi<PendingQuestionSet | null>(`/api/requirements/${requirement.id}/pending-questions`),
            ]);
            setCards(parentCards);
            setPendingQuestionSet(questionSet?.status === "pending" ? questionSet : null);
        } catch {
            // 静默失败：不打断详情面板的其他交互
        }
    }, [requirement]);

    const loadTimeline = useCallback(async () => {
        if (!timelineTarget) return;
        try {
            const runList = await fetchApi<RequirementRun[]>(`/api/requirements/${timelineTarget.id}/runs`);
            setRuns(runList);
            const latest = runList[0];
            if (latest) {
                const { events: evts } = await fetchApi<{ events: SessionEvent[] }>(
                    `/api/requirements/${timelineTarget.id}/runs/${latest.id}/events`
                );
                setEvents(evts);
            } else {
                setEvents([]);
            }
        } catch {
            // 静默失败
        }
    }, [timelineTarget]);

    useEffect(() => {
        setRuns([]); setEvents([]); setError(null); setCards([]); setPendingQuestionSet(null); setOpenCard(null);
        if (!requirement) return;
        loadDetail();
        const timer = setInterval(loadDetail, SHEET_POLL_MS);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requirement?.id]);

    useEffect(() => {
        loadTimeline();
        const timer = setInterval(loadTimeline, SHEET_POLL_MS);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timelineTarget?.id]);

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

    const isCard = !!requirement.parentId;
    const phase = requirement.phase;

    return (
        <Sheet open={!!requirement} onOpenChange={onOpenChange}>
            <SheetContent className="w-[900px] overflow-y-auto sm:max-w-[900px]">
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                        <span className="font-mono text-sm text-muted-foreground">{requirement.reqKey}</span>
                        <StatusBadge status={requirement.status} phase={requirement.phase} />
                    </SheetTitle>
                </SheetHeader>
                <div className="px-4 pb-8">
                    <h3 className="mb-1 font-medium">{requirement.title}</h3>
                    {requirement.description && (
                        <p className="mb-3 whitespace-pre-wrap text-sm text-muted-foreground">{requirement.description}</p>
                    )}
                    <div className="mb-3 flex flex-wrap items-center gap-1">
                        {requirement.labels.map((l) => <Badge key={l} variant="secondary" className="text-[10px]">{l}</Badge>)}
                        {requirement.sourceUrl && (
                            <a href={requirement.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                                查看来源
                            </a>
                        )}
                        {requirement.sourceClosed && <span className="text-xs text-red-500">（远程已关闭）</span>}
                    </div>
                    {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

                    {!isCard ? (
                        <div className="grid grid-cols-[1fr_1.2fr] gap-4">
                            {/* 左栏：规格 + 卡片，全程可见 */}
                            <div className="space-y-3">
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">分析规格</h4>
                                <SpecPanel requirement={requirement} editable={requirement.status === "analyzed"} onSaved={loadDetail} />

                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">实现卡片</h4>
                                {cards.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        {requirement.status === "analyzed" || phase === "implementation" || requirement.status === "implemented"
                                            ? "暂无卡片"
                                            : "拆卡在分析完成后产出"}
                                    </p>
                                ) : requirement.status === "analyzed" ? (
                                    <CardEditor requirement={requirement} cards={cards} onChanged={loadDetail} />
                                ) : (
                                    <CardProgress requirement={requirement} cards={cards} onChanged={loadDetail} onOpenCard={setOpenCard} />
                                )}
                            </div>

                            {/* 右栏：当前动作 */}
                            <div className="space-y-3">
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {requirement.status === "waiting_input" ? "当前动作：回答问题"
                                        : requirement.status === "analyzed" ? "当前动作：核验"
                                            : requirement.status === "in_progress" ? (phase === "analysis" ? "分析进行中" : "实现进行中")
                                                : "执行时间线"}
                                </h4>

                                {ANALYSIS_STARTABLE.includes(requirement.status) && !phase && (
                                    <div className="space-y-2 rounded-lg border p-3">
                                        <div className="flex items-center gap-2">
                                            <Select value={agent} onValueChange={(v) => setAgent(v as ExecutionEngineKind)}>
                                                <SelectTrigger size="sm" className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {AGENTS.map((a) => (
                                                        <SelectItem key={a} value={a}>{a}{a !== "claude-code" ? "（无人值守）" : ""}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <Button size="sm" disabled={busy} onClick={() => runAction(() =>
                                                fetchApi(`/api/requirements/${requirement.id}/analysis`, { method: "POST", body: JSON.stringify({ engine: agent }) })
                                            )}>
                                                发起需求分析
                                            </Button>
                                        </div>
                                        {LEGACY_STARTABLE.includes(requirement.status) && (
                                            <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" disabled={busy} onClick={() => runAction(() =>
                                                fetchApi(`/api/requirements/${requirement.id}/start`, { method: "POST", body: JSON.stringify({ engine: agent }) })
                                            )}>
                                                或直接发起研发（跳过两阶段，旧流程）
                                            </Button>
                                        )}
                                    </div>
                                )}

                                {requirement.status === "failed" && phase === "analysis" && (
                                    <Button size="sm" disabled={busy} onClick={() => runAction(() =>
                                        fetchApi(`/api/requirements/${requirement.id}/analysis`, { method: "POST", body: JSON.stringify({ engine: agent }) })
                                    )}>
                                        重试分析
                                    </Button>
                                )}
                                {requirement.status === "failed" && phase === "implementation" && (
                                    <Button size="sm" disabled={busy} onClick={() => runAction(() =>
                                        fetchApi(`/api/requirements/${requirement.id}/implementation`, { method: "POST" })
                                    )}>
                                        从失败卡重试
                                    </Button>
                                )}
                                {requirement.status === "failed" && !phase && (
                                    <Button size="sm" disabled={busy} onClick={() => runAction(() =>
                                        fetchApi(`/api/requirements/${requirement.id}/retry`, { method: "POST" })
                                    )}>
                                        重试
                                    </Button>
                                )}

                                {requirement.status === "waiting_input" && pendingQuestionSet && (
                                    <QuestionForm
                                        questionSet={pendingQuestionSet}
                                        onSubmit={(answers) => runAction(() =>
                                            fetchApi(`/api/requirements/${requirement.id}/answers`, { method: "POST", body: JSON.stringify({ answers }) })
                                        )}
                                    />
                                )}

                                {requirement.status === "analyzed" && (
                                    <div className="space-y-2">
                                        <Button size="sm" disabled={busy || cards.length === 0} onClick={() => runAction(() =>
                                            fetchApi(`/api/requirements/${requirement.id}/implementation`, { method: "POST" })
                                        )}>
                                            核验通过，开始实现
                                        </Button>
                                        <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                                            if (!confirm("重新分析会作废尚未实现的卡片（已实现的卡片不受影响），确定继续？")) return;
                                            runAction(() => fetchApi(`/api/requirements/${requirement.id}/analysis`, {
                                                method: "POST", body: JSON.stringify({ engine: agent, reanalyze: true }),
                                            }));
                                        }}>
                                            重新分析…
                                        </Button>
                                    </div>
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
                                    <a href={latestRun.prUrl} target="_blank" rel="noreferrer" className="block text-xs text-blue-600 hover:underline dark:text-blue-400">
                                        查看 PR
                                    </a>
                                )}
                                {latestRun && (
                                    <p className="text-xs text-muted-foreground">
                                        引擎：{latestRun.engine}{latestRun.retryNo > 0 ? ` · 第 ${latestRun.retryNo + 1} 次尝试` : ""}
                                        {latestRun.errorMessage ? ` · ${latestRun.errorMessage}` : ""}
                                    </p>
                                )}

                                <Separator />
                                <div className="text-sm font-medium">
                                    {openCard ? `卡片时间线：${openCard.title}` : "执行时间线"}
                                    {openCard && (
                                        <button className="ml-2 text-xs text-muted-foreground hover:underline" onClick={() => setOpenCard(null)}>
                                            返回需求时间线
                                        </button>
                                    )}
                                </div>
                                <Timeline events={events} />
                            </div>
                        </div>
                    ) : (
                        // 卡片自身的 Sheet（从看板直接点开某张卡片时）：只展示时间线 + 跳过/重试
                        <div className="space-y-3">
                            {requirement.status === "waiting_input" && pendingQuestionSet && (
                                <QuestionForm
                                    questionSet={pendingQuestionSet}
                                    onSubmit={(answers) => runAction(() =>
                                        fetchApi(`/api/requirements/${requirement.id}/answers`, { method: "POST", body: JSON.stringify({ answers }) })
                                    )}
                                />
                            )}
                            <Separator />
                            <div className="text-sm font-medium">执行时间线</div>
                            <Timeline events={events} />
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}

export default function ProjectsPage() {
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
        if (updated && (updated.status !== sheetRequirement.status || updated.phase !== sheetRequirement.phase)) {
            setSheetRequirement(updated);
        }
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

    const columns = useMemo(() => {
        const grouped = new Map<ColumnKey, Requirement[]>();
        for (const key of COLUMN_ORDER) grouped.set(key, []);
        for (const r of requirements) {
            if (r.parentId) continue; // 卡片不单独占看板列，跟随父需求展示
            grouped.get(columnKeyFor(r))?.push(r);
        }
        return grouped;
    }, [requirements]);

    if (loading) {
        return <div className="flex h-[calc(100vh-3rem)] items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>;
    }

    if (!activeProject) {
        return (
            <div className="flex h-[calc(100vh-3rem)] flex-col items-center justify-center gap-3 text-muted-foreground">
                <p>还没有项目，创建一个开始使用研发流程管理。</p>
                <Button onClick={() => setNewProjectOpen(true)}><Plus className="mr-1 size-4" />新建项目</Button>
                <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} onCreated={(p) => { setProjects((ps) => [p, ...ps]); setActiveProjectId(p.id); }} />
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
                {COLUMN_ORDER.map((key) => {
                    const items = columns.get(key) ?? [];
                    const meta = COLUMN_META[key];
                    return (
                        <div key={key} className="flex w-60 shrink-0 flex-col rounded-lg bg-muted/40">
                            <div className="flex items-center gap-2 p-2 text-sm font-medium">
                                <Badge variant="outline" className={`border-transparent ${meta.cls}`}>{meta.label}</Badge>
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
        </div>
    );
}
