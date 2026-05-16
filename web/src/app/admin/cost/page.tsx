"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, TrendingUp, Cpu, Users } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const ADMIN_KEY_STORAGE = "cmaster_admin_key";
function getAdminKey() {
    return typeof window !== "undefined" ? localStorage.getItem(ADMIN_KEY_STORAGE) ?? "" : "";
}

interface DailyRow { date: string; total_tokens: number; prompt_tokens: number; completion_tokens: number; calls: number }
interface ModelRow { model: string; total_tokens: number; calls: number }
interface UserRow { session_id: string; total_tokens: number; calls: number }
interface CostData { daily: DailyRow[]; byModel: ModelRow[]; topUsers: UserRow[] }

function formatN(n: number) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return String(n);
}

export default function CostPage() {
    const [data, setData] = useState<CostData | null>(null);
    const [loading, setLoading] = useState(true);
    const [days, setDays] = useState("30");

    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/cost?days=${days}`, {
                headers: { "X-Admin-Key": getAdminKey() },
            });
            if (res.ok) setData(await res.json());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, [days]);

    const totalTokens = data?.daily.reduce((s, r) => s + r.total_tokens, 0) ?? 0;
    const totalCalls = data?.daily.reduce((s, r) => s + r.calls, 0) ?? 0;
    const maxTokens = Math.max(...(data?.daily.map(r => r.total_tokens) ?? [1]));

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold">成本看板</h1>
                <div className="flex items-center gap-2">
                    <Select value={days} onValueChange={setDays}>
                        <SelectTrigger className="w-28">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="7">近 7 天</SelectItem>
                            <SelectItem value="30">近 30 天</SelectItem>
                            <SelectItem value="90">近 90 天</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 grid-cols-2">
                <Card>
                    <CardContent className="pt-4 flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-purple-50">
                            <TrendingUp className="h-5 w-5 text-purple-600" />
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">总 Token 用量</p>
                            <p className="text-2xl font-semibold">{formatN(totalTokens)}</p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4 flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-50">
                            <Cpu className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">总调用次数</p>
                            <p className="text-2xl font-semibold">{formatN(totalCalls)}</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Daily Chart (bar chart via divs) */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        每日 Token 用量
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {!data?.daily.length ? (
                        <p className="text-sm text-muted-foreground">暂无数据</p>
                    ) : (
                        <div className="space-y-1">
                            {data.daily.map(row => {
                                const pct = maxTokens > 0 ? (row.total_tokens / maxTokens) * 100 : 0;
                                return (
                                    <div key={row.date} className="flex items-center gap-2 text-xs">
                                        <span className="w-20 shrink-0 text-muted-foreground">{row.date}</span>
                                        <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                                            <div
                                                className="h-full bg-purple-500 rounded-full transition-all"
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                        <span className="w-14 text-right shrink-0">{formatN(row.total_tokens)}</span>
                                        <span className="w-10 text-right shrink-0 text-muted-foreground">{row.calls}次</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
                {/* By Model */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Cpu className="h-4 w-4" />
                            按模型分布
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {!data?.byModel.length ? (
                            <p className="text-sm text-muted-foreground">暂无数据</p>
                        ) : (
                            <div className="space-y-2">
                                {data.byModel.map(r => (
                                    <div key={r.model} className="flex items-center gap-2 text-sm">
                                        <span className="flex-1 truncate font-mono text-xs">{r.model}</span>
                                        <span className="text-muted-foreground text-xs">{r.calls} 次</span>
                                        <span className="font-medium w-16 text-right">{formatN(r.total_tokens)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Top Users */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            Top 10 会话（按 Token）
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {!data?.topUsers.length ? (
                            <p className="text-sm text-muted-foreground">暂无数据</p>
                        ) : (
                            <div className="space-y-2">
                                {data.topUsers.map((r, i) => (
                                    <div key={r.session_id} className="flex items-center gap-2 text-sm">
                                        <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                                        <span className="flex-1 truncate font-mono text-xs">{r.session_id.slice(0, 16)}…</span>
                                        <span className="text-muted-foreground text-xs">{r.calls} 次</span>
                                        <span className="font-medium w-16 text-right">{formatN(r.total_tokens)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
