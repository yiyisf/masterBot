"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, RefreshCw, Shield } from "lucide-react";
import { adminFetch } from "@/lib/admin";

interface RbacRule {
    id: string;
    subject: string;
    scope: string;
    effect: "allow" | "deny";
    created_by: string | null;
    created_at: string;
}

export default function RbacPage() {
    const [rules, setRules] = useState<RbacRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [subject, setSubject] = useState("");
    const [scope, setScope] = useState("");
    const [effect, setEffect] = useState<"allow" | "deny">("allow");
    const [adding, setAdding] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const res = await adminFetch("/api/admin/rbac");
            if (res.ok) setRules(await res.json());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const addRule = async () => {
        if (!subject.trim() || !scope.trim()) return;
        setAdding(true);
        try {
            const res = await adminFetch("/api/admin/rbac", {
                method: "POST",
                body: JSON.stringify({ subject: subject.trim(), scope: scope.trim(), effect }),
            });
            if (res.ok) {
                setSubject(""); setScope(""); setEffect("allow");
                await load();
            } else {
                alert("创建失败: " + (await res.json()).error);
            }
        } finally {
            setAdding(false);
        }
    };

    const deleteRule = async (id: string) => {
        if (!confirm("确认删除此规则？")) return;
        const res = await adminFetch(`/api/admin/rbac/${id}`, { method: "DELETE" });
        if (res.ok) await load();
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold">RBAC 配置</h1>
                <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
            </div>

            {/* Add Rule Form */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        新增权限规则
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-2 flex-wrap">
                        <Input
                            className="flex-1 min-w-32"
                            placeholder="Subject（userId / role / *）"
                            value={subject}
                            onChange={e => setSubject(e.target.value)}
                        />
                        <Input
                            className="flex-1 min-w-32"
                            placeholder="Scope（技能名 / 分类 / *）"
                            value={scope}
                            onChange={e => setScope(e.target.value)}
                        />
                        <Select value={effect} onValueChange={v => setEffect(v as "allow" | "deny")}>
                            <SelectTrigger className="w-28">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="allow">✅ Allow</SelectItem>
                                <SelectItem value="deny">❌ Deny</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button onClick={addRule} disabled={adding || !subject.trim() || !scope.trim()}>
                            添加
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                        示例：Subject=<code>user:alice</code> Scope=<code>shell</code> Effect=<code>deny</code>
                        —— 禁止 alice 使用 shell 技能
                    </p>
                </CardContent>
            </Card>

            {/* Rules Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        当前规则（{rules.length} 条）
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {rules.length === 0 ? (
                        <p className="text-sm text-muted-foreground">暂无 RBAC 规则，系统默认允许所有操作</p>
                    ) : (
                        <div className="space-y-2">
                            {rules.map(r => (
                                <div key={r.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                                    <code className="text-xs bg-muted px-2 py-0.5 rounded">{r.subject}</code>
                                    <span className="text-xs text-muted-foreground">→</span>
                                    <code className="text-xs bg-muted px-2 py-0.5 rounded">{r.scope}</code>
                                    <Badge
                                        variant={r.effect === "allow" ? "default" : "destructive"}
                                        className="text-xs"
                                    >
                                        {r.effect === "allow" ? "Allow" : "Deny"}
                                    </Badge>
                                    {r.created_by && (
                                        <span className="text-xs text-muted-foreground ml-auto mr-2">
                                            by {r.created_by}
                                        </span>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7 text-destructive hover:text-destructive ml-auto"
                                        onClick={() => deleteRule(r.id)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
