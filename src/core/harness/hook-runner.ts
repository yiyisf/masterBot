/**
 * HookRunner — 生命周期钩子执行引擎
 * Phase 23: Managed Agents Harness
 *
 * 支持 log / approve / notify / shell 四类 Hook。
 * approve 类型会调用 interrupt-coordinator 挂起等待人工确认。
 */

import { spawn } from 'child_process';
import type { Logger } from '../../types.js';
import type { HookDef } from './agent-spec.js';
import type { ExecutionStep } from '../../types.js';

export interface HookContext {
    instanceId: string;
    specId: string;
    specName: string;
    sessionId: string;
    task?: string;
    step?: ExecutionStep;
    error?: Error;
}

export class HookRunner {
    constructor(
        private logger: Logger,
        private notifyFn?: (channel: string, message: string) => Promise<void>,
        private approveFn?: (reason: string, context: HookContext) => Promise<boolean>
    ) {}

    /**
     * 执行一组 Hook。
     * approve 类型若被拒绝则抛出 Error（阻断后续操作）。
     */
    async run(hooks: HookDef[], context: HookContext): Promise<void> {
        for (const hook of hooks) {
            try {
                await this.runOne(hook, context);
            } catch (err) {
                // approve 拒绝是有意为之，直接上抛
                if ((err as Error).message?.startsWith('[approve-denied]')) throw err;
                this.logger.warn(`[hook-runner] Hook ${hook.type} failed: ${(err as Error).message}`);
            }
        }
    }

    private async runOne(hook: HookDef, context: HookContext): Promise<void> {
        switch (hook.type) {
            case 'log': {
                const level = hook.config.level ?? 'info';
                const msg = hook.config.message
                    ? this.interpolate(hook.config.message, context)
                    : `[${context.specName}] ${context.step?.type ?? 'event'}: ${context.step?.content?.slice(0, 100) ?? ''}`;
                this.logger[level](msg);
                break;
            }

            case 'approve': {
                if (!this.approveFn) {
                    this.logger.warn(`[hook-runner] approve hook has no approveFn, auto-allow`);
                    break;
                }
                const toolName = context.step?.toolName ?? '';
                const pattern = hook.config.pattern;
                if (!this.matchGlob(toolName, pattern)) break;  // 不匹配则跳过

                const message = hook.config.message
                    ? this.interpolate(hook.config.message, context)
                    : `Agent [${context.specName}] 即将调用工具 ${toolName}，请确认`;

                const approved = await this.approveFn(message, context);
                if (!approved) {
                    throw new Error(`[approve-denied] 用户拒绝了工具调用: ${toolName}`);
                }
                break;
            }

            case 'notify': {
                if (!this.notifyFn) {
                    this.logger.warn(`[hook-runner] notify hook has no notifyFn`);
                    break;
                }
                const message = this.interpolate(hook.config.template, context);
                await this.notifyFn(hook.config.channel, message);
                break;
            }

            case 'shell': {
                const command = this.interpolate(hook.config.command, context);
                await this.runShell(command, hook.config.timeout ?? 10_000);
                break;
            }
        }
    }

    private interpolate(template: string, ctx: HookContext): string {
        return template
            .replace(/\{\{instanceId\}\}/g, ctx.instanceId)
            .replace(/\{\{specName\}\}/g, ctx.specName)
            .replace(/\{\{task\}\}/g, ctx.task?.slice(0, 200) ?? '')
            .replace(/\{\{error\}\}/g, ctx.error?.message ?? '')
            .replace(/\{\{toolName\}\}/g, ctx.step?.toolName ?? '');
    }

    private matchGlob(name: string, pattern: string): boolean {
        const regex = new RegExp(
            '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
        );
        return regex.test(name);
    }

    private runShell(command: string, timeoutMs: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn(process.platform === 'win32' ? 'cmd' : '/bin/sh',
                process.platform === 'win32' ? ['/c', command] : ['-c', command],
                { stdio: 'ignore' }
            );
            const timer = setTimeout(() => { child.kill(); reject(new Error(`shell hook timed out: ${command}`)); }, timeoutMs);
            child.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) resolve();
                else reject(new Error(`shell hook exited with code ${code}: ${command}`));
            });
            child.on('error', (err) => { clearTimeout(timer); reject(err); });
        });
    }
}
