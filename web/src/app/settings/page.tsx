"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
    Save,
    RotateCw,
    ShieldCheck,
    Cpu,
    CheckCircle2,
    XCircle,
    Loader2,
    Bot,
    Database,
    KeyRound,
    Eye,
    EyeOff,
    RefreshCw,
} from "lucide-react";
import { fetchApi } from "@/lib/api";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProviderConfig {
    type: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTokens?: number;
    embeddingModel?: string;
}

interface ModelsConfig {
    default: string;
    providers: Record<string, ProviderConfig>;
}

interface SecurityConfig {
    sandbox: { enabled: boolean; mode: "blocklist" | "allowlist" };
    auth: { enabled: boolean; mode: "api-key" | "jwt"; apiKeys?: string[] };
}

interface AgentConfig {
    maxIterations: number;
    maxContextTokens: number;
}

type TestStatus = "idle" | "testing" | "ok" | "error";

// ── Small helpers ──────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: TestStatus }) {
    if (status === "testing") return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
    if (status === "ok") return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    if (status === "error") return <XCircle className="w-4 h-4 text-red-500" />;
    return null;
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function SettingsPage() {
    // ─ state
    const [models, setModels] = useState<ModelsConfig | null>(null);
    const [security, setSecurity] = useState<SecurityConfig | null>(null);
    const [agent, setAgent] = useState<AgentConfig | null>(null);

    const [savingModels, setSavingModels] = useState(false);
    const [savingSecurity, setSavingSecurity] = useState(false);
    const [savingAgent, setSavingAgent] = useState(false);

    const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});
    const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);

    // ─ load all config sections
    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [m, s, a] = await Promise.all([
                fetchApi<ModelsConfig>("/api/config/models"),
                fetchApi<SecurityConfig>("/api/config/security"),
                fetchApi<AgentConfig>("/api/config/agent"),
            ]);
            setModels(m);
            setSecurity(s);
            setAgent(a);
        } catch (err: any) {
            toast.error("加载配置失败: " + err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    // ─ helpers
    const updateProvider = (name: string, field: keyof ProviderConfig, value: string | number) => {
        setModels(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                providers: {
                    ...prev.providers,
                    [name]: { ...prev.providers[name], [field]: value },
                },
            };
        });
    };

    const testConnection = async (providerName: string) => {
        setTestStatus(prev => ({ ...prev, [providerName]: "testing" }));
        try {
            const res = await fetchApi<{ success: boolean; response?: string; error?: string }>(
                "/api/config/models/test",
                { method: "POST", body: JSON.stringify({ providerName }) }
            );
            if (res.success) {
                setTestStatus(prev => ({ ...prev, [providerName]: "ok" }));
                toast.success(`${providerName} 连接正常`, { description: `响应: ${res.response}` });
            } else {
                setTestStatus(prev => ({ ...prev, [providerName]: "error" }));
                toast.error(`${providerName} 连接失败`, { description: res.error });
            }
        } catch (err: any) {
            setTestStatus(prev => ({ ...prev, [providerName]: "error" }));
            toast.error(`${providerName} 连接失败`, { description: err.message });
        }
    };

    // ─ save handlers
    const saveModels = async () => {
        if (!models) return;
        setSavingModels(true);
        try {
            await fetchApi("/api/config/models", { method: "PATCH", body: JSON.stringify(models) });
            toast.success("AI 模型配置已保存，热重载生效");
        } catch (err: any) {
            toast.error("保存失败: " + err.message);
        } finally {
            setSavingModels(false);
        }
    };

    const saveSecurity = async () => {
        if (!security) return;
        setSavingSecurity(true);
        try {
            await fetchApi("/api/config/security", { method: "PATCH", body: JSON.stringify(security) });
            toast.success("安全配置已保存");
        } catch (err: any) {
            toast.error("保存失败: " + err.message);
        } finally {
            setSavingSecurity(false);
        }
    };

    const saveAgent = async () => {
        if (!agent) return;
        setSavingAgent(true);
        try {
            await fetchApi("/api/config/agent", { method: "PATCH", body: JSON.stringify(agent) });
            toast.success("Agent 参数已保存");
        } catch (err: any) {
            toast.error("保存失败: " + err.message);
        } finally {
            setSavingAgent(false);
        }
    };

    // ─ render
    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const providerNames = Object.keys(models?.providers ?? {});

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-4xl mx-auto space-y-8 p-6 pb-20">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">系统设置</h1>
                        <p className="text-muted-foreground text-sm mt-1">配置 AI 模型、Agent 参数和安全选项</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={loadAll}>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        重置
                    </Button>
                </div>

                {/* ── Card 1: AI 模型 ── */}
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Cpu className="w-5 h-5 text-primary" />
                                <div>
                                    <CardTitle>AI 模型配置</CardTitle>
                                    <CardDescription>LLM 提供商连接参数，修改后立即热重载</CardDescription>
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Default provider */}
                        <div className="space-y-2">
                            <Label>默认提供商</Label>
                            <select
                                className="w-full h-10 px-3 rounded-md border bg-background text-sm"
                                value={models?.default ?? ""}
                                onChange={(e) => setModels(prev => prev ? { ...prev, default: e.target.value } : prev)}
                            >
                                {providerNames.map(name => (
                                    <option key={name} value={name}>
                                        {name === "openai" ? "OpenAI (兼容接口)" : name === "anthropic" ? "Anthropic (Claude)" : name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <Separator />

                        {/* Per-provider settings */}
                        {providerNames.map((providerName, idx) => {
                            const p = models!.providers[providerName];
                            const status = testStatus[providerName] ?? "idle";
                            const keyVisible = showKeys[providerName] ?? false;
                            return (
                                <div key={providerName} className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Bot className="w-4 h-4 text-muted-foreground" />
                                            <span className="font-medium">{providerName}</span>
                                            {models?.default === providerName && (
                                                <Badge variant="default" className="text-[10px] px-1.5 py-0">Active</Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <StatusIcon status={status} />
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => testConnection(providerName)}
                                                disabled={status === "testing"}
                                            >
                                                测试连接
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs text-muted-foreground">模型名称</Label>
                                            <Input
                                                value={p?.model ?? ""}
                                                onChange={(e) => updateProvider(providerName, "model", e.target.value)}
                                                placeholder="gpt-4o"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs text-muted-foreground">Embedding 模型</Label>
                                            <Input
                                                value={p?.embeddingModel ?? ""}
                                                onChange={(e) => updateProvider(providerName, "embeddingModel", e.target.value)}
                                                placeholder="text-embedding-3-small"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs text-muted-foreground">Base URL</Label>
                                            <Input
                                                value={p?.baseUrl ?? ""}
                                                onChange={(e) => updateProvider(providerName, "baseUrl", e.target.value)}
                                                placeholder="https://api.openai.com/v1"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-xs text-muted-foreground">Max Tokens</Label>
                                            <Input
                                                type="number"
                                                value={p?.maxTokens ?? 4096}
                                                onChange={(e) => updateProvider(providerName, "maxTokens", Number(e.target.value))}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label className="text-xs text-muted-foreground">API 密钥</Label>
                                        <div className="relative">
                                            <Input
                                                type={keyVisible ? "text" : "password"}
                                                value={p?.apiKey ?? ""}
                                                onChange={(e) => updateProvider(providerName, "apiKey", e.target.value)}
                                                className="pr-10"
                                                placeholder="sk-..."
                                            />
                                            <button
                                                type="button"
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                                onClick={() => setShowKeys(prev => ({ ...prev, [providerName]: !keyVisible }))}
                                            >
                                                {keyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>

                                    {idx < providerNames.length - 1 && <Separator />}
                                </div>
                            );
                        })}

                        <div className="flex justify-end pt-2">
                            <Button onClick={saveModels} disabled={savingModels} size="sm">
                                {savingModels ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                                保存模型配置
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* ── Card 2: Agent 参数 ── */}
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <RotateCw className="w-5 h-5 text-primary" />
                            <div>
                                <CardTitle>Agent 执行参数</CardTitle>
                                <CardDescription>控制 ReAct Agent 的推理轮次和上下文窗口</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-1.5">
                                <Label>最大推理轮次</Label>
                                <p className="text-xs text-muted-foreground">Agent 单次任务最多执行几轮 ReAct 循环</p>
                                <Input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={agent?.maxIterations ?? 10}
                                    onChange={(e) => setAgent(prev => prev ? { ...prev, maxIterations: Number(e.target.value) } : prev)}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>上下文窗口限制 (tokens)</Label>
                                <p className="text-xs text-muted-foreground">超出时自动压缩摘要，防止超出模型限制</p>
                                <Input
                                    type="number"
                                    min={4096}
                                    step={4096}
                                    value={agent?.maxContextTokens ?? 120000}
                                    onChange={(e) => setAgent(prev => prev ? { ...prev, maxContextTokens: Number(e.target.value) } : prev)}
                                />
                            </div>
                        </div>
                        <div className="flex justify-end pt-2">
                            <Button onClick={saveAgent} disabled={savingAgent} size="sm">
                                {savingAgent ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                                保存 Agent 配置
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* ── Card 3: 安全配置 ── */}
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-primary" />
                            <div>
                                <CardTitle>安全与访问控制</CardTitle>
                                <CardDescription>Shell 沙箱防护和 API 认证设置</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        {/* Sandbox */}
                        <div className="space-y-3">
                            <p className="text-sm font-medium">Shell 沙箱</p>
                            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                                <div className="space-y-0.5">
                                    <Label>启用沙箱防护</Label>
                                    <p className="text-xs text-muted-foreground">拦截 rm -rf、fork bomb 等危险命令</p>
                                </div>
                                <Switch
                                    checked={security?.sandbox.enabled ?? true}
                                    onCheckedChange={(v) =>
                                        setSecurity(prev => prev ? { ...prev, sandbox: { ...prev.sandbox, enabled: v } } : prev)
                                    }
                                />
                            </div>
                            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                                <div className="space-y-0.5">
                                    <Label>拦截模式</Label>
                                    <p className="text-xs text-muted-foreground">
                                        blocklist = 黑名单拦截；allowlist = 白名单放行
                                    </p>
                                </div>
                                <select
                                    className="h-9 px-3 rounded-md border bg-background text-sm"
                                    value={security?.sandbox.mode ?? "blocklist"}
                                    onChange={(e) =>
                                        setSecurity(prev =>
                                            prev
                                                ? { ...prev, sandbox: { ...prev.sandbox, mode: e.target.value as "blocklist" | "allowlist" } }
                                                : prev
                                        )
                                    }
                                >
                                    <option value="blocklist">Blocklist（黑名单）</option>
                                    <option value="allowlist">Allowlist（白名单）</option>
                                </select>
                            </div>
                        </div>

                        <Separator />

                        {/* Auth */}
                        <div className="space-y-3">
                            <p className="text-sm font-medium">API 认证</p>
                            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                                <div className="space-y-0.5">
                                    <Label>启用认证</Label>
                                    <p className="text-xs text-muted-foreground">开启后所有 API 请求须携带凭证</p>
                                </div>
                                <Switch
                                    checked={security?.auth.enabled ?? false}
                                    onCheckedChange={(v) =>
                                        setSecurity(prev => prev ? { ...prev, auth: { ...prev.auth, enabled: v } } : prev)
                                    }
                                />
                            </div>
                            {security?.auth.enabled && (
                                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                                    <div className="space-y-0.5">
                                        <Label>认证模式</Label>
                                        <p className="text-xs text-muted-foreground">
                                            api-key = X-API-Key Header；jwt = Bearer Token
                                        </p>
                                    </div>
                                    <select
                                        className="h-9 px-3 rounded-md border bg-background text-sm"
                                        value={security?.auth.mode ?? "api-key"}
                                        onChange={(e) =>
                                            setSecurity(prev =>
                                                prev
                                                    ? { ...prev, auth: { ...prev.auth, mode: e.target.value as "api-key" | "jwt" } }
                                                    : prev
                                            )
                                        }
                                    >
                                        <option value="api-key">API Key</option>
                                        <option value="jwt">JWT</option>
                                    </select>
                                </div>
                            )}
                            {security?.auth.enabled && security.auth.mode === "api-key" && (
                                <div className="rounded-lg border px-4 py-3 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <KeyRound className="w-4 h-4 text-muted-foreground" />
                                        <Label className="text-sm">API Keys</Label>
                                    </div>
                                    <div className="space-y-2">
                                        {(security.auth.apiKeys ?? []).map((key, i) => (
                                            <div key={i} className="flex gap-2">
                                                <Input
                                                    value={key}
                                                    onChange={(e) => {
                                                        const keys = [...(security.auth.apiKeys ?? [])];
                                                        keys[i] = e.target.value;
                                                        setSecurity(prev =>
                                                            prev ? { ...prev, auth: { ...prev.auth, apiKeys: keys } } : prev
                                                        );
                                                    }}
                                                    className="font-mono text-xs"
                                                />
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="text-destructive hover:text-destructive"
                                                    onClick={() => {
                                                        const keys = (security.auth.apiKeys ?? []).filter((_, j) => j !== i);
                                                        setSecurity(prev =>
                                                            prev ? { ...prev, auth: { ...prev.auth, apiKeys: keys } } : prev
                                                        );
                                                    }}
                                                >
                                                    <XCircle className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        ))}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                                const keys = [...(security?.auth.apiKeys ?? []), ""];
                                                setSecurity(prev =>
                                                    prev ? { ...prev, auth: { ...prev.auth, apiKeys: keys } } : prev
                                                );
                                            }}
                                        >
                                            + 添加 API Key
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end pt-2">
                            <Button onClick={saveSecurity} disabled={savingSecurity} size="sm">
                                {savingSecurity ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                                保存安全配置
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* ── Card 4: 关于 ── */}
                <Card>
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                            <Database className="w-5 h-5 text-primary" />
                            <div>
                                <CardTitle>系统信息</CardTitle>
                                <CardDescription>运行时版本与当前配置摘要</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                            <div>
                                <dt className="text-muted-foreground">默认提供商</dt>
                                <dd className="font-medium mt-0.5">{models?.default ?? "—"}</dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">当前模型</dt>
                                <dd className="font-medium mt-0.5">
                                    {models?.providers[models.default]?.model ?? "—"}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">最大推理轮次</dt>
                                <dd className="font-medium mt-0.5">{agent?.maxIterations ?? "—"}</dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">上下文窗口</dt>
                                <dd className="font-medium mt-0.5">
                                    {agent ? `${(agent.maxContextTokens / 1000).toFixed(0)}k tokens` : "—"}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">Shell 沙箱</dt>
                                <dd className="font-medium mt-0.5">
                                    {security
                                        ? security.sandbox.enabled
                                            ? <span className="text-green-600">已启用（{security.sandbox.mode}）</span>
                                            : <span className="text-amber-600">已禁用</span>
                                        : "—"}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">API 认证</dt>
                                <dd className="font-medium mt-0.5">
                                    {security
                                        ? security.auth.enabled
                                            ? <span className="text-green-600">已启用（{security.auth.mode}）</span>
                                            : <span className="text-muted-foreground">未启用</span>
                                        : "—"}
                                </dd>
                            </div>
                        </dl>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
