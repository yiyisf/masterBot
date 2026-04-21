"use client";

import { useState, useCallback } from "react";
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { fetchApi } from "@/lib/api";

export interface InterruptInfo {
    id: string;
    tool: string;
    args: Record<string, unknown>;
    reason: string;
    resolved: boolean | null;
}

export const InterruptCard = ({
    interrupt,
    sessionId,
}: {
    interrupt: InterruptInfo;
    sessionId: string;
}) => {
    const [status, setStatus] = useState<'pending' | 'loading' | 'approved' | 'rejected'>(
        interrupt.resolved === true ? 'approved' : interrupt.resolved === false ? 'rejected' : 'pending'
    );

    const respond = useCallback(async (approved: boolean) => {
        setStatus('loading');
        try {
            await fetchApi(`/api/sessions/${sessionId}/interrupt-response`, {
                method: 'POST',
                body: JSON.stringify({ approved }),
            });
            setStatus(approved ? 'approved' : 'rejected');
        } catch {
            setStatus('pending');
        }
    }, [sessionId]);

    const cmdPreview = interrupt.args?.command
        ? String(interrupt.args.command).slice(0, 120)
        : interrupt.args?.query
            ? String(interrupt.args.query).slice(0, 120)
            : JSON.stringify(interrupt.args).slice(0, 120);

    return (
        <div className="my-3 rounded-xl border border-amber-300/60 dark:border-amber-700/60 bg-amber-50/80 dark:bg-amber-950/30 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-100/80 dark:bg-amber-900/30 border-b border-amber-300/40 dark:border-amber-700/40">
                <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">高危操作确认</span>
                <span className="ml-auto text-[11px] text-amber-600/70 dark:text-amber-400/70 font-mono">{interrupt.tool}</span>
            </div>

            <div className="px-4 py-3 space-y-2">
                <p className="text-sm text-amber-900 dark:text-amber-200">
                    Agent 即将执行以下操作，请确认是否继续：
                </p>
                <div className="text-xs text-amber-800/80 dark:text-amber-300/80 font-medium">
                    ⚠️ {interrupt.reason}
                </div>
                {cmdPreview && (
                    <pre className="text-xs bg-black/10 dark:bg-white/5 rounded-md px-3 py-2 text-amber-900 dark:text-amber-200 overflow-x-auto whitespace-pre-wrap break-all">
                        {cmdPreview}
                    </pre>
                )}
            </div>

            <div className="px-4 py-2.5 border-t border-amber-300/40 dark:border-amber-700/40 flex items-center gap-2">
                {status === 'pending' && (
                    <>
                        <button
                            onClick={() => respond(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition-colors"
                        >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            确认执行
                        </button>
                        <button
                            onClick={() => respond(false)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400/60 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-xs font-medium transition-colors"
                        >
                            <ShieldX className="w-3.5 h-3.5" />
                            取消操作
                        </button>
                        <span className="ml-auto text-[10px] text-amber-600/60">等待您的确认…</span>
                    </>
                )}
                {status === 'loading' && (
                    <span className="text-xs text-amber-600 animate-pulse">处理中…</span>
                )}
                {status === 'approved' && (
                    <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
                        <ShieldCheck className="w-3.5 h-3.5" /> 已确认，Agent 继续执行
                    </span>
                )}
                {status === 'rejected' && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                        <ShieldX className="w-3.5 h-3.5" /> 已取消操作
                    </span>
                )}
            </div>
        </div>
    );
};
