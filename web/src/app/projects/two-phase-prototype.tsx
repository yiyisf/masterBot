"use client";

// PROTOTYPE — 研发流程两阶段详情面板 UI 原型（wayfinder 地图 #74 / ticket #82）。
// 三个结构不同的变体挂在 /projects?variant=A|B|C 上，mock 数据、不接真实 mutation。
// 评审选定后按 /prototype skill 流程：赢家重写进正式页面，其余移入 throwaway 分支。

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { PrototypeSwitcher } from "@/components/prototype-switcher";

// ─────────────────────────── mock 数据 ───────────────────────────

type Phase = "qa" | "review" | "impl";

const REQ = { key: "REQ-127", title: "支持导出周报为 PDF" };

const QUESTIONS = [
    {
        id: "q1",
        text: "PDF 的版式基准是什么？",
        context: "周报目前是网页自适应布局，导出需要固定纸张。",
        options: [
            { label: "A4 纵向，跟随现有打印样式", desc: "复用 print.css，改造量最小", recommended: true },
            { label: "A4 横向，表格优先", desc: "宽表不换行，但图文段落留白多" },
            { label: "其他（备注说明）", desc: "" },
        ],
    },
    {
        id: "q2",
        text: "导出入口放在哪里？",
        context: null,
        options: [
            { label: "周报详情页右上角按钮", desc: "", recommended: true },
            { label: "列表页每行操作菜单", desc: "" },
        ],
    },
];

const SPEC = [
    ["目标", "周报详情页新增「导出 PDF」，A4 纵向、复用 print.css 基准。"],
    ["范围", "后端 puppeteer 渲染端点；前端详情页按钮 + 生成中态；不含批量导出/定时邮件。"],
    ["验收", "3 页以内 5 秒出件；中文字体不缺字。"],
] as const;

const CARDS = [
    { no: 1, title: "封装 PDF 渲染端点（puppeteer + print.css）", status: "succeeded" as const },
    { no: 2, title: "详情页导出按钮与生成中态", status: "running" as const },
    { no: 3, title: "中文字体嵌入与 3 页样例回归", status: "queued" as const },
];

const CARD_STATUS_META = {
    succeeded: { label: "已完成", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" },
    running: { label: "执行中", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400" },
    queued: { label: "排队中", cls: "bg-muted text-muted-foreground" },
    failed: { label: "失败", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400" },
};

const PHASE_META: Record<Phase, { pill: string; cls: string }> = {
    qa: { pill: "分析中 · 等待回答", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400" },
    review: { pill: "分析完成 · 待核验", cls: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400" },
    impl: { pill: "实现中 2/3", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400" },
};

// ─────────────────────────── 公共小件 ───────────────────────────

function PhasePill({ phase }: { phase: Phase }) {
    const m = PHASE_META[phase];
    return <Badge variant="outline" className={`border-transparent ${m.cls}`}>{m.pill}</Badge>;
}

/** mock 阶段切换器（评审辅助，不属于被评审的设计） */
function MockPhaseBar({ phase, setPhase }: { phase: Phase; setPhase: (p: Phase) => void }) {
    return (
        <div className="mb-3 flex gap-1 rounded-md bg-muted p-1 text-xs">
            {(["qa", "review", "impl"] as Phase[]).map((p) => (
                <button key={p} onClick={() => setPhase(p)}
                    className={`flex-1 rounded px-2 py-1 ${phase === p ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
                    {p === "qa" ? "① 问答" : p === "review" ? "② 核验" : "③ 实现"}
                </button>
            ))}
        </div>
    );
}

function QuestionForm({ compact }: { compact?: boolean }) {
    const [sel, setSel] = useState<Record<string, number | null>>({ q1: null, q2: null });
    const unanswered = Object.values(sel).filter((v) => v === null).length;
    return (
        <div className="space-y-4">
            {QUESTIONS.map((q, qi) => (
                <div key={q.id} className={compact ? "" : "rounded-lg border p-3"}>
                    <div className="text-sm font-semibold">{qi + 1}. {q.text}</div>
                    {q.context && <div className="mb-2 text-xs text-muted-foreground">{q.context}</div>}
                    <div className="mt-2 space-y-1.5">
                        {q.options.map((o, oi) => (
                            <label key={oi}
                                className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm ${sel[q.id] === oi ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}>
                                <input type="radio" name={q.id} className="mt-1 accent-[var(--primary)]"
                                    checked={sel[q.id] === oi} onChange={() => setSel({ ...sel, [q.id]: oi })} />
                                <span>
                                    <span className="font-medium">{o.label}</span>
                                    {o.recommended && <Badge variant="outline" className="ml-2 border-primary px-1 py-0 text-[10px] text-primary">推荐</Badge>}
                                    {o.desc && <div className="text-xs text-muted-foreground">{o.desc}</div>}
                                </span>
                            </label>
                        ))}
                    </div>
                </div>
            ))}
            <Textarea rows={2} placeholder="补充备注（可选），会一并带给分析引擎" className="text-sm" />
            <div className="flex items-center gap-2">
                <Button size="sm" disabled={unanswered > 0}>提交回答并继续分析</Button>
                <Button size="sm" variant="outline" className="text-destructive">中止分析</Button>
                <span className="ml-auto text-xs text-muted-foreground">{unanswered > 0 ? `还有 ${unanswered} 题未选择` : "全部已选"}</span>
            </div>
        </div>
    );
}

function SpecView() {
    return (
        <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
            {SPEC.map(([h, body]) => (
                <div key={h}><span className="font-semibold">{h}：</span><span className="text-muted-foreground">{body}</span></div>
            ))}
        </div>
    );
}

function CardEditor() {
    return (
        <div className="space-y-1.5">
            {CARDS.map((c) => (
                <div key={c.no} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <span className="w-5 text-xs tabular-nums text-muted-foreground">{c.no}</span>
                    <input defaultValue={c.title} className="flex-1 bg-transparent outline-none hover:bg-muted/60 rounded px-1" />
                    <button className="text-muted-foreground hover:text-destructive" aria-label="删除卡">✕</button>
                </div>
            ))}
            <button className="w-full rounded-md border border-dashed py-1.5 text-xs text-primary hover:border-primary">＋ 添加一张卡</button>
        </div>
    );
}

function ReviewActions() {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">核验通过，开始实现</Button>
            <Button size="sm" variant="outline">重新分析…</Button>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" className="accent-[var(--primary)]" />自动直通
            </label>
        </div>
    );
}

function CardProgress({ withFailedDemo }: { withFailedDemo?: boolean }) {
    const rows = withFailedDemo
        ? [CARDS[0], { ...CARDS[1], status: "failed" as const }, CARDS[2]]
        : CARDS;
    return (
        <div className="divide-y rounded-lg border">
            {rows.map((c) => {
                const m = CARD_STATUS_META[c.status];
                return (
                    <div key={c.no} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                        <span className="w-5 text-xs tabular-nums text-muted-foreground">{c.no}</span>
                        <span className={`flex-1 ${c.status === "queued" ? "text-muted-foreground" : ""}`}>{c.title}</span>
                        <Badge variant="outline" className={`border-transparent text-[11px] ${m.cls}`}>{m.label}</Badge>
                        <div className="flex gap-1">
                            {c.status === "failed" && <Button size="sm" className="h-6 px-2 text-xs">从此卡重试</Button>}
                            {(c.status === "queued" || c.status === "failed") && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs">跳过</Button>}
                            {c.status === "running" && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive">中止</Button>}
                            {c.status !== "queued" && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs">时间线</Button>}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─────────────────────────── 变体 A：纵向分区面板 ───────────────────────────
// 与现有 480px Sheet 同构：所有区块纵向堆叠，随状态显隐，滚动浏览。

function VariantA({ phase, setPhase }: { phase: Phase; setPhase: (p: Phase) => void }) {
    return (
        <SheetContent className="w-[480px] overflow-y-auto sm:max-w-[480px]">
            <SheetHeader>
                <SheetTitle className="flex items-center gap-2">{REQ.key} <PhasePill phase={phase} /></SheetTitle>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-8">
                <MockPhaseBar phase={phase} setPhase={setPhase} />
                <div className="text-sm font-medium">{REQ.title}</div>
                <Separator />
                {phase === "qa" && (<>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">待回答问题（2）</h4>
                    <QuestionForm />
                </>)}
                {phase === "review" && (<>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">分析规格</h4>
                    <SpecView />
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">实现卡（顺序即执行顺序）</h4>
                    <CardEditor />
                    <ReviewActions />
                </>)}
                {phase === "impl" && (<>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">卡片进度</h4>
                    <CardProgress />
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">失败态示意</h4>
                    <CardProgress withFailedDemo />
                </>)}
            </div>
        </SheetContent>
    );
}

// ─────────────────────────── 变体 B：步骤条向导 ───────────────────────────
// 640px Sheet，顶部横向 stepper 表达生命周期；只展开当前步骤，已完成步骤可点击回看。

function VariantB({ phase, setPhase }: { phase: Phase; setPhase: (p: Phase) => void }) {
    const steps: { key: Phase; label: string }[] = [
        { key: "qa", label: "需求分析" },
        { key: "review", label: "规格核验" },
        { key: "impl", label: "拆卡实现" },
    ];
    const idx = steps.findIndex((s) => s.key === phase);
    return (
        <SheetContent className="w-[640px] overflow-y-auto sm:max-w-[640px]">
            <SheetHeader>
                <SheetTitle className="flex items-center gap-2">{REQ.key} · {REQ.title}</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-8">
                <div className="flex items-center">
                    {steps.map((s, i) => (
                        <div key={s.key} className="flex flex-1 items-center">
                            <button onClick={() => setPhase(s.key)} className="flex items-center gap-2">
                                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold
                                    ${i < idx ? "bg-emerald-500 text-white" : i === idx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                                    {i < idx ? "✓" : i + 1}
                                </span>
                                <span className={`text-sm ${i === idx ? "font-semibold" : "text-muted-foreground"}`}>{s.label}</span>
                            </button>
                            {i < steps.length - 1 && <div className={`mx-3 h-px flex-1 ${i < idx ? "bg-emerald-500" : "bg-border"}`} />}
                        </div>
                    ))}
                </div>
                <div className="rounded-lg border p-4">
                    {phase === "qa" && (<>
                        <div className="mb-3 flex items-center justify-between">
                            <span className="text-sm font-semibold">第 2 轮拷问 · 2 题待回答</span><PhasePill phase={phase} />
                        </div>
                        <QuestionForm />
                    </>)}
                    {phase === "review" && (<>
                        <div className="mb-3 flex items-center justify-between">
                            <span className="text-sm font-semibold">核验分析产物</span><PhasePill phase={phase} />
                        </div>
                        <div className="space-y-4">
                            <SpecView />
                            <CardEditor />
                            <ReviewActions />
                        </div>
                    </>)}
                    {phase === "impl" && (<>
                        <div className="mb-3 flex items-center justify-between">
                            <span className="text-sm font-semibold">串行执行 · 共用 worktree req-127</span><PhasePill phase={phase} />
                        </div>
                        <CardProgress />
                    </>)}
                </div>
                {idx > 0 && (
                    <details className="rounded-lg border px-4 py-2 text-sm text-muted-foreground">
                        <summary className="cursor-pointer">已完成步骤回看（问答 4 题 / 规格 v2）</summary>
                        <div className="mt-2 space-y-2"><SpecView /></div>
                    </details>
                )}
            </div>
        </SheetContent>
    );
}

// ─────────────────────────── 变体 C：双栏工作台 ───────────────────────────
// 900px 宽 Sheet：左栏固定展示规格与卡片（任何阶段都可见），右栏是当前动作区。

function VariantC({ phase, setPhase }: { phase: Phase; setPhase: (p: Phase) => void }) {
    return (
        <SheetContent className="w-[900px] overflow-y-auto sm:max-w-[900px]">
            <SheetHeader>
                <SheetTitle className="flex items-center gap-2">{REQ.key} · {REQ.title} <PhasePill phase={phase} /></SheetTitle>
            </SheetHeader>
            <div className="px-4 pb-8">
                <MockPhaseBar phase={phase} setPhase={setPhase} />
                <div className="grid grid-cols-[1fr_1.2fr] gap-4">
                    <div className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">规格（随分析实时更新）</h4>
                        {phase === "qa"
                            ? <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">分析进行中，规格草稿将在这里逐步成形…</div>
                            : <SpecView />}
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">实现卡</h4>
                        {phase === "qa"
                            ? <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">拆卡在分析完成后产出</div>
                            : phase === "review" ? <CardEditor /> : <CardProgress />}
                    </div>
                    <div className="space-y-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {phase === "qa" ? "当前动作：回答拷问" : phase === "review" ? "当前动作：核验" : "当前动作：观察执行"}
                        </h4>
                        {phase === "qa" && <QuestionForm compact />}
                        {phase === "review" && (
                            <div className="space-y-3">
                                <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                                    左侧规格与卡片确认无误后，从这里放行。分析共 2 轮、4 个问题，
                                    历史问答可在时间线查看。
                                </div>
                                <ReviewActions />
                            </div>
                        )}
                        {phase === "impl" && (
                            <div className="space-y-2 rounded-lg border p-3 text-xs font-mono text-muted-foreground">
                                <div>10:02:11 [card-2] action Bash: npm run build…</div>
                                <div>10:02:36 [card-2] observation: build ok (web 2.1MB)</div>
                                <div>10:02:40 [card-2] thought: 需要给按钮加 loading 态…</div>
                                <div className="text-primary">▍执行时间线实时滚动（复用 session_events 回放）</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </SheetContent>
    );
}

// ─────────────────────────── 切换器挂载 ───────────────────────────

const VARIANT_LABELS: Record<string, string> = { A: "纵向分区面板", B: "步骤条向导", C: "双栏工作台" };

export function TwoPhasePrototype({ variant, onVariantChange, onClose }: {
    variant: string;
    onVariantChange: (v: string) => void;
    onClose: () => void;
}) {
    const [phase, setPhase] = useState<Phase>("qa");
    const v = ["A", "B", "C"].includes(variant) ? variant : "A";
    return (
        <>
            <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
                {v === "A" && <VariantA phase={phase} setPhase={setPhase} />}
                {v === "B" && <VariantB phase={phase} setPhase={setPhase} />}
                {v === "C" && <VariantC phase={phase} setPhase={setPhase} />}
            </Sheet>
            <PrototypeSwitcher variants={["A", "B", "C"]} current={v} onChange={onVariantChange} label={VARIANT_LABELS[v]} />
        </>
    );
}
