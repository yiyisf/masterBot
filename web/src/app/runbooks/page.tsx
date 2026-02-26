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
    BookOpen,
    Play,
    Loader2,
    Upload,
    CheckCircle2,
    XCircle,
    Terminal,
    AlertTriangle,
    Clock,
} from "lucide-react";
import { fetchApi } from "@/lib/api";

interface RunbookInfo {
    name: string;
    filename: string;
    description?: string;
}

interface ExecutionResult {
    runbookName: string;
    sessionId: string;
    steps: Array<{
        index: number;
        tool?: string;
        result?: unknown;
        error?: string;
        skipped?: boolean;
    }>;
    success: boolean;
    duration: number;
}

export default function RunbooksPage() {
    const [runbooks, setRunbooks] = useState<RunbookInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [executing, setExecuting] = useState<string | null>(null);
    const [execResult, setExecResult] = useState<ExecutionResult | null>(null);
    const [showResult, setShowResult] = useState(false);
    const [showTrigger, setShowTrigger] = useState<RunbookInfo | null>(null);
    const [triggerVars, setTriggerVars] = useState("{\n  \"service_name\": \"my-service\",\n  \"service_namespace\": \"production\"\n}");
    const [showUpload, setShowUpload] = useState(false);
    const [uploadContent, setUploadContent] = useState("");
    const [uploadFilename, setUploadFilename] = useState("");

    const load = async () => {
        try {
            const data = await fetchApi<RunbookInfo[]>("/api/runbooks");
            setRunbooks(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleExecute = async (runbook: RunbookInfo) => {
        let variables: Record<string, unknown> = {};
        try {
            variables = JSON.parse(triggerVars);
        } catch {
            alert("变量 JSON 格式不正确");
            return;
        }

        setExecuting(runbook.filename);
        try {
            const result = await fetchApi<ExecutionResult>(`/api/runbooks/${runbook.filename}/execute`, {
                method: "POST",
                body: JSON.stringify({ variables }),
            });
            setExecResult(result);
            setShowTrigger(null);
            setShowResult(true);
        } catch (e: any) {
            alert(`执行失败: ${e.message}`);
        } finally {
            setExecuting(null);
        }
    };

    const handleUpload = async () => {
        if (!uploadFilename.trim() || !uploadContent.trim()) return;
        try {
            await fetchApi("/api/runbooks", {
                method: "POST",
                body: JSON.stringify({ filename: uploadFilename, content: uploadContent }),
            });
            setShowUpload(false);
            setUploadContent("");
            setUploadFilename("");
            await load();
        } catch (e: any) {
            alert(`上传失败: ${e.message}`);
        }
    };

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
                        <BookOpen className="h-6 w-6" />
                        Runbook 管理
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        YAML 声明式运维操作手册，由 AI Agent 自动执行
                    </p>
                </div>
                <Button onClick={() => setShowUpload(true)}>
                    <Upload className="h-4 w-4 mr-2" />
                    上传 Runbook
                </Button>
            </div>

            {/* Info card */}
            <Card className="mb-6 border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
                <CardContent className="py-4">
                    <div className="flex gap-3">
                        <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                        <div className="text-sm text-blue-800 dark:text-blue-300">
                            <p className="font-medium mb-1">Runbook 由 Webhook 触发或手动执行</p>
                            <p>在<a href="/webhooks" className="underline mx-1">Webhook 管理</a>中配置触发器，外部监控系统告警时自动执行对应 Runbook。</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {runbooks.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                        <BookOpen className="h-12 w-12 mb-4 opacity-30" />
                        <p className="text-lg font-medium">暂无 Runbook</p>
                        <p className="text-sm mt-1">点击"上传 Runbook"添加 YAML 操作手册</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">
                    {runbooks.map((rb) => (
                        <Card key={rb.filename}>
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <CardTitle className="text-base">{rb.name}</CardTitle>
                                        {rb.description && (
                                            <p className="text-sm text-muted-foreground mt-1">{rb.description}</p>
                                        )}
                                        <code className="text-xs text-muted-foreground mt-1 block">{rb.filename}</code>
                                    </div>
                                    <Button
                                        size="sm"
                                        onClick={() => setShowTrigger(rb)}
                                        disabled={executing === rb.filename}
                                    >
                                        {executing === rb.filename ? (
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        ) : (
                                            <Play className="h-4 w-4 mr-2" />
                                        )}
                                        手动触发
                                    </Button>
                                </div>
                            </CardHeader>
                        </Card>
                    ))}
                </div>
            )}

            {/* Trigger Dialog */}
            <Dialog open={!!showTrigger} onOpenChange={() => setShowTrigger(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>触发 Runbook: {showTrigger?.name}</DialogTitle>
                        <DialogDescription>
                            填写 Runbook 中使用的上下文变量（JSON 格式）
                        </DialogDescription>
                    </DialogHeader>
                    <div>
                        <Label>上下文变量（JSON）</Label>
                        <Textarea
                            className="mt-2 font-mono text-sm"
                            value={triggerVars}
                            onChange={(e) => setTriggerVars(e.target.value)}
                            rows={8}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowTrigger(null)}>取消</Button>
                        <Button
                            onClick={() => showTrigger && handleExecute(showTrigger)}
                            disabled={!!executing}
                        >
                            {executing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                            执行
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Result Dialog */}
            <Dialog open={showResult} onOpenChange={setShowResult}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {execResult?.success ? (
                                <CheckCircle2 className="h-5 w-5 text-green-500" />
                            ) : (
                                <XCircle className="h-5 w-5 text-red-500" />
                            )}
                            {execResult?.runbookName} — 执行结果
                        </DialogTitle>
                        <DialogDescription className="flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            耗时 {execResult?.duration}ms | 会话 {execResult?.sessionId}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        {execResult?.steps.map((step, i) => (
                            <div key={i} className={`rounded border p-3 text-sm ${step.error ? 'border-red-200 bg-red-50 dark:bg-red-950/20' : step.skipped ? 'border-gray-200 bg-gray-50 dark:bg-gray-900' : 'border-green-200 bg-green-50 dark:bg-green-950/20'}`}>
                                <div className="flex items-center gap-2 mb-1">
                                    {step.error ? (
                                        <XCircle className="h-4 w-4 text-red-500" />
                                    ) : step.skipped ? (
                                        <span className="text-gray-400 text-xs">跳过</span>
                                    ) : (
                                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                                    )}
                                    <span className="font-medium">步骤 {step.index + 1}</span>
                                    {step.tool && <Badge variant="outline" className="text-xs">{step.tool}</Badge>}
                                </div>
                                {step.error && <p className="text-red-600 text-xs">{step.error}</p>}
                                {step.result != null && (
                                    <pre className="text-xs bg-black/5 rounded p-2 overflow-x-auto mt-1">
                                        {typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2)}
                                    </pre>
                                )}
                            </div>
                        ))}
                    </div>
                    <DialogFooter>
                        <Button onClick={() => setShowResult(false)}>关闭</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Upload Dialog */}
            <Dialog open={showUpload} onOpenChange={setShowUpload}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>上传 Runbook</DialogTitle>
                        <DialogDescription>
                            粘贴 YAML 格式的 Runbook 内容
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>文件名（.yaml）</Label>
                            <Input
                                className="mt-1"
                                placeholder="my-runbook.yaml"
                                value={uploadFilename}
                                onChange={(e) => setUploadFilename(e.target.value)}
                            />
                        </div>
                        <div>
                            <Label>Runbook 内容（YAML）</Label>
                            <Textarea
                                className="mt-1 font-mono text-sm"
                                placeholder="name: my-runbook&#10;description: ...&#10;steps:&#10;  - tool: shell.execute&#10;    command: echo hello"
                                value={uploadContent}
                                onChange={(e) => setUploadContent(e.target.value)}
                                rows={12}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowUpload(false)}>取消</Button>
                        <Button onClick={handleUpload} disabled={!uploadFilename.trim() || !uploadContent.trim()}>
                            上传
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
