"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    RefreshCw,
    Rocket,
    ChevronUp,
    ChevronDown,
    BarChart2,
    PlusCircle,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    Clock,
} from "lucide-react";
import { adminFetch } from "@/lib/admin";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CanaryFlag {
    id: string;
    flag_name: string;
    current_stage: number;
    stages: number[];
    stage_started_at: string;
    observe_hours: number;
    error_rate_threshold: number;
    auto_rollback: boolean;
    status: "running" | "paused" | "completed" | "rolled_back";
    created_at: string;
    updated_at: string;
}

interface CanaryMetric {
    stage: number;
    error_rate: number;
    satisfaction_rate: number;
    total_tokens: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: CanaryFlag["status"]) {
    switch (status) {
        case "running":
            return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">运行中</Badge>;
        case "completed":
            return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">已完成</Badge>;
        case "rolled_back":
            return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">已回滚</Badge>;
        case "paused":
            return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">已暂停</Badge>;
    }
}

function statusIcon(status: CanaryFlag["status"]) {
    switch (status) {
        case "running":
            return <Rocket className="h-4 w-4 text-blue-500" />;
        case "completed":
            return <CheckCircle2 className="h-4 w-4 text-green-500" />;
        case "rolled_back":
            return <XCircle className="h-4 w-4 text-red-500" />;
        case "paused":
            return <Clock className="h-4 w-4 text-yellow-500" />;
    }
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function fmtPct(v: number) {
    return (v * 100).toFixed(1) + "%";
}

function fmtTokens(n: number) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return String(n);
}

// ─── MetricsPanel ─────────────────────────────────────────────────────────────

function MetricsPanel({ flagName, stages }: { flagName: string; stages: number[] }) {
    const [metrics, setMetrics] = useState<CanaryMetric[] | null>(null);
    const [open, setOpen] = useState(false);

    const load = async () => {
        const res = await adminFetch(`/api/admin/canary/${encodeURIComponent(flagName)}/metrics`);
        if (res.ok) setMetrics(await res.json());
    };

    const toggle = () => {
        if (!open && metrics === null) load();
        setOpen(!open);
    };

    return (
        <div className="mt-3">
            <button
                onClick={toggle}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
                <BarChart2 className="h-3.5 w-3.5" />
                {open ? "收起指标" : "查看指标"}
            </button>
            {open && (
                <div className="mt-2 rounded-md border bg-muted/30 p-3 space-y-1">
                    {!metrics || metrics.length === 0 ? (
                        <p className="text-xs text-muted-foreground">暂无指标数据</p>
                    ) : (
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-muted-foreground border-b">
                                    <th className="text-left py-1 font-medium">Stage</th>
                                    <th className="text-right py-1 font-medium">错误率</th>
                                    <th className="text-right py-1 font-medium">满意度</th>
                                    <th className="text-right py-1 font-medium">Tokens</th>
                                </tr>
                            </thead>
                            <tbody>
                                {metrics.map((m) => (
                                    <tr key={m.stage} className="border-b last:border-0">
                                        <td className="py-1">{stages[m.stage] ?? m.stage}%</td>
                                        <td className={`py-1 text-right ${m.error_rate > 0.05 ? "text-red-600 font-semibold" : "text-green-600"}`}>
                                            {fmtPct(m.error_rate)}
                                        </td>
                                        <td className="py-1 text-right">{fmtPct(m.satisfaction_rate)}</td>
                                        <td className="py-1 text-right">{fmtTokens(m.total_tokens)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    <button
                        onClick={load}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                        <RefreshCw className="h-3 w-3" /> 刷新
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── CanaryCard ───────────────────────────────────────────────────────────────

function CanaryCard({
    flag,
    onRefresh,
}: {
    flag: CanaryFlag;
    onRefresh: () => Promise<void>;
}) {
    const [loading, setLoading] = useState(false);

    const act = async (action: "promote" | "rollback") => {
        setLoading(true);
        try {
            await adminFetch(`/api/admin/canary/${encodeURIComponent(flag.flag_name)}/${action}`, {
                method: "POST",
            });
            onRefresh();
        } finally {
            setLoading(false);
        }
    };

    const currentPct = flag.stages[flag.current_stage] ?? 0;
    const isRunning = flag.status === "running";

    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                        {statusIcon(flag.status)}
                        <CardTitle className="text-sm font-semibold font-mono">{flag.flag_name}</CardTitle>
                    </div>
                    {statusBadge(flag.status)}
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {/* Stage progress */}
                <div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>当前阶段</span>
                        <span className="font-semibold text-foreground text-sm">{currentPct}%</span>
                    </div>
                    <div className="flex gap-1">
                        {flag.stages.map((pct, idx) => (
                            <div
                                key={idx}
                                className={`flex-1 h-2 rounded-full transition-all ${
                                    idx < flag.current_stage
                                        ? "bg-green-500"
                                        : idx === flag.current_stage && isRunning
                                        ? "bg-blue-500"
                                        : "bg-muted"
                                }`}
                                title={`${pct}%`}
                            />
                        ))}
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
                        {flag.stages.map((pct, idx) => (
                            <span key={idx}>{pct}%</span>
                        ))}
                    </div>
                </div>

                {/* Info */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>观察期</span>
                    <span className="text-right">{flag.observe_hours}h</span>
                    <span>错误阈值</span>
                    <span className="text-right">{fmtPct(flag.error_rate_threshold)}</span>
                    <span>自动回滚</span>
                    <span className="text-right">{flag.auto_rollback ? "✓ 开启" : "✗ 关闭"}</span>
                    <span>阶段开始</span>
                    <span className="text-right truncate" title={flag.stage_started_at}>
                        {formatDate(flag.stage_started_at)}
                    </span>
                </div>

                {/* Actions */}
                {isRunning && (
                    <div className="flex gap-2 pt-1">
                        <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-7 text-xs"
                            onClick={() => act("promote")}
                            disabled={loading}
                        >
                            <ChevronUp className="h-3 w-3 mr-1" />
                            提级
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => act("rollback")}
                            disabled={loading}
                        >
                            <ChevronDown className="h-3 w-3 mr-1" />
                            降级
                        </Button>
                    </div>
                )}

                {/* Metrics */}
                <MetricsPanel flagName={flag.flag_name} stages={flag.stages} />
            </CardContent>
        </Card>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CanaryPage() {
    const [flags, setFlags] = useState<CanaryFlag[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    // New flag form
    const [formName, setFormName] = useState("");
    const [formError, setFormError] = useState("");

    const load = async () => {
        setLoading(true);
        try {
            const res = await adminFetch("/api/admin/canary");
            if (res.ok) setFlags(await res.json());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleCreate = async () => {
        if (!formName.trim()) { setFormError("请输入 Flag 名称"); return; }
        setFormError("");
        setCreating(true);
        try {
            const res = await adminFetch("/api/admin/canary", {
                method: "POST",
                body: JSON.stringify({ flagName: formName.trim() }),
            });
            if (res.ok) {
                setFormName("");
                await load();
            } else {
                const data = await res.json() as { error?: string };
                setFormError(data.error ?? "创建失败");
            }
        } finally {
            setCreating(false);
        }
    };

    const runningCount = flags.filter(f => f.status === "running").length;
    const completedCount = flags.filter(f => f.status === "completed").length;
    const rolledBackCount = flags.filter(f => f.status === "rolled_back").length;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold flex items-center gap-2">
                        <Rocket className="h-5 w-5 text-blue-500" />
                        Canary 发布管理
                    </h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        渐进式灰度发布：5% → 25% → 50% → 100%
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
                <Card>
                    <CardContent className="pt-4 text-center">
                        <p className="text-2xl font-bold text-blue-600">{runningCount}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">运行中</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4 text-center">
                        <p className="text-2xl font-bold text-green-600">{completedCount}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">已完成</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4 text-center">
                        <p className="text-2xl font-bold text-red-600">{rolledBackCount}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">已回滚</p>
                    </CardContent>
                </Card>
            </div>

            {/* Create new flag */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <PlusCircle className="h-4 w-4" />
                        新建 Canary Flag
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-2 items-end">
                        <div className="flex-1 space-y-1">
                            <Label className="text-xs">Flag 名称</Label>
                            <Input
                                placeholder="例如：claude-managed-agent-v2"
                                value={formName}
                                onChange={e => setFormName(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && handleCreate()}
                                className="h-8 text-sm"
                            />
                        </div>
                        <Button
                            size="sm"
                            className="h-8"
                            onClick={handleCreate}
                            disabled={creating}
                        >
                            {creating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : "创建"}
                        </Button>
                    </div>
                    {formError && (
                        <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {formError}
                        </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                        默认阶段：5% → 25% → 50% → 100%，观察期 24h，错误率阈值 5%
                    </p>
                </CardContent>
            </Card>

            {/* Flags list */}
            {flags.length === 0 && !loading ? (
                <div className="text-center py-12 text-muted-foreground">
                    <Rocket className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">暂无 Canary Flag，创建第一个开始灰度发布</p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {flags.map(flag => (
                        <CanaryCard key={flag.id} flag={flag} onRefresh={load} />
                    ))}
                </div>
            )}
        </div>
    );
}
