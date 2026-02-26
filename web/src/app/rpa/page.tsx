"use client";

import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
    Monitor,
    Play,
    Camera,
    MousePointer,
    Keyboard,
    Upload,
    Table,
    Loader2,
    AlertTriangle,
    Globe,
    ExternalLink,
    CheckCircle2,
} from "lucide-react";
import { fetchApi } from "@/lib/api";

interface RpaAction {
    type: "screenshot" | "navigate" | "click" | "type" | "upload_file" | "extract_table";
    params: Record<string, unknown>;
}

interface RpaResult {
    action: string;
    result: Record<string, unknown>;
    timestamp: string;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
    screenshot: <Camera className="h-4 w-4" />,
    navigate: <Globe className="h-4 w-4" />,
    click: <MousePointer className="h-4 w-4" />,
    type: <Keyboard className="h-4 w-4" />,
    upload_file: <Upload className="h-4 w-4" />,
    extract_table: <Table className="h-4 w-4" />,
};

export default function RpaPage() {
    const [targetUrl, setTargetUrl] = useState("");
    const [prompt, setPrompt] = useState("");
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<RpaResult[]>([]);
    const [lastScreenshot, setLastScreenshot] = useState<string | null>(null);
    const [confirmStep, setConfirmStep] = useState<RpaAction | null>(null);

    const executeAction = async (action: RpaAction) => {
        setLoading(true);
        try {
            const result = await fetchApi<Record<string, unknown>>(`/api/rpa/execute`, {
                method: "POST",
                body: JSON.stringify(action),
            });

            const rpaResult: RpaResult = {
                action: action.type,
                result,
                timestamp: new Date().toLocaleTimeString("zh-CN"),
            };

            setResults(prev => [rpaResult, ...prev]);

            // Show screenshot if available
            if (result.screenshot) {
                setLastScreenshot(result.screenshot as string);
            }
        } catch (e: any) {
            setResults(prev => [{
                action: action.type,
                result: { error: e.message },
                timestamp: new Date().toLocaleTimeString("zh-CN"),
            }, ...prev]);
        } finally {
            setLoading(false);
        }
    };

    const handleNavigate = async () => {
        if (!targetUrl) return;
        await executeAction({ type: "navigate", params: { url: targetUrl } });
        await executeAction({ type: "screenshot", params: {} });
    };

    const handleScreenshot = async () => {
        await executeAction({ type: "screenshot", params: { url: targetUrl || undefined } });
    };

    const handlePromptAction = async () => {
        if (!prompt.trim()) return;
        setLoading(true);

        try {
            // Send prompt to AI for RPA execution
            const result = await fetchApi<{ sessionId: string; steps: RpaAction[] }>("/api/rpa/prompt", {
                method: "POST",
                body: JSON.stringify({ prompt, url: targetUrl }),
            });

            setResults(prev => [{
                action: "ai-plan",
                result: { sessionId: result.sessionId, steps: result.steps?.length || 0 },
                timestamp: new Date().toLocaleTimeString("zh-CN"),
            }, ...prev]);
        } catch (e: any) {
            setResults(prev => [{
                action: "ai-plan",
                result: { error: e.message },
                timestamp: new Date().toLocaleTimeString("zh-CN"),
            }, ...prev]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto p-6 max-w-5xl">
            <div className="mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Monitor className="h-6 w-6" />
                    AI-RPA 浏览器自动化
                </h1>
                <p className="text-muted-foreground text-sm mt-1">
                    Vision + Browser Automation，打通无 API 的内部 Web 系统
                </p>
            </div>

            {/* Prerequisites warning */}
            <Card className="mb-6 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
                <CardContent className="py-4">
                    <div className="flex gap-3">
                        <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                        <div className="text-sm text-amber-800 dark:text-amber-300">
                            <p className="font-medium mb-1">前置依赖</p>
                            <p>使用 RPA 功能需要先安装 Playwright：</p>
                            <code className="block mt-1 bg-black/10 rounded px-2 py-1 font-mono text-xs">
                                npm install playwright && npx playwright install msedge chromium
                            </code>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Control Panel */}
                <div className="space-y-4">
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Globe className="h-4 w-4" />
                                目标地址
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex gap-2">
                                <Input
                                    placeholder="https://internal-oa.company.com"
                                    value={targetUrl}
                                    onChange={(e) => setTargetUrl(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleNavigate()}
                                />
                                <Button onClick={handleNavigate} disabled={!targetUrl || loading}>
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Play className="h-4 w-4" />
                                AI 指令执行
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div>
                                <Label className="text-sm text-muted-foreground">用自然语言描述操作目标</Label>
                                <Textarea
                                    className="mt-2"
                                    placeholder="帮我在 OA 系统中找到审批列表，截图展示当前待审批的项目..."
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    rows={4}
                                />
                            </div>
                            <Button className="w-full" onClick={handlePromptAction} disabled={!prompt.trim() || loading}>
                                {loading ? (
                                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />执行中...</>
                                ) : (
                                    <><Play className="h-4 w-4 mr-2" />AI 执行</>
                                )}
                            </Button>
                        </CardContent>
                    </Card>

                    {/* Quick Actions */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">快捷操作</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleScreenshot}
                                    disabled={loading}
                                >
                                    <Camera className="h-4 w-4 mr-2" />
                                    截图
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => executeAction({ type: "extract_table", params: {} })}
                                    disabled={loading}
                                >
                                    <Table className="h-4 w-4 mr-2" />
                                    提取表格
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Preview & Results */}
                <div className="space-y-4">
                    {/* Screenshot Preview */}
                    {lastScreenshot && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Camera className="h-4 w-4" />
                                    实时截图
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <img
                                    src={lastScreenshot}
                                    alt="Browser screenshot"
                                    className="w-full rounded border border-border"
                                />
                            </CardContent>
                        </Card>
                    )}

                    {/* Execution Log */}
                    {results.length > 0 && (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">执行日志</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2 max-h-80 overflow-y-auto">
                                    {results.map((r, i) => (
                                        <div
                                            key={i}
                                            className={`text-sm rounded border p-2 ${r.result.error ? 'border-red-200 bg-red-50 dark:bg-red-950/20' : 'border-green-200 bg-green-50 dark:bg-green-950/20'}`}
                                        >
                                            <div className="flex items-center gap-2 mb-1">
                                                {ACTION_ICONS[r.action] || <Play className="h-4 w-4" />}
                                                <Badge variant="outline" className="text-xs">{r.action}</Badge>
                                                <span className="text-xs text-muted-foreground ml-auto">{r.timestamp}</span>
                                            </div>
                                            {r.result.error ? (
                                                <p className="text-red-600 text-xs">{String(r.result.error)}</p>
                                            ) : (
                                                <div className="text-xs text-muted-foreground">
                                                    {r.result.success !== undefined && (
                                                        <span className="flex items-center gap-1">
                                                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                                                            成功
                                                        </span>
                                                    )}
                                                    {r.result.url != null && <span>URL: {String(r.result.url)}</span>}
                                                    {r.result.title != null && <span> | 标题: {String(r.result.title)}</span>}
                                                    {r.result.rowCount != null && <span>提取 {String(r.result.rowCount)} 行数据</span>}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {!lastScreenshot && results.length === 0 && (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                                <Monitor className="h-12 w-12 mb-4 opacity-30" />
                                <p className="text-sm">输入目标 URL 或 AI 指令开始 RPA</p>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}
