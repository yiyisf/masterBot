"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Bot,
    Play,
    Pause,
    Square,
    RotateCcw,
    RefreshCw,
    ChevronDown,
    ChevronRight,
    CheckCircle2,
    XCircle,
    Clock,
    Loader2,
    AlertTriangle,
    Zap,
    Shield,
    Cpu,
    ListTree,
    Star,
    Timer,
    Layers,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentSpec {
    id: string;
    name: string;
    version: string;
    description: string;
    tools: { allow: string[]; deny: string[] };
    resources: { maxIterations: number; timeoutMs: number; concurrency: number };
    hasOutcome: boolean;
}

interface AgentInstance {
    instanceId: string;
    specId: string;
    specName: string;
    state: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
    revision: number;
    startedAt: string;
    completedAt?: string;
    stepCount: number;
    lastScore?: number;
    error?: string;
}

interface ExecutionStep {
    type: string;
    content: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolOutput?: unknown;
    duration?: number;
    timestamp: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stateBadge(state: AgentInstance["state"]) {
    const map: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
        queued:    { label: "排队中", className: "bg-gray-100 text-gray-600",   icon: <Clock className="h-3 w-3" /> },
        running:   { label: "运行中", className: "bg-blue-100 text-blue-700",   icon: <Loader2 className="h-3 w-3 animate-spin" /> },
        paused:    { label: "已暂停", className: "bg-yellow-100 text-yellow-700", icon: <Pause className="h-3 w-3" /> },
        completed: { label: "已完成", className: "bg-green-100 text-green-700", icon: <CheckCircle2 className="h-3 w-3" /> },
        failed:    { label: "失败",   className: "bg-red-100 text-red-700",     icon: <XCircle className="h-3 w-3" /> },
        cancelled: { label: "已取消", className: "bg-gray-100 text-gray-500",   icon: <Square className="h-3 w-3" /> },
    };
    const v = map[state] ?? { label: state, className: "bg-gray-100 text-gray-600", icon: null };
    return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${v.className}`}>
            {v.icon}{v.label}
        </span>
    );
}

function stepTypeIcon(type: string) {
    const icons: Record<string, React.ReactNode> = {
        content:    <span className="text-slate-500">💬</span>,
        thought:    <span className="text-purple-500">💭</span>,
        plan:       <span className="text-blue-500">📋</span>,
        action:     <span className="text-orange-500">⚡</span>,
        observation:<span className="text-teal-500">👁</span>,
        answer:     <span className="text-green-600">✅</span>,
        grading:    <span className="text-indigo-500">📊</span>,
        grade_result:<span className="text-indigo-600">🏅</span>,
        meta:       <span className="text-gray-400">ℹ️</span>,
    };
    return icons[type] ?? <span className="text-gray-400">•</span>;
}

function stepTypeBadge(type: string) {
    const colors: Record<string, string> = {
        content:     "bg-slate-50 text-slate-600 border-slate-200",
        thought:     "bg-purple-50 text-purple-700 border-purple-200",
        plan:        "bg-blue-50 text-blue-700 border-blue-200",
        action:      "bg-orange-50 text-orange-700 border-orange-200",
        observation: "bg-teal-50 text-teal-700 border-teal-200",
        answer:      "bg-green-50 text-green-700 border-green-200",
        grading:     "bg-indigo-50 text-indigo-700 border-indigo-200",
        grade_result:"bg-indigo-100 text-indigo-800 border-indigo-300",
        meta:        "bg-gray-50 text-gray-500 border-gray-200",
    };
    return (
        <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${colors[type] ?? "bg-gray-50 text-gray-500 border-gray-200"}`}>
            {stepTypeIcon(type)} {type}
        </span>
    );
}

function fmtDuration(ms?: number) {
    if (!ms) return "";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function fmtElapsed(startedAt: string, completedAt?: string) {
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    const s = Math.floor((end - start) / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${s % 60}s`;
}

function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false });
}

function shortId(id: string) {
    return id.slice(0, 8) + "…";
}

// ─── SpecCard ─────────────────────────────────────────────────────────────────

function SpecCard({ spec, onSpawn }: { spec: AgentSpec; onSpawn: (spec: AgentSpec) => void }) {
    return (
        <Card className="flex flex-col gap-0 py-0 overflow-hidden hover:shadow-md transition-shadow">
            <CardHeader className="pt-4 pb-3 border-b bg-muted/30">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                            <Bot className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                            <CardTitle className="text-sm truncate">{spec.name}</CardTitle>
                            <span className="text-[10px] text-muted-foreground font-mono">v{spec.version}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        {spec.hasOutcome && (
                            <span title="已配置 Outcome 评分" className="inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700">
                                <Star className="h-2.5 w-2.5" /> Grader
                            </span>
                        )}
                    </div>
                </div>
                <CardDescription className="text-xs mt-1.5 line-clamp-2">{spec.description}</CardDescription>
            </CardHeader>

            <CardContent className="pt-3 pb-4 flex flex-col gap-3 flex-1">
                {/* 工具权限 */}
                <div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                        <Shield className="h-3 w-3" /> 工具权限
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {spec.tools.allow.length === 0 ? (
                            <span className="text-[10px] text-muted-foreground">全部开放</span>
                        ) : (
                            spec.tools.allow.map(t => (
                                <span key={t} className="rounded bg-green-50 border border-green-200 px-1.5 py-0.5 text-[10px] text-green-700 font-mono">{t}</span>
                            ))
                        )}
                        {spec.tools.deny.map(t => (
                            <span key={t} className="rounded bg-red-50 border border-red-200 px-1.5 py-0.5 text-[10px] text-red-600 font-mono line-through">{t}</span>
                        ))}
                    </div>
                </div>

                {/* 资源限制 */}
                <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col items-center rounded-md bg-muted/50 py-1.5 px-2">
                        <Layers className="h-3 w-3 text-muted-foreground mb-0.5" />
                        <span className="text-sm font-semibold">{spec.resources.maxIterations}</span>
                        <span className="text-[9px] text-muted-foreground">迭代上限</span>
                    </div>
                    <div className="flex flex-col items-center rounded-md bg-muted/50 py-1.5 px-2">
                        <Timer className="h-3 w-3 text-muted-foreground mb-0.5" />
                        <span className="text-sm font-semibold">{spec.resources.timeoutMs / 1000}s</span>
                        <span className="text-[9px] text-muted-foreground">超时</span>
                    </div>
                    <div className="flex flex-col items-center rounded-md bg-muted/50 py-1.5 px-2">
                        <Cpu className="h-3 w-3 text-muted-foreground mb-0.5" />
                        <span className="text-sm font-semibold">{spec.resources.concurrency}</span>
                        <span className="text-[9px] text-muted-foreground">并发数</span>
                    </div>
                </div>

                <Button size="sm" className="mt-auto w-full" onClick={() => onSpawn(spec)}>
                    <Play className="h-3.5 w-3.5 mr-1" /> 启动任务
                </Button>
            </CardContent>
        </Card>
    );
}

// ─── StepsPanel ───────────────────────────────────────────────────────────────

function StepsPanel({ instanceId }: { instanceId: string }) {
    const [steps, setSteps] = useState<ExecutionStep[]>([]);
    const [loading, setLoading] = useState(true);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/agents/instances/${instanceId}/steps`);
                const data = await res.json() as { steps: ExecutionStep[] };
                setSteps(data.steps ?? []);
            } catch { /* ignore */ }
            finally { setLoading(false); }
        };
        load();
        const timer = setInterval(load, 2000);
        return () => clearInterval(timer);
    }, [instanceId]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [steps.length]);

    if (loading) return (
        <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> 加载步骤…
        </div>
    );
    if (steps.length === 0) return (
        <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">暂无步骤记录</div>
    );

    return (
        <ScrollArea className="h-72">
            <div className="flex flex-col gap-2 pr-2">
                {steps.map((step, i) => (
                    <div key={i} className="flex gap-2 text-xs">
                        <div className="flex flex-col items-center">
                            <div className="h-5 w-5 flex items-center justify-center rounded-full bg-muted text-[10px] font-mono shrink-0">
                                {i + 1}
                            </div>
                            {i < steps.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                        </div>
                        <div className="flex-1 pb-2 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                {stepTypeBadge(step.type)}
                                {step.toolName && (
                                    <span className="font-mono text-[10px] text-orange-600 bg-orange-50 px-1 rounded">{step.toolName}</span>
                                )}
                                {step.duration && (
                                    <span className="text-[10px] text-muted-foreground ml-auto">{fmtDuration(step.duration)}</span>
                                )}
                                <span className="text-[10px] text-muted-foreground">{fmtTime(step.timestamp)}</span>
                            </div>
                            <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap break-words line-clamp-4">
                                {step.content}
                            </p>
                            {step.toolOutput !== undefined && (
                                <details className="mt-1">
                                    <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">查看工具输出</summary>
                                    <pre className="mt-1 rounded bg-muted p-2 text-[10px] overflow-x-auto whitespace-pre-wrap max-h-24">
                                        {typeof step.toolOutput === "string"
                                            ? step.toolOutput
                                            : JSON.stringify(step.toolOutput, null, 2)}
                                    </pre>
                                </details>
                            )}
                        </div>
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>
        </ScrollArea>
    );
}

// ─── InstanceRow ──────────────────────────────────────────────────────────────

function InstanceRow({
    inst,
    onAction,
}: {
    inst: AgentInstance;
    onAction: (id: string, action: "pause" | "resume" | "cancel") => Promise<void>;
}) {
    const [expanded, setExpanded] = useState(false);
    const [acting, setActing] = useState<string | null>(null);

    const act = async (action: "pause" | "resume" | "cancel") => {
        setActing(action);
        await onAction(inst.instanceId, action);
        setActing(null);
    };

    const isActive = inst.state === "running" || inst.state === "queued";

    return (
        <div className="rounded-lg border bg-card overflow-hidden">
            <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
                onClick={() => setExpanded(v => !v)}
            >
                {/* expand icon */}
                <div className="shrink-0 text-muted-foreground">
                    {expanded
                        ? <ChevronDown className="h-4 w-4" />
                        : <ChevronRight className="h-4 w-4" />}
                </div>

                {/* spec name */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{inst.specName}</span>
                        {stateBadge(inst.state)}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                        <span className="font-mono">{shortId(inst.instanceId)}</span>
                        <span className="flex items-center gap-0.5">
                            <ListTree className="h-3 w-3" /> {inst.stepCount} 步
                        </span>
                        {inst.lastScore !== undefined && (
                            <span className="flex items-center gap-0.5">
                                <Star className="h-3 w-3" /> {inst.lastScore}分
                            </span>
                        )}
                        <span className="flex items-center gap-0.5">
                            <Clock className="h-3 w-3" />
                            {fmtElapsed(inst.startedAt, inst.completedAt)}
                        </span>
                    </div>
                </div>

                {/* actions */}
                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    {inst.state === "running" && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="暂停"
                            onClick={() => act("pause")} disabled={!!acting}>
                            {acting === "pause" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
                        </Button>
                    )}
                    {inst.state === "paused" && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="继续"
                            onClick={() => act("resume")} disabled={!!acting}>
                            {acting === "resume" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        </Button>
                    )}
                    {isActive && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" title="取消"
                            onClick={() => act("cancel")} disabled={!!acting}>
                            {acting === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                        </Button>
                    )}
                </div>
            </div>

            {/* error */}
            {inst.error && !expanded && (
                <div className="px-4 pb-2 text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> {inst.error}
                </div>
            )}

            {/* steps panel */}
            {expanded && (
                <div className="border-t px-4 py-3 bg-muted/20">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground">执行步骤</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{inst.instanceId}</span>
                    </div>
                    <StepsPanel instanceId={inst.instanceId} />
                </div>
            )}
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AgentsPage() {
    const [specs, setSpecs] = useState<AgentSpec[]>([]);
    const [instances, setInstances] = useState<AgentInstance[]>([]);
    const [loadingSpecs, setLoadingSpecs] = useState(true);
    const [loadingInst, setLoadingInst] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);

    // Spawn dialog
    const [spawnSpec, setSpawnSpec] = useState<AgentSpec | null>(null);
    const [spawnTask, setSpawnTask] = useState("");
    const [spawnSessionId, setSpawnSessionId] = useState("");
    const [spawning, setSpawning] = useState(false);
    const [spawnResult, setSpawnResult] = useState<{ instanceId: string; specId: string } | null>(null);
    const [spawnError, setSpawnError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("specs");

    const loadSpecs = useCallback(async () => {
        try {
            const data = await fetch(`${API_BASE}/api/agents/specs`).then(r => r.json()) as AgentSpec[];
            setSpecs(data ?? []);
        } catch { /* ignore */ }
        finally { setLoadingSpecs(false); }
    }, []);

    const loadInstances = useCallback(async () => {
        try {
            const data = await fetch(`${API_BASE}/api/agents/instances`).then(r => r.json()) as AgentInstance[];
            setInstances(data ?? []);
        } catch { /* ignore */ }
        finally { setLoadingInst(false); }
    }, []);

    useEffect(() => {
        loadSpecs();
        loadInstances();
    }, [loadSpecs, loadInstances]);

    // auto-refresh instances
    useEffect(() => {
        if (!autoRefresh) return;
        const timer = setInterval(loadInstances, 3000);
        return () => clearInterval(timer);
    }, [autoRefresh, loadInstances]);

    const handleAction = async (instanceId: string, action: "pause" | "resume" | "cancel") => {
        await fetch(`${API_BASE}/api/agents/instances/${instanceId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
        });
        await loadInstances();
    };

    const handleSpawn = async () => {
        if (!spawnSpec || !spawnTask.trim()) return;
        setSpawning(true);
        setSpawnResult(null);
        setSpawnError(null);
        try {
            const res = await fetch(`${API_BASE}/api/agents/spawn`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    specId: spawnSpec.id,
                    task: spawnTask.trim(),
                    sessionId: spawnSessionId.trim() || undefined,
                }),
            });
            const data = await res.json() as { instanceId: string; specId: string; error?: string };
            if (!res.ok) {
                setSpawnError(data.error ?? `启动失败 (${res.status})`);
                return;
            }
            setSpawnResult(data);
            await loadInstances();
        } catch (e) {
            setSpawnError("网络错误，请检查后端连接");
            console.error(e);
        } finally {
            setSpawning(false);
        }
    };

    const openSpawnDialog = (spec: AgentSpec) => {
        setSpawnSpec(spec);
        setSpawnTask("");
        setSpawnSessionId("");
        setSpawnResult(null);
        setSpawnError(null);
    };

    const closeSpawnDialog = () => {
        setSpawnSpec(null);
        if (spawnResult) {
            setActiveTab("instances");
        }
    };

    // stats
    const running = instances.filter(i => i.state === "running").length;
    const completed = instances.filter(i => i.state === "completed").length;
    const failed = instances.filter(i => i.state === "failed").length;

    return (
        <div className="flex flex-col gap-6 p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Bot className="h-6 w-6 text-primary" />
                        托管 Agent 管理台
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        管理 AgentSpec 规格、启动任务实例、实时监控执行状态
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { loadSpecs(); loadInstances(); }}
                    >
                        <RefreshCw className="h-3.5 w-3.5 mr-1" /> 刷新
                    </Button>
                </div>
            </div>

            {/* Stats bar */}
            <div className="grid grid-cols-4 gap-4">
                {[
                    { label: "已注册规格", value: specs.length, icon: <Layers className="h-4 w-4 text-primary" />, cls: "text-primary" },
                    { label: "运行中", value: running, icon: <Zap className="h-4 w-4 text-blue-500" />, cls: "text-blue-600" },
                    { label: "已完成", value: completed, icon: <CheckCircle2 className="h-4 w-4 text-green-500" />, cls: "text-green-600" },
                    { label: "失败", value: failed, icon: <XCircle className="h-4 w-4 text-red-400" />, cls: "text-red-500" },
                ].map(s => (
                    <Card key={s.label} className="py-3">
                        <CardContent className="flex items-center gap-3 p-0 px-4">
                            {s.icon}
                            <div>
                                <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
                                <p className="text-[11px] text-muted-foreground">{s.label}</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="specs">Agent 规格 ({specs.length})</TabsTrigger>
                    <TabsTrigger value="instances">
                        运行实例 ({instances.length})
                        {running > 0 && (
                            <span className="ml-1.5 rounded-full bg-blue-500 text-white text-[10px] px-1.5 py-0.5 font-medium">
                                {running}
                            </span>
                        )}
                    </TabsTrigger>
                </TabsList>

                {/* ── Specs Tab ── */}
                <TabsContent value="specs" className="mt-4">
                    {loadingSpecs ? (
                        <div className="flex items-center justify-center h-40 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" /> 加载中…
                        </div>
                    ) : specs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                            <Bot className="h-8 w-8 opacity-30" />
                            <p className="text-sm">暂无注册的 AgentSpec</p>
                            <p className="text-xs">在 <code className="bg-muted px-1 rounded">agents/</code> 目录下添加 SOUL.md 文件后重启服务</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {specs.map(spec => (
                                <SpecCard key={spec.id} spec={spec} onSpawn={openSpawnDialog} />
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* ── Instances Tab ── */}
                <TabsContent value="instances" className="mt-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setAutoRefresh(v => !v)}
                                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                                    autoRefresh
                                        ? "border-blue-300 bg-blue-50 text-blue-700"
                                        : "border-border text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                <RotateCcw className={`h-3 w-3 ${autoRefresh ? "animate-spin" : ""}`} />
                                {autoRefresh ? "自动刷新中" : "自动刷新已停止"}
                            </button>
                        </div>
                        <span className="text-xs text-muted-foreground">共 {instances.length} 个实例</span>
                    </div>

                    {loadingInst ? (
                        <div className="flex items-center justify-center h-40 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin mr-2" /> 加载中…
                        </div>
                    ) : instances.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                            <Bot className="h-8 w-8 opacity-30" />
                            <p className="text-sm">暂无运行实例</p>
                            <p className="text-xs">在"Agent 规格"标签页中点击"启动任务"</p>
                        </div>
                    ) : (
                        <ScrollArea className="h-[calc(100vh-280px)] min-h-[300px]">
                            <div className="flex flex-col gap-2 pr-2">
                                {/* active first, then completed/failed */}
                                {[...instances]
                                    .sort((a, b) => {
                                        const order = { running: 0, paused: 1, queued: 2, completed: 3, failed: 4, cancelled: 5 };
                                        return (order[a.state] ?? 9) - (order[b.state] ?? 9);
                                    })
                                    .map(inst => (
                                        <InstanceRow key={inst.instanceId} inst={inst} onAction={handleAction} />
                                    ))}
                            </div>
                        </ScrollArea>
                    )}
                </TabsContent>
            </Tabs>

            {/* ── Spawn Dialog ── */}
            <Dialog open={!!spawnSpec} onOpenChange={open => { if (!open) closeSpawnDialog(); }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Play className="h-4 w-4 text-primary" />
                            启动任务 — {spawnSpec?.name}
                        </DialogTitle>
                        <DialogDescription>
                            {spawnSpec?.description}
                        </DialogDescription>
                    </DialogHeader>

                    {spawnResult ? (
                        <div className="flex flex-col items-center gap-3 py-4">
                            <CheckCircle2 className="h-10 w-10 text-green-500" />
                            <p className="text-sm font-medium">实例已创建</p>
                            <div className="rounded-md bg-muted px-4 py-2 text-xs font-mono text-center break-all">
                                {spawnResult.instanceId}
                            </div>
                            <p className="text-xs text-muted-foreground">切换到「运行实例」标签页查看执行进度</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            <div className="grid gap-1.5">
                                <Label htmlFor="spawn-task">任务描述 <span className="text-destructive">*</span></Label>
                                <Textarea
                                    id="spawn-task"
                                    placeholder={`请输入 ${spawnSpec?.name} 要执行的任务…`}
                                    rows={4}
                                    value={spawnTask}
                                    onChange={e => setSpawnTask(e.target.value)}
                                    className="resize-none font-mono text-sm"
                                />
                            </div>
                            <div className="grid gap-1.5">
                                <Label htmlFor="spawn-session">会话 ID（可选）</Label>
                                <Input
                                    id="spawn-session"
                                    placeholder="留空自动生成"
                                    value={spawnSessionId}
                                    onChange={e => setSpawnSessionId(e.target.value)}
                                    className="font-mono text-sm"
                                />
                            </div>

                            {/* spec 信息摘要 */}
                            {spawnSpec && (
                                <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground grid grid-cols-3 gap-2">
                                    <span>迭代上限: <strong className="text-foreground">{spawnSpec.resources.maxIterations}</strong></span>
                                    <span>超时: <strong className="text-foreground">{spawnSpec.resources.timeoutMs / 1000}s</strong></span>
                                    <span>Grader: <strong className="text-foreground">{spawnSpec.hasOutcome ? "已配置" : "未配置"}</strong></span>
                                </div>
                            )}
                        </div>
                    )}

                    {spawnError && (
                        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            {spawnError}
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={closeSpawnDialog}>
                            {spawnResult ? "关闭" : "取消"}
                        </Button>
                        {!spawnResult && (
                            <Button onClick={handleSpawn} disabled={!spawnTask.trim() || spawning}>
                                {spawning
                                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> 启动中…</>
                                    : <><Play className="h-3.5 w-3.5 mr-1" /> 启动</>}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
