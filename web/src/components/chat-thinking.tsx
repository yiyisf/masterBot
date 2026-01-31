"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";

interface ChatStep {
    thought?: string;
    action?: string;
    observation?: string;
}

export function ChatThinking({ steps }: { steps: ChatStep[] }) {
    if (!steps || steps.length === 0) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                className="w-full space-y-2 my-2"
            >
                {steps.map((step, idx) => (
                    <Card key={idx} className="p-3 text-xs bg-muted/40 border-dashed border-primary/20">
                        {step.thought && (
                            <div className="flex gap-2">
                                <Sparkles className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                                <span className="italic text-muted-foreground whitespace-pre-wrap">{step.thought}</span>
                            </div>
                        )}
                        {step.action && (
                            <div className="mt-1 flex gap-2 overflow-x-auto">
                                <ChevronRight className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                                <code className="bg-background/80 px-1 rounded text-[10px] text-blue-600 font-mono">
                                    {step.action}
                                </code>
                            </div>
                        )}
                        {step.observation && (
                            <div className="mt-1 pt-1 border-t border-muted-foreground/10 text-muted-foreground/80">
                                <span className="font-semibold">Result:</span> {step.observation}
                            </div>
                        )}
                    </Card>
                ))}
            </motion.div>
        </AnimatePresence>
    );
}
