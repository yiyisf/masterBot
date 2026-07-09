"use client";

import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ListTodo, ChevronRight, ChevronDown, CheckCircle2, XCircle,
    Loader2, Bot, ExternalLink, BarChart2, Archive,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { makeAssistantDataUI } from "@assistant-ui/react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DagView } from "@/components/dag-view";
import { ConductorWorkflowCard } from "@/components/conductor-workflow-dialog";
import { InterruptCard, type InterruptInfo } from "@/components/chat/interrupt-card";
import type { SubTaskData, TasksData } from "@/lib/assistant-runtime";

// ─── plan: 执行计划清单 ──────────────────────────────────────────────────────

const PlanDataUI = makeAssistantDataUI<string[]>({
    name: "plan",
    render: ({ data }) => {
        if (!Array.isArray(data) || data.length === 0) return null;
        return (
            <Card className="my-2 p-4 text-xs bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/30">
                <div className="flex items-center gap-2 mb-2 text-blue-600 dark:text-blue-400 font-semibold">
                    <ListTodo className="w-4 h-4" />
                    <span>Execution Plan</span>
                </div>
                <div className="space-y-1.5 pl-1">
                    {data.map((planStep, pIdx) => (
                        <div key={pIdx} className="flex gap-2 items-start">
                            <div className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/40 text-[10px] flex items-center justify-center text-blue-600 dark:text-blue-400 font-mono shrink-0 mt-0.5">
                                {pIdx + 1}
                            </div>
                            <span className="text-muted-foreground">{String(planStep)}</span>
                        </div>
                    ))}
                </div>
            </Card>
        );
    },
});

// ─── subTask: 子 Agent 托管任务面板 ─────────────────────────────────────────

const SubTaskPanel = memo(function SubTaskPanel({ subTask }: { subTask: SubTaskData }) {
    const [collapsed, setCollapsed] = useState(true);

    const actionSteps = subTask.steps.filter((s: any) => s.type === 'action' || s.type === 'observation');
    const duration = subTask.endTime ? subTask.endTime - subTask.startTime : null;

    return (
        <Card className="my-2 border border-indigo-200 dark:border-indigo-800/40 bg-indigo-50/30 dark:bg-indigo-950/10 text-xs">
            <div
                className="flex items-center gap-2 p-3 cursor-pointer select-none"
                onClick={() => setCollapsed(v => !v)}
            >
                <Bot className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span className="font-medium text-indigo-700 dark:text-indigo-300">
                    托管 Agent: {subTask.delegatedFrom}
                </span>
                {subTask.status === 'running' && (
                    <Loader2 className="w-3 h-3 animate-spin text-amber-500" />
                )}
                {subTask.status === 'completed' && (
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                )}
                {subTask.status === 'failed' && (
                    <XCircle className="w-3 h-3 text-red-500" />
                )}
                {subTask.graderScore !== undefined && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground ml-1">
                        <BarChart2 className="w-3 h-3" />
                        质量评分: {subTask.graderScore}/100
                    </span>
                )}
                {duration !== null && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                        {duration >= 1000 ? `${(duration / 1000).toFixed(1)}s` : `${duration}ms`}
                    </span>
                )}
                <a
                    href="/agents"
                    className="flex items-center gap-0.5 text-[10px] text-indigo-500 hover:underline ml-1"
                    onClick={e => e.stopPropagation()}
                    title="在 /agents 管理台查看详情"
                >
                    <ExternalLink className="w-3 h-3" />
                </a>
                <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", !collapsed && "rotate-180")} />
            </div>

            <AnimatePresence initial={false}>
                {!collapsed && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <div className="px-3 pb-3 space-y-1.5 border-t border-indigo-100 dark:border-indigo-900/30 pt-2">
                            {actionSteps.map((step: any, idx: number) => (
                                <div key={idx} className="flex items-start gap-2">
                                    {step.type === 'action' ? (
                                        <>
                                            <ChevronRight className="w-3 h-3 text-indigo-400 mt-0.5 shrink-0" />
                                            <span className="font-mono text-[10px] text-indigo-600 dark:text-indigo-400">
                                                {step.toolName || step.content}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 shrink-0" />
                                            <span className="text-muted-foreground text-[10px] line-clamp-2">
                                                {String(step.content ?? '').slice(0, 150)}
                                            </span>
                                        </>
                                    )}
                                </div>
                            ))}
                            {actionSteps.length === 0 && subTask.status === 'running' && (
                                <span className="text-muted-foreground/60 text-[10px]">Agent 执行中…</span>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </Card>
    );
});

const SubTaskDataUI = makeAssistantDataUI<SubTaskData>({
    name: "subTask",
    render: ({ data }) => <SubTaskPanel subTask={data} />,
});

// ─── tasks: DAG 任务事件流程图 ──────────────────────────────────────────────

const TasksDataUI = makeAssistantDataUI<TasksData>({
    name: "tasks",
    render: ({ data }) => <DagView steps={data.events} />,
});

// ─── grading: Harness Grader 评分 ───────────────────────────────────────────

const GradingDataUI = makeAssistantDataUI<{ type: string; content: string }>({
    name: "grading",
    render: ({ data }) => (
        <Card className="my-2 p-2 text-xs bg-amber-50/30 dark:bg-amber-950/10 border border-amber-200 dark:border-amber-800/30">
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <BarChart2 className="w-3.5 h-3.5" />
                <span>
                    {data.type === 'grading'
                        ? data.content
                        : (() => {
                            try {
                                const r = JSON.parse(data.content);
                                return `质量评分: ${r.overallScore}/100 — ${r.status}`;
                            } catch {
                                return data.content;
                            }
                        })()
                    }
                </span>
            </div>
        </Card>
    ),
});

// ─── contextCompressed: 上下文压缩提示 ──────────────────────────────────────

const ContextCompressedDataUI = makeAssistantDataUI<{ droppedCount: number; summary: string }>({
    name: "contextCompressed",
    render: ({ data }) => (
        <div className="my-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Archive className="w-3 h-3" />
            <span>{data.summary}{data.droppedCount > 0 ? `（压缩 ${data.droppedCount} 条历史）` : ''}</span>
        </div>
    ),
});

// ─── workflow: Conductor 工作流卡片 ─────────────────────────────────────────

const WorkflowDataUI = makeAssistantDataUI<{ workflow: unknown; explanation?: string }>({
    name: "workflow",
    render: ({ data }) => (
        <ConductorWorkflowCard
            workflowDef={data.workflow as never}
            explanation={data.explanation}
        />
    ),
});

// ─── interrupt: 人机确认 / ask_user 提问卡片 ────────────────────────────────

const InterruptRenderer = ({ data }: { data: InterruptInfo }) => {
    const searchParams = useSearchParams();
    const sessionId = searchParams.get("sessionId") || "";
    return <InterruptCard interrupt={data} sessionId={sessionId} />;
};

const InterruptDataUI = makeAssistantDataUI<InterruptInfo>({
    name: "interrupt",
    render: ({ data }) => <InterruptRenderer data={data} />,
});

/** 所有 data part 渲染器，挂载在 AssistantRuntimeProvider 内即注册 */
export const allDataUIs = [
    PlanDataUI,
    SubTaskDataUI,
    TasksDataUI,
    GradingDataUI,
    ContextCompressedDataUI,
    WorkflowDataUI,
    InterruptDataUI,
];
