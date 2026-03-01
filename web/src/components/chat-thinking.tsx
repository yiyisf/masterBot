import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronRight, ListTodo, CheckCircle2, XCircle, Clock, Loader2, BrainCircuit, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function isErrorObservation(observation: string): boolean {
    return (
        observation.startsWith('Error:') ||
        observation.startsWith('技能 ') ||
        observation.includes('不可用') ||
        observation.includes('依赖包缺失') ||
        observation.includes('not found in any registered source') ||
        /^Error\b/.test(observation)
    );
}

export interface ChatStep {
    thought?: string;
    plan?: string[]; // Array of plan steps
    action?: string;
    observation?: string;
    duration?: number;  // ms — tool execution time
    status?: 'pending' | 'running' | 'completed' | 'failed';
}

export function ChatThinking({ steps }: { steps: ChatStep[] }) {
    const [collapsed, setCollapsed] = useState(false);

    if (!steps || steps.length === 0) return null;

    const totalDuration = steps.reduce((sum, s) => sum + (s.duration ?? 0), 0);
    const actionCount = steps.filter(s => s.action).length;

    // Determine current phase based on last step
    const lastStep = steps[steps.length - 1];
    const isThinking = lastStep.thought && !lastStep.action && !lastStep.plan;
    const isPlanning = !!lastStep.plan;
    const isExecuting = !!lastStep.action;

    return (
        <div className="w-full my-4">
            {/* Collapsible header — always visible */}
            <div
                className="flex items-center gap-2 cursor-pointer select-none py-1 px-2 rounded-md hover:bg-muted/50 transition-colors"
                onClick={() => setCollapsed(v => !v)}
            >
                <BrainCircuit className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">执行过程</span>
                {actionCount > 0 && (
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
                        {actionCount} 步
                    </span>
                )}
                {!collapsed && (isThinking || isPlanning || isExecuting) && (
                    <span className="text-[10px] text-muted-foreground">
                        {isThinking && '思考中...'}
                        {isPlanning && '规划中...'}
                        {isExecuting && '执行中...'}
                    </span>
                )}
                {collapsed && totalDuration > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                        · {totalDuration >= 1000 ? `${(totalDuration / 1000).toFixed(1)}s` : `${totalDuration}ms`}
                    </span>
                )}
                <ChevronDown className={cn(
                    "ml-auto w-3.5 h-3.5 transition-transform text-muted-foreground",
                    collapsed ? "" : "rotate-180"
                )} />
            </div>

            {/* Collapsible steps content */}
            <AnimatePresence initial={false}>
                {!collapsed && (
                    <motion.div
                        key="steps"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="overflow-hidden"
                    >
                        <div className="space-y-3 mt-2">
                            {steps.map((step, idx) => (
                                <div key={idx} className="space-y-2">
                                    {/* Thought Bubble */}
                                    {step.thought && (
                                        <Card className="p-3 text-xs bg-muted/30 border-none shadow-sm flex gap-3 items-start">
                                            <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                            <span className="italic text-muted-foreground/90 whitespace-pre-wrap leading-relaxed">
                                                {step.thought}
                                            </span>
                                        </Card>
                                    )}

                                    {/* Plan Checklist */}
                                    {step.plan && step.plan.length > 0 && (
                                        <Card className="p-4 text-xs bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/30">
                                            <div className="flex items-center gap-2 mb-2 text-blue-600 dark:text-blue-400 font-semibold">
                                                <ListTodo className="w-4 h-4" />
                                                <span>Execution Plan</span>
                                            </div>
                                            <div className="space-y-1.5 pl-1">
                                                {step.plan.map((planStep, pIdx) => (
                                                    <div key={pIdx} className="flex gap-2 items-start">
                                                        <div className="w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/40 text-[10px] flex items-center justify-center text-blue-600 dark:text-blue-400 font-mono shrink-0 mt-0.5">
                                                            {pIdx + 1}
                                                        </div>
                                                        <span className="text-muted-foreground">{planStep}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </Card>
                                    )}

                                    {/* Action & Observation */}
                                    {step.action && (
                                        <div className="ml-4 pl-4 border-l-2 border-muted space-y-2 py-1">
                                            <div className="flex items-center gap-2 text-xs">
                                                <div className="bg-primary/10 text-primary px-2 py-1 rounded-md font-mono text-[10px] flex items-center gap-1.5">
                                                    <ChevronRight className="w-3 h-3" />
                                                    {step.action}
                                                </div>
                                                {step.duration !== undefined && (
                                                    <span className="text-[10px] text-muted-foreground">
                                                        {step.duration >= 1000
                                                            ? `${(step.duration / 1000).toFixed(1)}s`
                                                            : `${step.duration}ms`}
                                                    </span>
                                                )}
                                            </div>
                                            {step.observation && (() => {
                                                const isError = isErrorObservation(step.observation);
                                                return (
                                                    <div className={cn(
                                                        "text-xs p-2 rounded-md font-mono overflow-x-auto max-h-[100px]",
                                                        isError
                                                            ? "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40"
                                                            : "text-muted-foreground bg-muted/20"
                                                    )}>
                                                        <div className="flex items-center gap-1.5 mb-1 opacity-80">
                                                            {isError
                                                                ? <><XCircle className="w-3 h-3 text-red-500" /><span>执行失败:</span></>
                                                                : <><CheckCircle2 className="w-3 h-3 text-green-500" /><span>Result:</span></>
                                                            }
                                                        </div>
                                                        {step.observation}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
