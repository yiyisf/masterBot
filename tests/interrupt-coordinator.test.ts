/**
 * P2: Human-in-the-Loop interrupt 协调器测试
 * 覆盖：布尔审批 / 文本应答（ask_user）/ abortSignal 释放 / 断连取消
 */

import { describe, it, expect } from 'vitest';
import {
    waitForApproval,
    waitForUserDecision,
    resolveInterrupt,
    cancelInterrupt,
    hasPendingInterrupt,
} from '../src/core/interrupt-coordinator.js';
import { db } from '../src/core/database.js';

function lastSessionEvent(sessionId: string, type: string): { payload: string } | undefined {
    return db.prepare(
        'SELECT payload FROM session_events WHERE session_id = ? AND type = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(sessionId, type) as { payload: string } | undefined;
}

describe('interrupt-coordinator', () => {
    it('waitForApproval 由 resolveInterrupt(approved=true) 释放', async () => {
        const p = waitForApproval('sess-a');
        expect(hasPendingInterrupt('sess-a')).toBe(true);
        expect(resolveInterrupt('sess-a', true)).toBe(true);
        await expect(p).resolves.toBe(true);
        expect(hasPendingInterrupt('sess-a')).toBe(false);
    });

    it('waitForUserDecision 携带文本应答（ask_user 场景）', async () => {
        const p = waitForUserDecision('sess-b', { actionName: 'ask_user' });
        expect(resolveInterrupt('sess-b', true, { response: '用 PostgreSQL' })).toBe(true);
        await expect(p).resolves.toEqual({ approved: true, response: '用 PostgreSQL' });
    });

    it('resolveInterrupt 对无挂起的 session 返回 false', () => {
        expect(resolveInterrupt('sess-none', true)).toBe(false);
    });

    it('abortSignal 触发时挂起的等待被 reject 并清理', async () => {
        const controller = new AbortController();
        const p = waitForUserDecision('sess-c', undefined, controller.signal);
        controller.abort();
        await expect(p).rejects.toThrow(/Aborted/);
        expect(hasPendingInterrupt('sess-c')).toBe(false);
    });

    it('cancelInterrupt（断连）reject 挂起的等待', async () => {
        const p = waitForApproval('sess-d');
        cancelInterrupt('sess-d');
        await expect(p).rejects.toThrow(/disconnected/i);
        expect(hasPendingInterrupt('sess-d')).toBe(false);
    });

    // 研发流程管理：interrupt 双写 session_events（回放）+ audit_approvals（审计台账，已有测试覆盖 resolveInterrupt 返回值）
    it('resolveInterrupt 追加一条 interrupt_resolved session_events（spec §6.2）', async () => {
        const p = waitForUserDecision('sess-e', { interruptId: 'int-e' });
        resolveInterrupt('sess-e', true, { interruptId: 'int-e', response: '用 PostgreSQL' });
        await p;

        const event = lastSessionEvent('sess-e', 'interrupt_resolved');
        expect(event).toBeDefined();
        const payload = JSON.parse(event!.payload);
        expect(payload).toMatchObject({ interruptId: 'int-e', approved: true, response: '用 PostgreSQL' });
    });

    it('cancelInterrupt 追加一条 interrupt_resolved session_events（标注 cancelled）', async () => {
        const p = waitForApproval('sess-f', { interruptId: 'int-f' });
        cancelInterrupt('sess-f');
        await expect(p).rejects.toThrow();

        const event = lastSessionEvent('sess-f', 'interrupt_resolved');
        expect(event).toBeDefined();
        const payload = JSON.parse(event!.payload);
        expect(payload).toMatchObject({ interruptId: 'int-f', approved: false, cancelled: true });
    });
});
