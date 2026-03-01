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

interface PendingInterrupt {
    resolve: (approved: boolean) => void;
    reject: (err: Error) => void;
}

const pendingInterrupts = new Map<string, PendingInterrupt>();

/**
 * Called by the agent — suspends until the user responds.
 * Returns `true` if approved, `false` if rejected.
 */
export function waitForApproval(sessionId: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
        pendingInterrupts.set(sessionId, { resolve, reject });
    });
}

/**
 * Called by the server when user responds to the confirmation prompt.
 * Returns false if there was no pending interrupt for this session.
 */
export function resolveInterrupt(sessionId: string, approved: boolean): boolean {
    const pending = pendingInterrupts.get(sessionId);
    if (!pending) return false;
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
        pending.reject(new Error('Client disconnected during interrupt'));
        pendingInterrupts.delete(sessionId);
    }
}

/** Check whether a session has a pending interrupt waiting for user response. */
export function hasPendingInterrupt(sessionId: string): boolean {
    return pendingInterrupts.has(sessionId);
}
