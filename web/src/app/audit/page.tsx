"use client";

import { useEffect, useState, useCallback } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    ShieldCheck,
    Download,
    RefreshCw,
    CheckCircle2,
    XCircle,
    Clock,
    AlertTriangle,
    ChevronDown,
    ChevronUp,
    ClipboardList,
    UserCheck,
    CalendarClock,
    GitBranch,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExecutionRecord {
    id: string;
    type: string;
    name: string;
    sessionId?: string;
    triggerSource: string;
    triggerRef?: string;
    status: string;
    inputSummary?: string;
    outputSummary?: string;
    errorMessage?: string;
    durationMs?: number;
    startedAt: string;
    finishedAt?: string;
    createdAt: string;
}

interface AuditApproval {
    id: string;
    executionId?: string;
    sessionId: string;
    interruptId: string;
    actionName?: string;
    dangerReason?: string;
    decision: string;
    operator?: string;
    operatorChannel: string;
    decidedAt: string;
    createdAt: string;
}

interface ScheduledTaskRun {
    id: string;
    scheduledTaskId: string;
    taskName: string;
    cronExpr: string;
    triggerType: string;
    status: string;
    prompt?: string;
    resultSummary?: string;
    errorMessage?: string;
    durationMs?: number;
    startedAt: string;
    finishedAt?: string;
}

interface ComplianceReport {
    from: string;
    to: string;
    generatedAt: string;
    executions: {
        total: number;
        byStatus: Record<string, number>;
        byType: Record<string, number>;
        byTrigger: Record<string, number>;
        successRate: number;
    };
    approvals: {
        total: number;
        byDecision: Record<string, number>;
        approvalRate: number;
    };
    scheduledRuns: {
        total: number;
        successRate: number;
        avgDurationMs: number;
    };
    topFailures: Array<{ name: string; count: number; lastError?: string }>;
}

interface TraceListItem {
    traceId: string;
    sessionId?: string;
    spanCount: number;
    totalDurationMs?: number;
    startedAt: string;
}

interface Span {
    id: string;
    traceId: string;
    parentId?: string;
    name: string;
    agentId?: string;
    sessionId?: string;
    status: "running" | "success" | "failed";
    meta?: Record<string, unknown>;
    result?: string;
    error?: string;
    durationMs?: number;
    startedAt: string;
    endedAt?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
    const variants: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
        success: { label: "成功", icon: <CheckCircle2 className="h-3 w-3" />, className: "bg-green-100 text-green-800" },
        failed:  { label: "失败", icon: <XCircle className="h-3 w-3" />,      className: "bg-red-100 text-red-800" },
        running: { label: "运行中", icon: <Clock className="h-3 w-3" />,       className: "bg-blue-100 text-blue-800" },
        aborted: { label: "中止", icon: <AlertTriangle className="h-3 w-3" />, className: "bg-yellow-100 text-yellow-800" },
    };
    const v = variants[status] ?? { label: status, icon: null, className: "bg-gray-100 text-gray-700" };
    return (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${v.className}`}>
            {v.icon}{v.label}
        </span>
    );
}

function decisionBadge(decision: string) {
    const map: Record<string, string> = {
        approved: "bg-green-100 text-green-800",
        rejected: "bg-red-100 text-red-800",
        timeout:  "bg-yellow-100 text-yellow-800",
        cancelled:"bg-gray-100 text-gray-700",
    };
    const labels: Record<string, string> = {
        approved: "已批准", rejected: "已拒绝", timeout: "已超时", cancelled: "已取消",
    };
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[decision] ?? "bg-gray-100 text-gray-700"}`}>
            {labels[decision] ?? decision}
        </span>
    );
}

function fmtDuration(ms?: number) {
    if (!ms) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(iso?: string) {
    if (!iso) return "-";
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

// ─── Tab 1: Execution Records ─────────────────────────────────────────────────

function ExecutionsTab() {
    const [items, setItems] = useState<ExecutionRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [filter, setFilter] = useState({ type: "", status: "", triggerSource: "", startAfter: "", startBefore: "" });
    const [page, setPage] = useState(0);
    const limit = 20;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
            if (filter.type)          params.set("type", filter.type);
            if (filter.status)        params.set("status", filter.status);
            if (filter.triggerSource) params.set("triggerSource", filter.triggerSource);
            if (filter.startAfter)    params.set("startAfter", filter.startAfter);
            if (filter.startBefore)   params.set("startBefore", filter.startBefore);
            const res = await fetch(`${API_BASE}/api/audit/executions?${params}`);
            const data = await res.json();
            setItems(data.items ?? []);
            setTotal(data.total ?? 0);
        } finally {
            setLoading(false);
        }
    }, [filter, page]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="space-y-4">
            {/* Filter bar */}
            <div className="flex flex-wrap gap-2 items-center">
                <Select value={filter.type || "all"} onValueChange={v => setFilter(f => ({ ...f, type: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-32 h-8 text-xs">
                        <SelectValue placeholder="类型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部类型</SelectItem>
                        {["agent", "runbook", "scheduled", "webhook", "workflow", "dag"].map(t => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={filter.status || "all"} onValueChange={v => setFilter(f => ({ ...f, status: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-28 h-8 text-xs">
                        <SelectValue placeholder="状态" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        {["running", "success", "failed", "aborted"].map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={filter.triggerSource || "all"} onValueChange={v => setFilter(f => ({ ...f, triggerSource: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-28 h-8 text-xs">
                        <SelectValue placeholder="触发源" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部触发源</SelectItem>
                        {["user", "scheduler", "webhook", "im", "api"].map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Input
                    className="h-8 text-xs w-36"
                    type="date"
                    placeholder="开始时间 ≥"
                    value={filter.startAfter ? filter.startAfter.slice(0, 10) : ""}
                    onChange={e => setFilter(f => ({ ...f, startAfter: e.target.value ? e.target.value + "T00:00:00Z" : "" }))}
                />
                <Input
                    className="h-8 text-xs w-36"
                    type="date"
                    placeholder="开始时间 ≤"
                    value={filter.startBefore ? filter.startBefore.slice(0, 10) : ""}
                    onChange={e => setFilter(f => ({ ...f, startBefore: e.target.value ? e.target.value + "T23:59:59Z" : "" }))}
                />
                <Button variant="outline" size="sm" onClick={() => { setPage(0); load(); }} disabled={loading}>
                    <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />刷新
                </Button>
            </div>

            <div className="text-xs text-muted-foreground">共 {total} 条记录</div>

            {/* Table */}
            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                    <thead className="bg-muted">
                        <tr>
                            <th className="text-left p-2 font-medium">类型</th>
                            <th className="text-left p-2 font-medium">名称</th>
                            <th className="text-left p-2 font-medium">触发源</th>
                            <th className="text-left p-2 font-medium">状态</th>
                            <th className="text-left p-2 font-medium">耗时</th>
                            <th className="text-left p-2 font-medium">开始时间</th>
                            <th className="p-2 w-6"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 && (
                            <tr><td colSpan={7} className="text-center text-muted-foreground p-8">暂无数据</td></tr>
                        )}
                        {items.map(r => (
                            <>
                                <tr
                                    key={r.id}
                                    className="border-t hover:bg-muted/40 cursor-pointer"
                                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                                >
                                    <td className="p-2"><Badge variant="outline" className="text-xs">{r.type}</Badge></td>
                                    <td className="p-2 max-w-[200px] truncate font-medium">{r.name}</td>
                                    <td className="p-2 text-muted-foreground">{r.triggerSource}</td>
                                    <td className="p-2">{statusBadge(r.status)}</td>
                                    <td className="p-2 text-muted-foreground">{fmtDuration(r.durationMs)}</td>
                                    <td className="p-2 text-muted-foreground whitespace-nowrap">{fmtTime(r.startedAt)}</td>
                                    <td className="p-2 text-muted-foreground">
                                        {expanded === r.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                    </td>
                                </tr>
                                {expanded === r.id && (
                                    <tr key={`${r.id}-detail`} className="bg-muted/20">
                                        <td colSpan={7} className="p-3">
                                            <div className="grid grid-cols-2 gap-3 text-xs">
                                                {r.inputSummary && (
                                                    <div>
                                                        <div className="font-medium text-muted-foreground mb-1">输入摘要</div>
                                                        <div className="bg-background rounded p-2 text-muted-foreground max-h-24 overflow-y-auto">{r.inputSummary}</div>
                                                    </div>
                                                )}
                                                {r.outputSummary && (
                                                    <div>
                                                        <div className="font-medium text-muted-foreground mb-1">输出摘要</div>
                                                        <div className="bg-background rounded p-2 text-muted-foreground max-h-24 overflow-y-auto">{r.outputSummary}</div>
                                                    </div>
                                                )}
                                                {r.errorMessage && (
                                                    <div className="col-span-2">
                                                        <div className="font-medium text-red-500 mb-1">错误信息</div>
                                                        <div className="bg-red-50 rounded p-2 text-red-600">{r.errorMessage}</div>
                                                    </div>
                                                )}
                                                <div className="text-muted-foreground">完成时间：{fmtTime(r.finishedAt)}</div>
                                                {r.sessionId && <div className="text-muted-foreground">会话 ID：{r.sessionId}</div>}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button>
                <span className="text-xs text-muted-foreground self-center">第 {page + 1} 页</span>
                <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>下一页</Button>
            </div>
        </div>
    );
}

// ─── Tab 2: Approvals ─────────────────────────────────────────────────────────

function ApprovalsTab() {
    const [items, setItems] = useState<AuditApproval[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState({ decision: "", startAfter: "", startBefore: "" });
    const [page, setPage] = useState(0);
    const limit = 20;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
            if (filter.decision)   params.set("decision", filter.decision);
            if (filter.startAfter) params.set("startAfter", filter.startAfter);
            if (filter.startBefore)params.set("startBefore", filter.startBefore);
            const res = await fetch(`${API_BASE}/api/audit/approvals?${params}`);
            const data = await res.json();
            setItems(data.items ?? []);
            setTotal(data.total ?? 0);
        } finally {
            setLoading(false);
        }
    }, [filter, page]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
                <Select value={filter.decision || "all"} onValueChange={v => setFilter(f => ({ ...f, decision: v === "all" ? "" : v }))}>
                    <SelectTrigger className="w-28 h-8 text-xs">
                        <SelectValue placeholder="决策" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部决策</SelectItem>
                        {["approved", "rejected", "timeout", "cancelled"].map(d => (
                            <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Input
                    className="h-8 text-xs w-36"
                    type="date"
                    value={filter.startAfter ? filter.startAfter.slice(0, 10) : ""}
                    onChange={e => setFilter(f => ({ ...f, startAfter: e.target.value ? e.target.value + "T00:00:00Z" : "" }))}
                />
                <Input
                    className="h-8 text-xs w-36"
                    type="date"
                    value={filter.startBefore ? filter.startBefore.slice(0, 10) : ""}
                    onChange={e => setFilter(f => ({ ...f, startBefore: e.target.value ? e.target.value + "T23:59:59Z" : "" }))}
                />
                <Button variant="outline" size="sm" onClick={() => { setPage(0); load(); }} disabled={loading}>
                    <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />刷新
                </Button>
            </div>

            <div className="text-xs text-muted-foreground">共 {total} 条审批记录</div>

            <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                    <thead className="bg-muted">
                        <tr>
                            <th className="text-left p-2 font-medium">操作名</th>
                            <th className="text-left p-2 font-medium">风险原因</th>
                            <th className="text-left p-2 font-medium">决策</th>
                            <th className="text-left p-2 font-medium">操作者</th>
                            <th className="text-left p-2 font-medium">渠道</th>
                            <th className="text-left p-2 font-medium">时间</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 && (
                            <tr><td colSpan={6} className="text-center text-muted-foreground p-8">暂无数据</td></tr>
                        )}
                        {items.map(a => (
                            <tr key={a.id} className="border-t hover:bg-muted/40">
                                <td className="p-2 font-mono">{a.actionName ?? "-"}</td>
                                <td className="p-2 text-muted-foreground max-w-[200px] truncate">{a.dangerReason ?? "-"}</td>
                                <td className="p-2">{decisionBadge(a.decision)}</td>
                                <td className="p-2 text-muted-foreground">{a.operator ?? "系统"}</td>
                                <td className="p-2">
                                    <Badge variant="outline" className="text-xs">{a.operatorChannel}</Badge>
                                </td>
                                <td className="p-2 text-muted-foreground whitespace-nowrap">{fmtTime(a.decidedAt)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button>
                <span className="text-xs text-muted-foreground self-center">第 {page + 1} 页</span>
                <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>下一页</Button>
            </div>
        </div>
    );
}

// ─── Tab 3: Compliance Report ─────────────────────────────────────────────────

function ReportTab() {
    const today = new Date().toISOString().slice(0, 10);
    const firstDayOfMonth = today.slice(0, 7) + "-01";
    const [from, setFrom] = useState(firstDayOfMonth);
    const [to, setTo] = useState(today);
    const [report, setReport] = useState<ComplianceReport | null>(null);
    const [loading, setLoading] = useState(false);

    const loadReport = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/audit/report?from=${from}T00:00:00Z&to=${to}T23:59:59Z`);
            setReport(await res.json());
        } finally {
            setLoading(false);
        }
    };

    const downloadCSV = () => {
        window.open(`${API_BASE}/api/audit/report?from=${from}T00:00:00Z&to=${to}T23:59:59Z&format=csv`, "_blank");
    };

    useEffect(() => { loadReport(); }, []);

    return (
        <div className="space-y-4">
            <div className="flex gap-2 items-center">
                <Input type="date" className="h-8 text-xs w-36" value={from} onChange={e => setFrom(e.target.value)} />
                <span className="text-xs text-muted-foreground">至</span>
                <Input type="date" className="h-8 text-xs w-36" value={to} onChange={e => setTo(e.target.value)} />
                <Button size="sm" onClick={loadReport} disabled={loading}>
                    <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />生成报告
                </Button>
                <Button size="sm" variant="outline" onClick={downloadCSV}>
                    <Download className="h-3 w-3 mr-1" />导出 CSV
                </Button>
            </div>

            {report && (
                <div className="space-y-4">
                    {/* Stats cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Card>
                            <CardContent className="p-4">
                                <div className="text-2xl font-bold">{report.executions.total}</div>
                                <div className="text-xs text-muted-foreground mt-1">总执行次数</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4">
                                <div className="text-2xl font-bold text-green-600">{report.executions.successRate}%</div>
                                <div className="text-xs text-muted-foreground mt-1">执行成功率</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4">
                                <div className="text-2xl font-bold">{report.approvals.total}</div>
                                <div className="text-xs text-muted-foreground mt-1">HitL 审批次数</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4">
                                <div className="text-2xl font-bold text-blue-600">{report.approvals.approvalRate}%</div>
                                <div className="text-xs text-muted-foreground mt-1">审批通过率</div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* By status */}
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-sm">执行状态分布</CardTitle></CardHeader>
                            <CardContent>
                                {Object.entries(report.executions.byStatus).map(([k, v]) => (
                                    <div key={k} className="flex justify-between items-center text-xs py-1">
                                        <span>{statusBadge(k)}</span>
                                        <span className="font-mono font-medium">{v}</span>
                                    </div>
                                ))}
                                {Object.keys(report.executions.byStatus).length === 0 && (
                                    <div className="text-xs text-muted-foreground">暂无数据</div>
                                )}
                            </CardContent>
                        </Card>

                        {/* By type */}
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-sm">执行类型分布</CardTitle></CardHeader>
                            <CardContent>
                                {Object.entries(report.executions.byType).map(([k, v]) => (
                                    <div key={k} className="flex justify-between items-center text-xs py-1">
                                        <Badge variant="outline">{k}</Badge>
                                        <span className="font-mono font-medium">{v}</span>
                                    </div>
                                ))}
                                {Object.keys(report.executions.byType).length === 0 && (
                                    <div className="text-xs text-muted-foreground">暂无数据</div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Scheduled runs */}
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-sm">定时任务统计</CardTitle></CardHeader>
                            <CardContent className="space-y-2 text-xs">
                                <div className="flex justify-between"><span className="text-muted-foreground">总运行次数</span><span className="font-mono font-medium">{report.scheduledRuns.total}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">成功率</span><span className="font-mono font-medium text-green-600">{report.scheduledRuns.successRate}%</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">平均耗时</span><span className="font-mono font-medium">{fmtDuration(report.scheduledRuns.avgDurationMs)}</span></div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Top failures */}
                    {report.topFailures.length > 0 && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm">失败最多的任务</CardTitle>
                                <CardDescription className="text-xs">Top {report.topFailures.length}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-muted-foreground">
                                            <th className="text-left py-1">任务名</th>
                                            <th className="text-right py-1">失败次数</th>
                                            <th className="text-left py-1 pl-4">最近错误</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {report.topFailures.map((f, i) => (
                                            <tr key={i} className="border-t">
                                                <td className="py-1 font-medium">{f.name}</td>
                                                <td className="py-1 text-right text-red-500 font-mono">{f.count}</td>
                                                <td className="py-1 pl-4 text-muted-foreground truncate max-w-[300px]">{f.lastError ?? "-"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </CardContent>
                        </Card>
                    )}

                    <div className="text-xs text-muted-foreground">报告生成时间：{fmtTime(report.generatedAt)}</div>
                </div>
            )}
        </div>
    );
}

// ─── Tab 4: Call Traces (Waterfall) ───────────────────────────────────────────

function SpanWaterfall({ spans }: { spans: Span[] }) {
    if (spans.length === 0) return <div className="text-xs text-muted-foreground p-4">暂无 span 数据</div>;

    // 计算深度（BFS）
    const depthMap = new Map<string, number>();
    const rootSpans = spans.filter(s => !s.parentId);
    for (const s of rootSpans) depthMap.set(s.id, 0);

    // 多次遍历，直到所有 span 深度已确定（最多 10 轮防止无限循环）
    for (let pass = 0; pass < 10; pass++) {
        let changed = false;
        for (const s of spans) {
            if (depthMap.has(s.id)) continue;
            if (s.parentId && depthMap.has(s.parentId)) {
                depthMap.set(s.id, (depthMap.get(s.parentId) ?? 0) + 1);
                changed = true;
            }
        }
        if (!changed) break;
    }
    // 未能确定深度的 span 设为 0
    for (const s of spans) {
        if (!depthMap.has(s.id)) depthMap.set(s.id, 0);
    }

    // 总时长用于计算宽度比例
    const minStart = Math.min(...spans.map(s => new Date(s.startedAt).getTime()));
    const maxEnd = Math.max(...spans.map(s =>
        s.endedAt ? new Date(s.endedAt).getTime() : new Date(s.startedAt).getTime() + (s.durationMs ?? 0)
    ));
    const totalMs = Math.max(maxEnd - minStart, 1);

    const spanStatusColor = (status: string) => {
        if (status === "success") return "bg-green-400";
        if (status === "failed") return "bg-red-400";
        return "bg-blue-400 animate-pulse";
    };

    const spanNameColor = (name: string) => {
        if (name.startsWith("delegate:")) return "text-purple-600 font-semibold";
        if (name.startsWith("tool:")) return "text-blue-600";
        return "text-foreground font-medium";
    };

    return (
        <div className="space-y-0.5 font-mono text-xs overflow-x-auto">
            <div className="flex items-center gap-2 pb-1 border-b mb-2 text-muted-foreground sticky top-0 bg-background">
                <span className="w-64 shrink-0">Span 名称</span>
                <span className="w-16 shrink-0 text-right">耗时</span>
                <span className="flex-1">时序</span>
                <span className="w-14 shrink-0 text-right">状态</span>
            </div>
            {spans.map(span => {
                const depth = depthMap.get(span.id) ?? 0;
                const startOffset = new Date(span.startedAt).getTime() - minStart;
                const barWidth = span.durationMs ? (span.durationMs / totalMs) * 100 : 2;
                const barLeft = (startOffset / totalMs) * 100;
                return (
                    <div key={span.id} className="flex items-center gap-2 py-0.5 hover:bg-muted/40 rounded">
                        {/* Span name with indent */}
                        <div
                            className="w-64 shrink-0 truncate"
                            style={{ paddingLeft: `${depth * 16}px` }}
                        >
                            <span className={spanNameColor(span.name)}>
                                {depth > 0 && <span className="text-muted-foreground mr-1">└</span>}
                                {span.name}
                            </span>
                        </div>
                        {/* Duration */}
                        <div className="w-16 shrink-0 text-right text-muted-foreground">
                            {fmtDuration(span.durationMs)}
                        </div>
                        {/* Timeline bar */}
                        <div className="flex-1 relative h-4 bg-muted/30 rounded overflow-hidden">
                            <div
                                className={`absolute top-0.5 h-3 rounded ${spanStatusColor(span.status)} opacity-80`}
                                style={{
                                    left: `${Math.min(barLeft, 99)}%`,
                                    width: `${Math.max(barWidth, 0.5)}%`,
                                }}
                                title={span.error || span.result || span.name}
                            />
                        </div>
                        {/* Status */}
                        <div className="w-14 shrink-0 text-right">
                            {statusBadge(span.status)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function TracesTab() {
    const [traces, setTraces] = useState<TraceListItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [spans, setSpans] = useState<Record<string, Span[]>>({});
    const [spansLoading, setSpansLoading] = useState<string | null>(null);
    const [page, setPage] = useState(0);
    const limit = 20;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
            const res = await fetch(`${API_BASE}/api/audit/traces?${params}`);
            const data = await res.json();
            setTraces(data.items ?? []);
        } finally {
            setLoading(false);
        }
    }, [page]);

    useEffect(() => { load(); }, [load]);

    const toggleTrace = async (traceId: string) => {
        if (expanded === traceId) {
            setExpanded(null);
            return;
        }
        setExpanded(traceId);
        if (!spans[traceId]) {
            setSpansLoading(traceId);
            try {
                const res = await fetch(`${API_BASE}/api/audit/traces/${encodeURIComponent(traceId)}`);
                const data = await res.json();
                setSpans(prev => ({ ...prev, [traceId]: data.spans ?? [] }));
            } finally {
                setSpansLoading(null);
            }
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => { setPage(0); load(); }} disabled={loading}>
                    <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />刷新
                </Button>
                <span className="text-xs text-muted-foreground">最近 {traces.length} 条追踪记录</span>
            </div>

            {traces.length === 0 && !loading && (
                <div className="text-center text-muted-foreground py-12 text-sm">
                    暂无追踪记录。执行 Agent 任务后将自动生成追踪数据。
                </div>
            )}

            <div className="space-y-2">
                {traces.map(trace => (
                    <div key={trace.traceId} className="border rounded-lg overflow-hidden">
                        <div
                            className="flex items-center gap-3 p-3 hover:bg-muted/40 cursor-pointer"
                            onClick={() => toggleTrace(trace.traceId)}
                        >
                            <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="font-mono text-xs truncate text-muted-foreground">{trace.traceId}</div>
                                {trace.sessionId && (
                                    <div className="text-xs text-muted-foreground">会话: {trace.sessionId}</div>
                                )}
                            </div>
                            <div className="text-xs text-muted-foreground whitespace-nowrap">
                                {trace.spanCount} spans
                            </div>
                            <div className="text-xs text-muted-foreground whitespace-nowrap">
                                {fmtDuration(trace.totalDurationMs)}
                            </div>
                            <div className="text-xs text-muted-foreground whitespace-nowrap">
                                {fmtTime(trace.startedAt)}
                            </div>
                            {expanded === trace.traceId
                                ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
                                : <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            }
                        </div>
                        {expanded === trace.traceId && (
                            <div className="border-t p-4 bg-muted/10">
                                {spansLoading === trace.traceId ? (
                                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                                        <RefreshCw className="h-3 w-3 animate-spin" />加载 spans...
                                    </div>
                                ) : (
                                    <SpanWaterfall spans={spans[trace.traceId] ?? []} />
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button>
                <span className="text-xs text-muted-foreground self-center">第 {page + 1} 页</span>
                <Button variant="outline" size="sm" disabled={traces.length < limit} onClick={() => setPage(p => p + 1)}>下一页</Button>
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AuditPage() {
    return (
        <div className="flex flex-col h-full overflow-y-auto">
            <div className="flex-none p-6 pb-0">
                <div className="flex items-center gap-2 mb-1">
                    <ShieldCheck className="h-6 w-6 text-primary" />
                    <h1 className="text-2xl font-bold">合规审计</h1>
                </div>
                <p className="text-sm text-muted-foreground">
                    执行记录追溯、HitL 审批历史、合规报告与多 Agent 调用追踪
                </p>
            </div>

            <div className="flex-1 p-6 pt-4 min-h-0">
                <Tabs defaultValue="executions" className="h-full flex flex-col">
                    <TabsList className="flex-none">
                        <TabsTrigger value="executions" className="gap-1.5">
                            <ClipboardList className="h-3.5 w-3.5" />执行记录
                        </TabsTrigger>
                        <TabsTrigger value="approvals" className="gap-1.5">
                            <UserCheck className="h-3.5 w-3.5" />审批记录
                        </TabsTrigger>
                        <TabsTrigger value="report" className="gap-1.5">
                            <CalendarClock className="h-3.5 w-3.5" />合规报告
                        </TabsTrigger>
                        <TabsTrigger value="traces" className="gap-1.5">
                            <GitBranch className="h-3.5 w-3.5" />调用追踪
                        </TabsTrigger>
                    </TabsList>

                    <div className="flex-1 overflow-y-auto pt-4">
                        <TabsContent value="executions" className="mt-0">
                            <ExecutionsTab />
                        </TabsContent>
                        <TabsContent value="approvals" className="mt-0">
                            <ApprovalsTab />
                        </TabsContent>
                        <TabsContent value="report" className="mt-0">
                            <ReportTab />
                        </TabsContent>
                        <TabsContent value="traces" className="mt-0">
                            <TracesTab />
                        </TabsContent>
                    </div>
                </Tabs>
            </div>
        </div>
    );
}
