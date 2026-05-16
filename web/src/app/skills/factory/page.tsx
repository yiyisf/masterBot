"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, AlertCircle, Loader2, ChevronRight, ArrowLeft, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { fetchApi } from "@/lib/api";

type StepState = "idle" | "loading" | "success" | "error";

interface ValidationCard {
    label: string;
    state: StepState;
    detail?: string;
    score?: number;
}

interface SkillSpec {
    name: string;
    description: string;
    category: string;
    inputs: Record<string, { type: string; description: string; required?: boolean }>;
    outputs: Record<string, { type: string; description: string }>;
    requiredScopes: string[];
    testCases: Array<{ name: string; input: Record<string, unknown>; expectedOutput: string }>;
    similarSkills?: string[];
}

interface GeneratedFiles {
    skillMd: string;
    indexTs: string;
    testTs: string;
}

interface Job {
    id: string;
    skillName: string;
    state: string;
    spec?: SkillSpec;
    generatedFiles?: GeneratedFiles;
    validationResult?: { passed: boolean; warnings: string[]; errors: string[] };
    securityResult?: { passed: boolean; findings: Array<{ severity: string; rule: string; message: string }> };
    sandboxResult?: { passed: boolean; successRate: number; mock?: boolean };
    judgeResult?: { score: number; needsHumanReview: boolean; feedback: string };
    error?: string;
}

const STEPS = ["描述需求", "确认 Spec", "代码生成", "验证测试", "发布"];

export default function SkillFactoryPage() {
    const router = useRouter();
    const [currentStep, setCurrentStep] = useState(0);
    const [intent, setIntent] = useState("");
    const [job, setJob] = useState<Job | null>(null);
    const [editedSpec, setEditedSpec] = useState<Partial<SkillSpec>>({});
    const [activeFileTab, setActiveFileTab] = useState<"skillMd" | "indexTs" | "testTs">("skillMd");
    const [validations, setValidations] = useState<ValidationCard[]>([]);
    const [stepState, setStepState] = useState<StepState>("idle");
    const [stepError, setStepError] = useState<string>("");
    const [publishPath, setPublishPath] = useState<string>("");

    const runPipeline = useCallback(async (stages: string[], currentJob: Job) => {
        setStepState("loading");
        setStepError("");
        try {
            const result: any = await fetchApi(`/api/admin/skill-factory/jobs/${currentJob.id}/run`, {
                method: "POST",
                body: JSON.stringify({ stages }),
            });
            if (result.error) throw new Error(result.error);

            const updated: Job = await fetchApi(`/api/admin/skill-factory/jobs/${currentJob.id}`);
            setJob(updated);
            setStepState("success");
            return updated;
        } catch (err: any) {
            setStepState("error");
            setStepError(err.message ?? "Pipeline failed");
            throw err;
        }
    }, []);

    const handleStep0Submit = async () => {
        if (!intent.trim()) { toast.error("请输入技能描述"); return; }
        setStepState("loading");
        setStepError("");
        try {
            const newJob: Job = await fetchApi("/api/admin/skill-factory/jobs", {
                method: "POST",
                body: JSON.stringify({ intent }),
            });
            const updated = await runPipeline(["1"], newJob);
            setEditedSpec(updated.spec ?? {});
            setCurrentStep(1);
        } catch (err: any) {
            setStepState("error");
            setStepError(err.message ?? "创建失败");
        }
    };

    const handleStep1Confirm = async () => {
        if (!job) return;
        setCurrentStep(2);
        setStepState("loading");
        try {
            await runPipeline(["2"], job);
            setCurrentStep(2);
            setStepState("success");
        } catch {
            setCurrentStep(1);
        }
    };

    const handleStep2Done = () => {
        setCurrentStep(3);
        handleRunValidation();
    };

    const handleRunValidation = async () => {
        if (!job) return;
        setStepState("loading");
        setValidations([
            { label: "静态检查", state: "loading" },
            { label: "安全扫描", state: "loading" },
            { label: "沙箱测试", state: "loading" },
            { label: "LLM Judge", state: "loading" },
        ]);
        try {
            const updated = await runPipeline(["3", "4"], job);
            const v = updated.validationResult;
            const s = updated.securityResult;
            const sb = updated.sandboxResult;
            const j = updated.judgeResult;

            setValidations([
                {
                    label: "静态检查",
                    state: v?.passed ? "success" : "error",
                    detail: v ? (v.passed ? `通过 (${v.warnings.length} 警告)` : v.errors.join("; ")) : "—",
                },
                {
                    label: "安全扫描",
                    state: s?.passed ? "success" : "error",
                    detail: s ? (s.passed ? `通过 (${s.findings.length} 发现)` : `${s.findings.filter(f => f.severity === 'critical' || f.severity === 'high').length} 高危问题`) : "—",
                },
                {
                    label: "沙箱测试",
                    state: sb?.passed ? "success" : "error",
                    detail: sb ? `成功率 ${((sb.successRate ?? 0) * 100).toFixed(0)}%${sb.mock ? " (mock)" : ""}` : "—",
                },
                {
                    label: "LLM Judge",
                    state: j ? (j.score >= 7 ? "success" : "error") : "idle",
                    score: j?.score,
                    detail: j ? `${j.score.toFixed(1)}/10${j.needsHumanReview ? " — 建议人工评审" : ""}` : "—",
                },
            ]);
            setStepState("success");
        } catch (err: any) {
            setValidations(prev => prev.map(v => ({ ...v, state: "error" as StepState })));
            setStepState("error");
            setStepError(err.message ?? "验证失败");
        }
    };

    const handleInstallDraft = async () => {
        if (!job) return;
        setStepState("loading");
        try {
            const result: any = await fetchApi(`/api/admin/skill-factory/jobs/${job.id}/install`, { method: "POST", body: "{}" });
            if (result.error) throw new Error(result.error);
            setPublishPath(result.path);
            toast.success(`技能已安装为草稿: ${result.path}`);
            setCurrentStep(4);
            setStepState("success");
        } catch (err: any) {
            toast.error(err.message ?? "安装失败");
            setStepState("error");
        }
    };

    const handleSubmitReview = async () => {
        if (!job) return;
        setStepState("loading");
        try {
            const result: any = await fetchApi(`/api/admin/skill-factory/jobs/${job.id}/submit`, { method: "POST", body: "{}" });
            if (result.error) throw new Error(result.error);
            toast.success(`已提交企业评审，reviewId: ${result.reviewId}`);
            setCurrentStep(4);
            setStepState("success");
        } catch (err: any) {
            toast.error(err.message ?? "提交失败");
            setStepState("error");
        }
    };

    const ValidationIcon = ({ state }: { state: StepState }) => {
        if (state === "loading") return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
        if (state === "success") return <CheckCircle2 className="h-5 w-5 text-green-500" />;
        if (state === "error") return <XCircle className="h-5 w-5 text-red-500" />;
        return <AlertCircle className="h-5 w-5 text-gray-400" />;
    };

    return (
        <div className="container mx-auto max-w-4xl py-8 px-4">
            <div className="flex items-center gap-3 mb-8">
                <Button variant="ghost" size="sm" onClick={() => router.push("/skills")}>
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    返回技能列表
                </Button>
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Wand2 className="h-6 w-6 text-purple-500" />
                        Skill Factory 2.0
                    </h1>
                    <p className="text-sm text-muted-foreground">5 步向导创建企业级 AI 技能</p>
                </div>
            </div>

            {/* Step Progress */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-2">
                    {STEPS.map((step, i) => (
                        <div key={step} className="flex items-center">
                            <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                                i < currentStep ? "bg-green-500 text-white" :
                                i === currentStep ? "bg-purple-600 text-white" :
                                "bg-gray-200 text-gray-500"
                            }`}>
                                {i < currentStep ? "✓" : i + 1}
                            </div>
                            {i < STEPS.length - 1 && (
                                <div className={`h-0.5 w-16 mx-1 ${i < currentStep ? "bg-green-500" : "bg-gray-200"}`} />
                            )}
                        </div>
                    ))}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                    {STEPS.map(s => <span key={s} className="w-20 text-center">{s}</span>)}
                </div>
                <Progress value={(currentStep / (STEPS.length - 1)) * 100} className="mt-3 h-1.5" />
            </div>

            {/* Step 0: Intent Input */}
            {currentStep === 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>描述你想要的技能</CardTitle>
                        <CardDescription>用自然语言描述技能的功能，Skill Factory 将自动理解并生成完整技能</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Label htmlFor="intent">技能描述</Label>
                            <Textarea
                                id="intent"
                                placeholder="例如：创建一个能查询 GitHub 仓库 PR 列表并按优先级排序的技能，支持按标签过滤"
                                value={intent}
                                onChange={e => setIntent(e.target.value)}
                                rows={4}
                                className="mt-1"
                            />
                        </div>
                        {stepState === "error" && (
                            <p className="text-sm text-red-500">{stepError}</p>
                        )}
                        <Button onClick={handleStep0Submit} disabled={stepState === "loading"} className="w-full">
                            {stepState === "loading" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ChevronRight className="h-4 w-4 mr-2" />}
                            分析需求并生成 Spec
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Step 1: Confirm Spec */}
            {currentStep === 1 && job?.spec && (
                <Card>
                    <CardHeader>
                        <CardTitle>确认技能 Spec</CardTitle>
                        <CardDescription>检查 AI 生成的 Spec 是否符合你的期望</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>技能名称</Label>
                                <Input value={editedSpec.name ?? job.spec.name} onChange={e => setEditedSpec(p => ({ ...p, name: e.target.value }))} className="mt-1" />
                            </div>
                            <div>
                                <Label>类别</Label>
                                <Input value={editedSpec.category ?? job.spec.category} onChange={e => setEditedSpec(p => ({ ...p, category: e.target.value }))} className="mt-1" />
                            </div>
                        </div>
                        <div>
                            <Label>描述</Label>
                            <Textarea value={editedSpec.description ?? job.spec.description} onChange={e => setEditedSpec(p => ({ ...p, description: e.target.value }))} rows={2} className="mt-1" />
                        </div>
                        <div>
                            <Label>输入参数</Label>
                            <pre className="mt-1 p-3 bg-muted rounded text-xs overflow-auto max-h-32">
                                {JSON.stringify(job.spec.inputs, null, 2)}
                            </pre>
                        </div>
                        <div>
                            <Label>测试用例 ({job.spec.testCases.length} 个)</Label>
                            <div className="mt-1 space-y-1">
                                {job.spec.testCases.map((tc, i) => (
                                    <div key={i} className="flex items-center gap-2 text-sm">
                                        <Badge variant="outline">{tc.name}</Badge>
                                        <span className="text-muted-foreground">期望包含: "{tc.expectedOutput}"</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {job.spec.similarSkills && job.spec.similarSkills.length > 0 && (
                            <div className="p-3 bg-yellow-50 dark:bg-yellow-950 rounded border border-yellow-200 dark:border-yellow-800">
                                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">发现相似技能：</p>
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {job.spec.similarSkills.map(s => <Badge key={s} variant="secondary">{s}</Badge>)}
                                </div>
                            </div>
                        )}
                        {stepState === "error" && <p className="text-sm text-red-500">{stepError}</p>}
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => { setCurrentStep(0); setStepState("idle"); }}>
                                重新描述
                            </Button>
                            <Button onClick={handleStep1Confirm} disabled={stepState === "loading"} className="flex-1">
                                {stepState === "loading" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                                确认并生成代码
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Step 2: Code Generation */}
            {currentStep === 2 && (
                <Card>
                    <CardHeader>
                        <CardTitle>代码生成</CardTitle>
                        <CardDescription>AI 正在为你的技能生成完整代码</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {stepState === "loading" && (
                            <div className="flex items-center gap-3 py-8 justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
                                <span className="text-muted-foreground">正在生成 SKILL.md + index.ts + unit.test.ts...</span>
                            </div>
                        )}
                        {stepState === "success" && job?.generatedFiles && (
                            <>
                                <div className="flex gap-2">
                                    {(["skillMd", "indexTs", "testTs"] as const).map(tab => (
                                        <Button key={tab} variant={activeFileTab === tab ? "default" : "outline"} size="sm" onClick={() => setActiveFileTab(tab)}>
                                            {tab === "skillMd" ? "SKILL.md" : tab === "indexTs" ? "index.ts" : "unit.test.ts"}
                                        </Button>
                                    ))}
                                </div>
                                <pre className="p-3 bg-muted rounded text-xs overflow-auto max-h-96 whitespace-pre-wrap">
                                    {job.generatedFiles[activeFileTab]}
                                </pre>
                                <Button onClick={handleStep2Done} className="w-full">
                                    进入验证测试
                                    <ChevronRight className="h-4 w-4 ml-2" />
                                </Button>
                            </>
                        )}
                        {stepState === "error" && (
                            <div className="space-y-2">
                                <p className="text-sm text-red-500">{stepError}</p>
                                <Button variant="outline" onClick={() => runPipeline(["2"], job!)}>
                                    重试生成
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Step 3: Validation */}
            {currentStep === 3 && (
                <Card>
                    <CardHeader>
                        <CardTitle>验证测试</CardTitle>
                        <CardDescription>4 层质量门控检查</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {validations.map(v => (
                            <div key={v.label} className="flex items-center gap-3 p-3 border rounded-lg">
                                <ValidationIcon state={v.state} />
                                <div className="flex-1">
                                    <div className="font-medium text-sm">{v.label}</div>
                                    {v.detail && <div className="text-xs text-muted-foreground">{v.detail}</div>}
                                </div>
                                {v.score !== undefined && (
                                    <Badge variant={v.score >= 7 ? "default" : "destructive"}>
                                        {v.score.toFixed(1)}/10
                                    </Badge>
                                )}
                            </div>
                        ))}
                        {stepState === "error" && (
                            <div className="space-y-2">
                                <p className="text-sm text-red-500">{stepError}</p>
                                <Button variant="outline" onClick={handleRunValidation}>重新验证</Button>
                            </div>
                        )}
                        {stepState === "success" && (
                            <div className="flex gap-2 pt-2">
                                <Button variant="outline" onClick={handleInstallDraft} className="flex-1">
                                    安装为个人草稿
                                </Button>
                                <Button onClick={handleSubmitReview} className="flex-1">
                                    提交企业评审
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Step 4: Done */}
            {currentStep === 4 && (
                <Card>
                    <CardHeader>
                        <CardTitle>发布完成</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-3 text-green-600">
                            <CheckCircle2 className="h-8 w-8" />
                            <div>
                                <p className="font-medium">技能 "{job?.spec?.name}" 已成功处理</p>
                                {publishPath && <p className="text-sm text-muted-foreground">安装路径: {publishPath}</p>}
                                {job?.state === "pending-review" && <p className="text-sm text-muted-foreground">已提交企业评审，等待审批</p>}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => router.push("/skills")} className="flex-1">
                                返回技能列表
                            </Button>
                            <Button onClick={() => {
                                setCurrentStep(0);
                                setJob(null);
                                setIntent("");
                                setStepState("idle");
                                setValidations([]);
                                setPublishPath("");
                            }} className="flex-1">
                                创建另一个技能
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
