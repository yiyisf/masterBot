"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, CheckSquare, Clock, Coins, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/lib/admin";

interface Stats {
    agentCallsToday: number;
    pendingSkillReviews: number;
    pendingApprovals: number;
    totalTokensToday: number;
    recentAdminActions: { id: string; admin_id: string; action: string; target?: string; created_at: string }[];
}

export default function AdminOverviewPage() {
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        try {
            const res = await adminFetch("/api/admin/stats");
            if (res.ok) setStats(await res.json());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold">管理概览</h1>
                <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                    刷新
                </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                <StatCard
                    icon={Bot}
                    label="今日 Agent 调用"
                    value={stats?.agentCallsToday ?? "-"}
                    color="blue"
                />
                <StatCard
                    icon={CheckSquare}
                    label="待审批技能"
                    value={stats?.pendingSkillReviews ?? "-"}
                    color={stats && stats.pendingSkillReviews > 0 ? "yellow" : "green"}
                    href="/admin/skills/review"
                />
                <StatCard
                    icon={Clock}
                    label="待审批 HitL"
                    value={stats?.pendingApprovals ?? "-"}
                    color={stats && stats.pendingApprovals > 0 ? "orange" : "green"}
                    href="/admin/audit"
                />
                <StatCard
                    icon={Coins}
                    label="今日 Token 用量"
                    value={stats ? formatTokens(stats.totalTokensToday) : "-"}
                    color="purple"
                    href="/admin/cost"
                />
            </div>

            {/* Recent Admin Actions */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm font-medium">最近管理操作</CardTitle>
                </CardHeader>
                <CardContent>
                    {!stats?.recentAdminActions?.length ? (
                        <p className="text-sm text-muted-foreground">暂无操作记录</p>
                    ) : (
                        <div className="space-y-2">
                            {stats.recentAdminActions.map(a => (
                                <div key={a.id} className="flex items-center gap-3 text-sm">
                                    <Badge variant="outline" className="text-xs shrink-0">{a.action}</Badge>
                                    <span className="text-muted-foreground truncate">{a.target ?? "—"}</span>
                                    <span className="ml-auto text-xs text-muted-foreground shrink-0">
                                        {new Date(a.created_at).toLocaleString("zh-CN")}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function StatCard({
    icon: Icon,
    label,
    value,
    color,
    href,
}: {
    icon: any;
    label: string;
    value: number | string;
    color: "blue" | "green" | "yellow" | "orange" | "purple";
    href?: string;
}) {
    const colorMap = {
        blue: "text-blue-600 bg-blue-50",
        green: "text-green-600 bg-green-50",
        yellow: "text-yellow-600 bg-yellow-50",
        orange: "text-orange-600 bg-orange-50",
        purple: "text-purple-600 bg-purple-50",
    };

    const card = (
        <Card className={href ? "cursor-pointer hover:shadow-sm transition-shadow" : ""}>
            <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${colorMap[color]}`}>
                        <Icon className="h-5 w-5" />
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="text-2xl font-semibold">{value}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );

    if (href) {
        return <a href={href}>{card}</a>;
    }
    return card;
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return String(n);
}
