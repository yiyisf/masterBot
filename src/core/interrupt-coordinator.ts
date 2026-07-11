/**
 * Interrupt Coordinator — Human-in-the-Loop pause/resume
 *
 * When the agent detects a dangerous action it yields an `interrupt` step and
 * calls `waitForApproval(sessionId)`.  The async generator suspends there
 * (Node.js event loop stays free).  When the user responds via
 * POST /api/sessions/:id/interrupt-response, `resolveInterrupt` is called and
 * the generator resumes with the user's decision.
 *
 * Only one pending interrupt per session is supported (serial ReAct loop).
 */

import { auditRepository } from './audit-repository.js';
import { sessionEventStore } from './harness/session-store.js';

export interface InterruptMeta {
    interruptId?: string;
    actionName?: string;
    actionParams?: string;
    dangerReason?: string;
    executionId?: string;
}

export interface ResolveOptions extends InterruptMeta {
    operator?: string;
    operatorChannel?: string;
    /** 文本应答内容（ask_user 类 question interrupt） */
    response?: string;
}

/** 用户对 interrupt 的应答：布尔决定 + 可选文本回答 */
export interface UserDecision {
    approved: boolean;
    response?: string;
}

interface PendingInterrupt {
    resolve: (decision: UserDecision) => void;
    reject: (err: Error) => void;
    meta?: InterruptMeta;
}

const pendingInterrupts = new Map<string, PendingInterrupt>();

/**
 * Called by the agent — suspends until the user responds (or abortSignal fires).
 * Returns the full decision including optional text response.
 */
export function waitForUserDecision(
    sessionId: string,
    meta?: InterruptMeta,
    abortSignal?: AbortSignal
): Promise<UserDecision> {
    return new Promise<UserDecision>((resolve, reject) => {
        pendingInterrupts.set(sessionId, { resolve, reject, meta });
        // 父级 abort（如 Chat 断连）时释放挂起的 Promise，避免子 Agent 永久悬挂
        abortSignal?.addEventListener('abort', () => {
            if (pendingInterrupts.get(sessionId)?.reject === reject) {
                pendingInterrupts.delete(sessionId);
                reject(new Error('Aborted while waiting for user response'));
            }
        }, { once: true });
    });
}

/**
 * Called by the agent — suspends until the user responds.
 * Returns `true` if approved, `false` if rejected.
 */
export function waitForApproval(sessionId: string, meta?: InterruptMeta, abortSignal?: AbortSignal): Promise<boolean> {
    return waitForUserDecision(sessionId, meta, abortSignal).then(d => d.approved);
}

/**
 * Called by the server when user responds to the confirmation prompt.
 * Returns false if there was no pending interrupt for this session.
 */
export function resolveInterrupt(sessionId: string, approved: boolean, opts?: ResolveOptions): boolean {
    const pending = pendingInterrupts.get(sessionId);
    if (!pending) return false;

    // Record approval decision in audit log（opts 逐字段覆盖挂起时登记的 meta）
    const meta = { ...pending.meta, ...opts };
    try {
        auditRepository.recordApproval({
            executionId: meta?.executionId,
            sessionId,
            interruptId: opts?.interruptId ?? meta?.interruptId ?? sessionId,
            actionName: opts?.actionName ?? meta?.actionName,
            actionParams: opts?.actionParams ?? meta?.actionParams,
            dangerReason: opts?.dangerReason ?? meta?.dangerReason,
            decision: approved ? 'approved' : 'rejected',
            operator: opts?.operator,
            operatorChannel: opts?.operatorChannel ?? 'web',
        });
    } catch {
        // Non-fatal: audit failure should not block HitL resolution
    }

    // 研发流程管理：interrupt 双写 session_events（回放用）+ audit_approvals（上面已写，审计台账用）
    try {
        sessionEventStore.append({
            sessionId,
            timestamp: Date.now(),
            type: 'interrupt_resolved',
            payload: {
                interruptId: opts?.interruptId ?? meta?.interruptId ?? sessionId,
                approved,
                response: opts?.response,
            },
        });
    } catch {
        // Non-fatal: session_events 写入失败不应阻塞 HitL 恢复
    }

    pending.resolve({ approved, response: opts?.response });
    pendingInterrupts.delete(sessionId);
    return true;
}

/**
 * Called when the SSE connection closes mid-interrupt to avoid hanging Promises.
 */
export function cancelInterrupt(sessionId: string): void {
    const pending = pendingInterrupts.get(sessionId);
    if (pending) {
        // Record cancellation
        try {
            auditRepository.recordApproval({
                sessionId,
                interruptId: pending.meta?.interruptId ?? sessionId,
                actionName: pending.meta?.actionName,
                dangerReason: pending.meta?.dangerReason,
                decision: 'cancelled',
                operatorChannel: 'web',
            });
        } catch {
            // Non-fatal
        }
        try {
            sessionEventStore.append({
                sessionId,
                timestamp: Date.now(),
                type: 'interrupt_resolved',
                payload: { interruptId: pending.meta?.interruptId ?? sessionId, approved: false, cancelled: true },
            });
        } catch {
            // Non-fatal
        }
        pending.reject(new Error('Client disconnected during interrupt'));
        pendingInterrupts.delete(sessionId);
    }
}

/** Check whether a session has a pending interrupt waiting for user response. */
export function hasPendingInterrupt(sessionId: string): boolean {
    return pendingInterrupts.has(sessionId);
}

/** Get metadata for a pending interrupt (used by IM card callbacks). */
export function getPendingInterruptMeta(sessionId: string): InterruptMeta | undefined {
    return pendingInterrupts.get(sessionId)?.meta;
}
