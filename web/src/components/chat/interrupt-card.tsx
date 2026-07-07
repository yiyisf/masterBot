"use client";

import { useState, useCallback } from "react";
import { ShieldAlert, ShieldCheck, ShieldX, MessageCircleQuestion, Send } from "lucide-react";
import { fetchApi } from "@/lib/api";

export interface InterruptInfo {
    id: string;
    tool: string;
    args: Record<string, unknown>;
    reason: string;
    resolved: boolean | null;
    /** interrupt 实际挂起的 sessionId（子 Agent 场景下与 Chat sessionId 不同） */
    sessionId?: string;
    /** approval=危险操作确认；question=ask_user 提问（文本应答） */
    kind?: 'approval' | 'question';
    /** ask_user 提供的候选答案 */
    options?: string[];
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
    const [answer, setAnswer] = useState('');

    // 应答必须发往 interrupt 实际挂起的 session：
    // 子 Agent 的 interrupt 挂起在 harness 子 session 上；
    // 新会话（URL 无 sessionId）时 chunk 内的 sessionId 也是唯一可靠来源。
    const targetSessionId = interrupt.sessionId || sessionId;
    const isQuestion = interrupt.kind === 'question';

    const respond = useCallback(async (approved: boolean, response?: string) => {
        setStatus('loading');
        try {
            await fetchApi(`/api/sessions/${targetSessionId}/interrupt-response`, {
                method: 'POST',
                body: JSON.stringify(response ? { approved, response } : { approved }),
            });
            setStatus(approved ? 'approved' : 'rejected');
        } catch {
            setStatus('pending');
        }
    }, [targetSessionId]);

    const cmdPreview = interrupt.args?.command
        ? String(interrupt.args.command).slice(0, 120)
        : interrupt.args?.query
            ? String(interrupt.args.query).slice(0, 120)
            : !isQuestion
                ? JSON.stringify(interrupt.args).slice(0, 120)
                : '';

    return (
        <div className="my-3 rounded-xl border border-amber-300/60 dark:border-amber-700/60 bg-amber-50/80 dark:bg-amber-950/30 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-100/80 dark:bg-amber-900/30 border-b border-amber-300/40 dark:border-amber-700/40">
                {isQuestion
                    ? <MessageCircleQuestion className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    : <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />}
                <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    {isQuestion ? 'Agent 提问' : '高危操作确认'}
                </span>
                <span className="ml-auto text-[11px] text-amber-600/70 dark:text-amber-400/70 font-mono">{interrupt.tool}</span>
            </div>

            <div className="px-4 py-3 space-y-2">
                {isQuestion ? (
                    <p className="text-sm text-amber-900 dark:text-amber-200 whitespace-pre-wrap">
                        {interrupt.reason}
                    </p>
                ) : (
                    <>
                        <p className="text-sm text-amber-900 dark:text-amber-200">
                            Agent 即将执行以下操作，请确认是否继续：
                        </p>
                        <div className="text-xs text-amber-800/80 dark:text-amber-300/80 font-medium">
                            ⚠️ {interrupt.reason}
                        </div>
                    </>
                )}
                {cmdPreview && (
                    <pre className="text-xs bg-black/10 dark:bg-white/5 rounded-md px-3 py-2 text-amber-900 dark:text-amber-200 overflow-x-auto whitespace-pre-wrap break-all">
                        {cmdPreview}
                    </pre>
                )}
                {isQuestion && status === 'pending' && (interrupt.options?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {interrupt.options!.map((opt, i) => (
                            <button
                                key={i}
                                onClick={() => respond(true, opt)}
                                className="px-2.5 py-1 rounded-full border border-amber-400/60 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-xs transition-colors"
                            >
                                {opt}
                            </button>
                        ))}
                    </div>
                )}
                {isQuestion && status === 'pending' && (
                    <div className="flex gap-2 items-start">
                        <textarea
                            value={answer}
                            onChange={e => setAnswer(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey && answer.trim()) {
                                    e.preventDefault();
                                    respond(true, answer.trim());
                                }
                            }}
                            placeholder="输入你的回答…（Enter 发送）"
                            rows={2}
                            className="flex-1 text-sm rounded-md border border-amber-300/60 dark:border-amber-700/60 bg-background/60 px-3 py-2 resize-y focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        <button
                            onClick={() => answer.trim() && respond(true, answer.trim())}
                            disabled={!answer.trim()}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-xs font-medium transition-colors"
                        >
                            <Send className="w-3.5 h-3.5" />
                            回答
                        </button>
                    </div>
                )}
            </div>

            <div className="px-4 py-2.5 border-t border-amber-300/40 dark:border-amber-700/40 flex items-center gap-2">
                {status === 'pending' && !isQuestion && (
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
                {status === 'pending' && isQuestion && (
                    <>
                        <button
                            onClick={() => respond(false)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400/60 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-xs font-medium transition-colors"
                        >
                            <ShieldX className="w-3.5 h-3.5" />
                            跳过此问题
                        </button>
                        <span className="ml-auto text-[10px] text-amber-600/60">Agent 等待您的回答…</span>
                    </>
                )}
                {status === 'loading' && (
                    <span className="text-xs text-amber-600 animate-pulse">处理中…</span>
                )}
                {status === 'approved' && (
                    <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
                        <ShieldCheck className="w-3.5 h-3.5" /> {isQuestion ? '已回答，Agent 继续执行' : '已确认，Agent 继续执行'}
                    </span>
                )}
                {status === 'rejected' && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                        <ShieldX className="w-3.5 h-3.5" /> {isQuestion ? '已跳过该问题' : '已取消操作'}
                    </span>
                )}
            </div>
        </div>
    );
};
