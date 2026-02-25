"use client";

import { useEffect, useState } from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2, Link, Globe, Key, Shield, Loader2, AlertCircle } from "lucide-react";
import { fetchApi } from "@/lib/api";

interface ConnectorEndpoint {
    name: string;
    method: string;
    path: string;
    description: string;
}

interface ConnectorConfig {
    name: string;
    baseUrl: string;
    description?: string;
    auth?: {
        type: "api-key" | "bearer" | "basic";
        header?: string;
        key?: string;
    };
    endpoints: ConnectorEndpoint[];
}

const EXAMPLE_CONNECTOR = JSON.stringify(
    {
        name: "my-system",
        baseUrl: "http://internal-api.example.com/api/v1",
        description: "内部系统 API 连接器",
        auth: {
            type: "api-key",
            header: "X-API-Key",
            key: "${MY_SYSTEM_API_KEY}",
        },
        endpoints: [
            {
                name: "get_data",
                method: "GET",
                path: "/data/{id}",
                description: "获取数据",
                params: [
                    { name: "id", type: "string", in: "path", required: true },
                ],
            },
        ],
    },
    null,
    2
);

const AUTH_TYPE_COLORS: Record<string, string> = {
    "api-key": "bg-blue-500/10 text-blue-500 border-blue-500/20",
    bearer: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    basic: "bg-orange-500/10 text-orange-500 border-orange-500/20",
};

function AuthIcon({ type }: { type?: string }) {
    if (type === "api-key") return <Key className="w-3 h-3" />;
    if (type === "bearer") return <Shield className="w-3 h-3" />;
    return <Key className="w-3 h-3" />;
}

export default function ConnectorsPage() {
    const [connectors, setConnectors] = useState<ConnectorConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [jsonInput, setJsonInput] = useState(EXAMPLE_CONNECTOR);
    const [jsonError, setJsonError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [deletingName, setDeletingName] = useState<string | null>(null);

    const loadConnectors = () => {
        setLoading(true);
        setError(null);
        fetchApi<ConnectorConfig[]>("/api/connectors")
            .then((data) => {
                setConnectors(Array.isArray(data) ? data : []);
                setLoading(false);
            })
            .catch((err) => {
                console.error("Failed to load connectors", err);
                setError("加载连接器失败，请检查后端是否在线。");
                setConnectors([]);
                setLoading(false);
            });
    };

    useEffect(() => {
        loadConnectors();
    }, []);

    const handleAdd = async () => {
        setJsonError(null);
        let parsed: ConnectorConfig;
        try {
            parsed = JSON.parse(jsonInput);
        } catch (e: any) {
            setJsonError("JSON 解析错误: " + e.message);
            return;
        }

        if (!parsed.name || !parsed.baseUrl) {
            setJsonError("name 和 baseUrl 为必填字段。");
            return;
        }

        setSaving(true);
        try {
            await fetchApi("/api/connectors", {
                method: "POST",
                body: JSON.stringify(parsed),
            });
            setIsAddOpen(false);
            setJsonInput(EXAMPLE_CONNECTOR);
            loadConnectors();
        } catch (err: any) {
            setJsonError("保存失败: " + err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (name: string) => {
        if (!confirm(`确认删除连接器 "${name}"？`)) return;
        setDeletingName(name);
        try {
            await fetchApi(`/api/connectors/${encodeURIComponent(name)}`, {
                method: "DELETE",
            });
            setConnectors((prev) => prev.filter((c) => c.name !== name));
        } catch (err: any) {
            console.error("Delete failed", err);
            alert("删除失败: " + err.message);
        } finally {
            setDeletingName(null);
        }
    };

    return (
        <div className="h-full overflow-y-auto w-full max-w-5xl mx-auto p-6 space-y-8 pb-10">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">企业连接器</h1>
                    <p className="text-muted-foreground mt-1">
                        管理与外部系统的 API 连接，供 Agent 调用。
                    </p>
                </div>
                <Dialog
                    open={isAddOpen}
                    onOpenChange={(open) => {
                        setIsAddOpen(open);
                        if (!open) {
                            setJsonError(null);
                            setJsonInput(EXAMPLE_CONNECTOR);
                        }
                    }}
                >
                    <DialogTrigger asChild>
                        <Button className="gap-2">
                            <Plus className="w-4 h-4" />
                            新增连接器
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>新增企业连接器</DialogTitle>
                            <DialogDescription>
                                以 JSON 格式定义连接器配置，包括 baseUrl、认证方式和端点列表。
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3 py-2">
                            <Textarea
                                value={jsonInput}
                                onChange={(e) => {
                                    setJsonInput(e.target.value);
                                    setJsonError(null);
                                }}
                                className="font-mono text-sm min-h-[320px] resize-y"
                                placeholder="粘贴连接器 JSON 配置..."
                                spellCheck={false}
                            />
                            {jsonError && (
                                <div className="flex items-center gap-2 text-sm text-destructive">
                                    <AlertCircle className="w-4 h-4 shrink-0" />
                                    {jsonError}
                                </div>
                            )}
                            <p className="text-xs text-muted-foreground">
                                支持环境变量插值，例如{" "}
                                <code className="bg-muted px-1 rounded">
                                    {"${MY_API_KEY}"}
                                </code>
                                。
                            </p>
                        </div>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => setIsAddOpen(false)}
                            >
                                取消
                            </Button>
                            <Button
                                onClick={handleAdd}
                                disabled={saving}
                                className="gap-2"
                            >
                                {saving && (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                )}
                                保存连接器
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                </div>
            )}

            {loading ? (
                <div className="grid gap-6 md:grid-cols-2">
                    {[1, 2, 3].map((i) => (
                        <div
                            key={i}
                            className="h-48 rounded-xl border bg-card animate-pulse"
                        />
                    ))}
                </div>
            ) : connectors.length > 0 ? (
                <div className="grid gap-6 md:grid-cols-2">
                    {connectors.map((connector) => (
                        <Card key={connector.name} className="flex flex-col">
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="space-y-1 min-w-0">
                                        <CardTitle className="flex items-center gap-2 text-base">
                                            <Link className="w-4 h-4 text-primary shrink-0" />
                                            <span className="truncate">
                                                {connector.name}
                                            </span>
                                        </CardTitle>
                                        {connector.description && (
                                            <CardDescription className="line-clamp-2">
                                                {connector.description}
                                            </CardDescription>
                                        )}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                        onClick={() =>
                                            handleDelete(connector.name)
                                        }
                                        disabled={
                                            deletingName === connector.name
                                        }
                                    >
                                        {deletingName === connector.name ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="w-4 h-4" />
                                        )}
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="flex-1 space-y-3">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground font-mono">
                                    <Globe className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate">
                                        {connector.baseUrl}
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {connector.auth?.type && (
                                        <span
                                            className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium ${AUTH_TYPE_COLORS[connector.auth.type] ?? "bg-muted text-muted-foreground"}`}
                                        >
                                            <AuthIcon
                                                type={connector.auth.type}
                                            />
                                            {connector.auth.type}
                                        </span>
                                    )}
                                    <Badge
                                        variant="secondary"
                                        className="text-[11px]"
                                    >
                                        {connector.endpoints?.length ?? 0}{" "}
                                        个端点
                                    </Badge>
                                </div>
                            </CardContent>
                            {connector.endpoints?.length > 0 && (
                                <CardFooter className="pt-0">
                                    <div className="flex flex-wrap gap-1 w-full">
                                        {connector.endpoints
                                            .slice(0, 4)
                                            .map((ep) => (
                                                <Badge
                                                    key={ep.name}
                                                    variant="outline"
                                                    className="font-mono text-[10px]"
                                                >
                                                    <span className="text-primary mr-1">
                                                        {ep.method}
                                                    </span>
                                                    {ep.name}
                                                </Badge>
                                            ))}
                                        {connector.endpoints.length > 4 && (
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] text-muted-foreground"
                                            >
                                                +
                                                {connector.endpoints.length -
                                                    4}{" "}
                                                more
                                            </Badge>
                                        )}
                                    </div>
                                </CardFooter>
                            )}
                        </Card>
                    ))}
                </div>
            ) : (
                <div className="py-24 text-center border-2 border-dashed rounded-xl space-y-4">
                    <Link className="w-12 h-12 text-muted-foreground mx-auto" />
                    <div>
                        <p className="font-medium text-muted-foreground">
                            尚未配置任何连接器
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                            点击「新增连接器」将企业内部 API 接入 Agent。
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
