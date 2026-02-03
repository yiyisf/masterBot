import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronRight, ListTodo, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ChatStep {
    thought?: string;
    plan?: string[]; // Array of plan steps
    action?: string;
    observation?: string;
    status?: 'pending' | 'running' | 'completed' | 'failed';
}

export function ChatThinking({ steps }: { steps: ChatStep[] }) {
    if (!steps || steps.length === 0) return null;

    // Determine current phase based on last step
    const lastStep = steps[steps.length - 1];
    const isThinking = lastStep.thought && !lastStep.action && !lastStep.plan;
    const isPlanning = !!lastStep.plan;
    const isExecuting = !!lastStep.action;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                className="w-full space-y-3 my-4"
            >
                {/* Status Indicator for the whole process */}
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground ml-1">
                    {isThinking && <><Loader2 className="w-3 h-3 animate-spin" /> <span>Thinking...</span></>}
                    {isPlanning && <><ListTodo className="w-3 h-3" /> <span>Planning...</span></>}
                    {isExecuting && <><Clock className="w-3 h-3 animate-pulse" /> <span>Executing...</span></>}
                </div>

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
                                </div>
                                {step.observation && (
                                    <div className="text-xs text-muted-foreground bg-muted/20 p-2 rounded-md font-mono overflow-x-auto max-h-[100px]">
                                        <div className="flex items-center gap-1.5 mb-1 opacity-70">
                                            <CheckCircle2 className="w-3 h-3 text-green-500" />
                                            <span>Result:</span>
                                        </div>
                                        {step.observation}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </motion.div>
        </AnimatePresence>
    );
}
