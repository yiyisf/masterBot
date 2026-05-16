"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react";
import { adminFetch } from "@/lib/admin";

interface SkillReview {
    id: string;
    skill_name: string;
    skill_path: string;
    status: "pending" | "approved" | "rejected";
    review_notes: string | null;
    reviewer: string | null;
    created_at: string;
    updated_at: string;
}

const STATUS_BADGE: Record<string, { label: string; variant: any; icon: any }> = {
    pending: { label: "待审批", variant: "secondary", icon: Clock },
    approved: { label: "已批准", variant: "default", icon: CheckCircle2 },
    rejected: { label: "已拒绝", variant: "destructive", icon: XCircle },
};

export default function SkillReviewPage() {
    const [reviews, setReviews] = useState<SkillReview[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<string>("all");
    const [processing, setProcessing] = useState<string | null>(null);
    const [notes, setNotes] = useState<Record<string, string>>({});

    const load = async (status?: string) => {
        setLoading(true);
        const qs = status && status !== "all" ? `?status=${status}` : "";
        try {
            const res = await adminFetch(`/api/admin/skills/review${qs}`);
            if (res.ok) setReviews(await res.json());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(filterStatus); }, [filterStatus]);

    const decide = async (skillName: string, status: "approved" | "rejected") => {
        setProcessing(skillName);
        try {
            const res = await adminFetch(`/api/admin/skills/review/${encodeURIComponent(skillName)}`, {
                method: "POST",
                body: JSON.stringify({ status, notes: notes[skillName] }),
            });
            if (res.ok) {
                await load(filterStatus);
            } else {
                alert("操作失败: " + (await res.json()).error);
            }
        } finally {
            setProcessing(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold">技能审批</h1>
                <div className="flex items-center gap-2">
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                        <SelectTrigger className="w-32">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部</SelectItem>
                            <SelectItem value="pending">待审批</SelectItem>
                            <SelectItem value="approved">已批准</SelectItem>
                            <SelectItem value="rejected">已拒绝</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={() => load(filterStatus)} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    </Button>
                </div>
            </div>

            {reviews.length === 0 && !loading && (
                <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                        暂无技能审批记录
                    </CardContent>
                </Card>
            )}

            {reviews.map(r => {
                const info = STATUS_BADGE[r.status];
                const Icon = info.icon;
                const isPending = r.status === "pending";
                return (
                    <Card key={r.id}>
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <CardTitle className="text-base">{r.skill_name}</CardTitle>
                                    <Badge variant={info.variant} className="flex items-center gap-1 text-xs">
                                        <Icon className="h-3 w-3" />
                                        {info.label}
                                    </Badge>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    {new Date(r.created_at).toLocaleDateString("zh-CN")}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 font-mono">{r.skill_path}</p>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {r.review_notes && (
                                <p className="text-sm text-muted-foreground bg-muted/40 rounded px-3 py-2">
                                    审批备注：{r.review_notes}
                                </p>
                            )}
                            {r.reviewer && (
                                <p className="text-xs text-muted-foreground">审批人：{r.reviewer}</p>
                            )}
                            {isPending && (
                                <div className="space-y-2">
                                    <Textarea
                                        placeholder="审批备注（可选）"
                                        className="text-sm resize-none h-16"
                                        value={notes[r.skill_name] ?? ""}
                                        onChange={e => setNotes(prev => ({ ...prev, [r.skill_name]: e.target.value }))}
                                    />
                                    <div className="flex gap-2">
                                        <Button
                                            size="sm"
                                            onClick={() => decide(r.skill_name, "approved")}
                                            disabled={processing === r.skill_name}
                                            className="gap-1"
                                        >
                                            <CheckCircle2 className="h-4 w-4" />
                                            批准
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="destructive"
                                            onClick={() => decide(r.skill_name, "rejected")}
                                            disabled={processing === r.skill_name}
                                            className="gap-1"
                                        >
                                            <XCircle className="h-4 w-4" />
                                            拒绝
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
