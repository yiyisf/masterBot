"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, RefreshCw, Search } from "lucide-react";
import { adminFetch, API_BASE } from "@/lib/admin";

interface AuditRecord {
    id: string;
    type: string;
    name?: string;
    session_id?: string;
    user_id?: string;
    trigger_source?: string;
    status: string;
    input_summary?: string;
    started_at: string;
    finished_at?: string;
}

const STATUS_COLOR: Record<string, string> = {
    success: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    running: "bg-blue-100 text-blue-800",
    pending: "bg-gray-100 text-gray-800",
};

const PAGE_SIZE = 20;

export default function AdminAuditPage() {
    const [records, setRecords] = useState<AuditRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(0);

    const [userId, setUserId] = useState("");
    const [sessionId, setSessionId] = useState("");
    const [type, setType] = useState("all");
    const [status, setStatus] = useState("all");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");

    const buildQs = (offset: number) => {
        const params = new URLSearchParams();
        if (userId) params.set("userId", userId);
        if (sessionId) params.set("sessionId", sessionId);
        if (type && type !== "all") params.set("type", type);
        if (status && status !== "all") params.set("status", status);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(offset));
        return params.toString();
    };

    const load = async (newPage = 0) => {
        setLoading(true);
        setPage(newPage);
        try {
            const res = await adminFetch(`/api/admin/audit?${buildQs(newPage * PAGE_SIZE)}`);
            if (res.ok) {
                const data = await res.json();
                setRecords(data.rows ?? []);
                setTotal(data.total ?? 0);
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const exportCsv = () => {
        const url = `${API_BASE}/api/audit/export?${buildQs(0).replace(`limit=${PAGE_SIZE}`, "limit=10000")}`;
        window.open(url, "_blank");
    };

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold">审计查询 <span className="text-sm font-normal text-muted-foreground">（只读）</span></h1>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={exportCsv}>
                        <Download className="h-4 w-4 mr-1" />
                        导出 CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => load(0)} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                </div>
            </div>

            {/* Filter Form */}
            <Card>
                <CardContent className="pt-4">
                    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
                        <Input placeholder="User ID" value={userId} onChange={e => setUserId(e.target.value)} />
                        <Input placeholder="Session ID" value={sessionId} onChange={e => setSessionId(e.target.value)} />
                        <Select value={type} onValueChange={setType}>
                            <SelectTrigger><SelectValue placeholder="类型" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">全部类型</SelectItem>
                                <SelectItem value="agent">Agent</SelectItem>
                                <SelectItem value="workflow">Workflow</SelectItem>
                                <SelectItem value="webhook">Webhook</SelectItem>
                                <SelectItem value="scheduled">定时任务</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger><SelectValue placeholder="状态" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">全部状态</SelectItem>
                                <SelectItem value="success">成功</SelectItem>
                                <SelectItem value="failed">失败</SelectItem>
                                <SelectItem value="running">运行中</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
                        <Input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
                    </div>
                    <Button className="mt-3 gap-1" size="sm" onClick={() => load(0)} disabled={loading}>
                        <Search className="h-4 w-4" />
                        搜索
                    </Button>
                </CardContent>
            </Card>

            {/* Results */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm font-medium">
                        共 {total} 条记录，第 {page + 1} / {Math.max(1, totalPages)} 页
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {records.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">暂无数据</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b text-muted-foreground">
                                        <th className="text-left py-2 pr-3">ID</th>
                                        <th className="text-left py-2 pr-3">类型</th>
                                        <th className="text-left py-2 pr-3">名称</th>
                                        <th className="text-left py-2 pr-3">状态</th>
                                        <th className="text-left py-2 pr-3">来源</th>
                                        <th className="text-left py-2">开始时间</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {records.map(r => (
                                        <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                                            <td className="py-2 pr-3 font-mono text-muted-foreground">{r.id.slice(0, 8)}</td>
                                            <td className="py-2 pr-3">{r.type}</td>
                                            <td className="py-2 pr-3 max-w-32 truncate">{r.name ?? "—"}</td>
                                            <td className="py-2 pr-3">
                                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[r.status] ?? "bg-gray-100 text-gray-800"}`}>
                                                    {r.status}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-3 text-muted-foreground">{r.trigger_source ?? "—"}</td>
                                            <td className="py-2 text-muted-foreground">
                                                {new Date(r.started_at).toLocaleString("zh-CN")}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {totalPages > 1 && (
                        <div className="flex items-center gap-2 mt-4 justify-end">
                            <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => load(page - 1)}>
                                上一页
                            </Button>
                            <span className="text-sm text-muted-foreground">{page + 1} / {totalPages}</span>
                            <Button variant="outline" size="sm" disabled={page >= totalPages - 1 || loading} onClick={() => load(page + 1)}>
                                下一页
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
