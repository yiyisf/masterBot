"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
    Save,
    RotateCw,
    ShieldCheck,
    Globe,
    Cpu
} from "lucide-react";
import { fetchApi } from "@/lib/api";

export default function SettingsPage() {
    const [config, setConfig] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchApi("/api/config/models")
            .then(setConfig)
            .catch(console.error);
    }, []);

    const handleSave = async () => {
        setLoading(true);
        try {
            await fetchApi("/api/config/models", {
                method: "PATCH",
                body: JSON.stringify(config),
            });
            alert("配置已更新并热加载生效！");
        } catch (error) {
            alert("保存失败: " + error);
        } finally {
            setLoading(false);
        }
    };

    if (!config) return null;

    return (
        <div className="h-full overflow-y-auto">
            <div className="max-w-4xl space-y-8 pb-20">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">系统设置</h1>
                    <p className="text-muted-foreground">配置 AI 模型、安全选项及全局偏好。</p>
                </div>

                <div className="space-y-6">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Cpu className="w-5 h-5 text-primary" />
                                    <div>
                                        <CardTitle>AI 模型配置</CardTitle>
                                        <CardDescription>配置助手使用的默认 LLM 提供商</CardDescription>
                                    </div>
                                </div>
                                <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                                    <RotateCw className="w-4 h-4 mr-2" />
                                    重置
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>默认提供商</Label>
                                    <select
                                        className="w-full h-10 px-3 rounded-md border bg-background"
                                        value={config.default}
                                        onChange={(e) => setConfig({ ...config, default: e.target.value })}
                                    >
                                        <option value="openai">OpenAI (兼容标准)</option>
                                        <option value="anthropic">Anthropic (Claude)</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <Label>模型名称</Label>
                                    <Input
                                        value={config.providers[config.default]?.model || ""}
                                        onChange={(e) => {
                                            const p = config.default;
                                            setConfig({
                                                ...config,
                                                providers: {
                                                    ...config.providers,
                                                    [p]: { ...config.providers[p], model: e.target.value }
                                                }
                                            });
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Base URL</Label>
                                <Input
                                    placeholder="http://ai-gateway.internal/v1"
                                    value={config.providers[config.default]?.baseUrl || ""}
                                    onChange={(e) => {
                                        const p = config.default;
                                        setConfig({
                                            ...config,
                                            providers: {
                                                ...config.providers,
                                                [p]: { ...config.providers[p], baseUrl: e.target.value }
                                            }
                                        });
                                    }}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>API 密钥</Label>
                                <Input
                                    type="password"
                                    value={config.providers[config.default]?.apiKey || ""}
                                    onChange={(e) => {
                                        const p = config.default;
                                        setConfig({
                                            ...config,
                                            providers: {
                                                ...config.providers,
                                                [p]: { ...config.providers[p], apiKey: e.target.value }
                                            }
                                        });
                                    }}
                                />
                            </div>

                            <p className="text-[10px] text-muted-foreground italic">
                                * 更改配置后点击保存，系统将立即应用新设置，无需重启进程。
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-5 h-5 text-primary" />
                                <div>
                                    <CardTitle>安全与访问</CardTitle>
                                    <CardDescription>控制 AI 对本地系统的访问权限</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label>沙箱模式</Label>
                                    <p className="text-sm text-muted-foreground">在受限环境中执行所有 Shell 命令</p>
                                </div>
                                <Switch checked={true} />
                            </div>
                            <Separator />
                            <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <Label>文件读写</Label>
                                    <p className="text-sm text-muted-foreground">允许 AI 助手读取和修改本地文件</p>
                                </div>
                                <Switch checked={true} />
                            </div>
                        </CardContent>
                    </Card>

                    <div className="flex justify-end pt-4">
                        <Button onClick={handleSave} disabled={loading} className="w-32">
                            {loading && <RotateCw className="w-4 h-4 mr-2 animate-spin" />}
                            {!loading && <Save className="w-4 h-4 mr-2" />}
                            保存配置
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
