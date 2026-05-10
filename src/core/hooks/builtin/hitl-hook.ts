/**
 * Task 5b: HitL (Human-in-the-Loop) Hook
 * 在 PermissionRequest 事件时调用 waitForApproval 挂起执行。
 */

import type { PermissionRequestEvent, HookResult } from '../types.js';
import { waitForApproval } from '../../interrupt-coordinator.js';

export async function hitlHook(event: PermissionRequestEvent): Promise<HookResult | void> {
    const approved = await waitForApproval(event.ctx.sessionId, {
        actionName: event.toolName,
        dangerReason: event.reason,
    });

    // 通知注册的 resolve 回调
    event.resolve(approved);

    if (!approved) {
        return { abort: true };
    }
}
