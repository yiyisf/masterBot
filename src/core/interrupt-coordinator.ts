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
}

interface PendingInterrupt {
    resolve: (approved: boolean) => void;
    reject: (err: Error) => void;
    meta?: InterruptMeta;
}

const pendingInterrupts = new Map<string, PendingInterrupt>();

/**
 * Called by the agent — suspends until the user responds.
 * Returns `true` if approved, `false` if rejected.
 */
export function waitForApproval(sessionId: string, meta?: InterruptMeta): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
        pendingInterrupts.set(sessionId, { resolve, reject, meta });
    });
}

/**
 * Called by the server when user responds to the confirmation prompt.
 * Returns false if there was no pending interrupt for this session.
 */
export function resolveInterrupt(sessionId: string, approved: boolean, opts?: ResolveOptions): boolean {
    const pending = pendingInterrupts.get(sessionId);
    if (!pending) return false;

    // Record approval decision in audit log
    const meta = opts ?? pending.meta;
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

    pending.resolve(approved);
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
