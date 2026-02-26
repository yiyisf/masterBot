"use client";

import { useEffect, useState } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Webhook,
    Plus,
    Trash2,
    Copy,
    CheckCircle2,
    XCircle,
    Loader2,
    Activity,
} from "lucide-react";
import { fetchApi } from "@/lib/api";

interface WebhookConfig {
    id: string;
    name: string;
    secret: string;
    enabled: boolean;
    description?: string;
    createdAt: string;
    lastTriggeredAt?: string;
    triggerCount: number;
}

export default function WebhooksPage() {
    const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ name: "", description: "" });
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const BASE_URL = process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? window.location.origin : "");

    const load = async () => {
        try {
            const data = await fetchApi<WebhookConfig[]>("/api/webhooks");
            setWebhooks(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleCreate = async () => {
        if (!form.name.trim()) return;
        setCreating(true);
        try {
            await fetchApi("/api/webhooks", {
                method: "POST",
                body: JSON.stringify(form),
            });
            setForm({ name: "", description: "" });
            setShowCreate(false);
            await load();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setCreating(false);
        }
    };

    const handleToggle = async (wh: WebhookConfig) => {
        try {
            await fetchApi(`/api/webhooks/${wh.id}`, {
                method: "PATCH",
                body: JSON.stringify({ enabled: !wh.enabled }),
            });
            await load();
        } catch (e: any) {
            alert(e.message);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("确认删除此 Webhook？")) return;
        try {
            await fetchApi(`/api/webhooks/${id}`, { method: "DELETE" });
            await load();
        } catch (e: any) {
            alert(e.message);
        }
    };

    const copyToClipboard = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch {}
    };

    const getEndpointUrl = (id: string) => `${BASE_URL}/api/webhooks/${id}/trigger`;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6 max-w-4xl">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Webhook className="h-6 w-6" />
                        Webhook 管理
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        创建入站 Webhook，让外部系统触发 AI Agent 执行
                    </p>
                </div>
                <Button onClick={() => setShowCreate(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    新建 Webhook
                </Button>
            </div>

            {webhooks.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                        <Webhook className="h-12 w-12 mb-4 opacity-30" />
                        <p className="text-lg font-medium">暂无 Webhook</p>
                        <p className="text-sm mt-1">点击"新建 Webhook"开始配置</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">
                    {webhooks.map((wh) => (
                        <Card key={wh.id} className={!wh.enabled ? "opacity-60" : ""}>
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                        <div>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                {wh.name}
                                                <Badge variant={wh.enabled ? "default" : "secondary"}>
                                                    {wh.enabled ? "启用" : "禁用"}
                                                </Badge>
                                            </CardTitle>
                                            {wh.description && (
                                                <p className="text-sm text-muted-foreground mt-1">{wh.description}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={wh.enabled}
                                            onCheckedChange={() => handleToggle(wh)}
                                        />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleDelete(wh.id)}
                                        >
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {/* Endpoint URL */}
                                <div>
                                    <Label className="text-xs text-muted-foreground">触发端点 URL</Label>
                                    <div className="flex items-center gap-2 mt-1">
                                        <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono truncate">
                                            {getEndpointUrl(wh.id)}
                                        </code>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => copyToClipboard(getEndpointUrl(wh.id), `url-${wh.id}`)}
                                        >
                                            {copiedId === `url-${wh.id}` ? (
                                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                            ) : (
                                                <Copy className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>
                                </div>

                                {/* Secret */}
                                <div>
                                    <Label className="text-xs text-muted-foreground">签名密钥 (HMAC-SHA256)</Label>
                                    <div className="flex items-center gap-2 mt-1">
                                        <code className="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono truncate">
                                            {wh.secret}
                                        </code>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            onClick={() => copyToClipboard(wh.secret, `secret-${wh.id}`)}
                                        >
                                            {copiedId === `secret-${wh.id}` ? (
                                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                            ) : (
                                                <Copy className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>
                                </div>

                                {/* Stats */}
                                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                                    <span className="flex items-center gap-1">
                                        <Activity className="h-3 w-3" />
                                        触发 {wh.triggerCount} 次
                                    </span>
                                    {wh.lastTriggeredAt && (
                                        <span>最后触发: {new Date(wh.lastTriggeredAt).toLocaleString("zh-CN")}</span>
                                    )}
                                    <span>创建于: {new Date(wh.createdAt).toLocaleDateString("zh-CN")}</span>
                                </div>

                                {/* Usage hint */}
                                <div className="bg-muted/50 rounded p-3 text-xs text-muted-foreground">
                                    <p className="font-medium mb-1">调用示例：</p>
                                    <code className="block whitespace-pre-wrap">
{`curl -X POST ${getEndpointUrl(wh.id)} \\
  -H 'Content-Type: application/json' \\
  -H 'X-Signature: sha256=<hmac_sha256_signature>' \\
  -d '{"alert":"service-down","service":"payment"}'`}
                                    </code>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Create Dialog */}
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>新建 Webhook</DialogTitle>
                        <DialogDescription>
                            创建后系统将生成唯一端点 URL 和签名密钥
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <Label>名称 *</Label>
                            <Input
                                className="mt-1"
                                placeholder="如：监控告警触发器"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                            />
                        </div>
                        <div>
                            <Label>描述（可选）</Label>
                            <Textarea
                                className="mt-1"
                                placeholder="说明此 Webhook 的用途..."
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                rows={3}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
                        <Button onClick={handleCreate} disabled={creating || !form.name.trim()}>
                            {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            创建
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
