import type { ExecutionStep } from '../../types.js';

/**
 * 单读者推送式异步队列，桥接回调式代码（SDK 的 `canUseTool` / MCP 工具 handler，
 * 均在 `run()` 的 async generator 主循环之外被 SDK 内部调用，无法直接 `yield`）
 * 与 `run()` 的 for-await 主循环——回调侧 `push()` 一个 interrupt 步骤，
 * 主循环侧 `next()` 拿到后继续 `yield` 给调用方。
 */
export class InterruptRelay {
    private queue: ExecutionStep[] = [];
    private waiting: Array<(step: ExecutionStep) => void> = [];

    push(step: ExecutionStep): void {
        const waiter = this.waiting.shift();
        if (waiter) {
            waiter(step);
        } else {
            this.queue.push(step);
        }
    }

    next(): Promise<ExecutionStep> {
        const step = this.queue.shift();
        if (step) return Promise.resolve(step);
        return new Promise(resolve => this.waiting.push(resolve));
    }
}
