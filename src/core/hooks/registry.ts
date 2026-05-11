/**
 * Phase 2: HookRegistry
 * 管理 Hook 注册、优先级排序、顺序执行。
 * Pipeline 遇到 abort:true 立即停止。
 */

import type {
    HookEvent,
    HookEventType,
    HookFn,
    HookRegistration,
    HookResult,
} from './types.js';

export class HookRegistry {
    /** eventType → sorted hook list */
    private readonly hooks = new Map<HookEventType, HookRegistration[]>();

    register<E extends HookEvent>(reg: HookRegistration<E>): void {
        const list = this.hooks.get(reg.eventType) ?? [];
        list.push(reg as unknown as HookRegistration);
        list.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
        this.hooks.set(reg.eventType, list);
    }

    unregister(id: string): void {
        for (const [type, list] of this.hooks) {
            const next = list.filter(r => r.id !== id);
            if (next.length === 0) this.hooks.delete(type);
            else this.hooks.set(type, next);
        }
    }

    /**
     * 按优先级顺序执行同类型 hooks。
     * 返回最终（可能经修改的）事件和是否中止标志。
     */
    async run<E extends HookEvent>(event: E): Promise<{ event: E; aborted: boolean }> {
        const list = this.hooks.get(event.type as HookEventType) ?? [];
        let current = event;

        for (const reg of list) {
            let result: HookResult | void;
            try {
                result = await (reg.fn as HookFn<E>)(current);
            } catch (err) {
                // Hook 内部错误不中止主流程，仅记录
                console.error(`[HookRegistry] hook "${reg.id}" threw:`, err);
                continue;
            }

            if (!result) continue;

            if (result.abort) {
                return { event: current, aborted: true };
            }

            if (result.modified) {
                current = { ...current, ...result.modified } as E;
            }
        }

        return { event: current, aborted: false };
    }

    /** 仅用于测试：清空所有 hooks */
    clear(): void {
        this.hooks.clear();
    }

    /** 返回已注册 hook 数量（按事件类型） */
    stats(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const [type, list] of this.hooks) {
            out[type] = list.length;
        }
        return out;
    }
}

/** 全局默认 HookRegistry 单例 */
export const globalHookRegistry = new HookRegistry();
