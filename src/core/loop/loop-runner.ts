/**
 * LoopRunner — 目标驱动自治循环引擎（U15: Loop Engineering）
 *
 * 组合既有原语执行 LoopSpec：
 *
 *   ┌─→ 预算检查（轮数/步数/墙钟）──熔断──→ onStall
 *   │      ↓
 *   │   任务发现 discover（可选；为空 = 目标达成）
 *   │      ↓
 *   │   执行 execute（AgentPool spec 或注入的 runTask）
 *   │      ↓
 *   │   确定性验证 verify（测试/编译/API 状态——ground truth）
 *   │      ↓ 全过
 *   │   LLM Grader 兜底（可选，处理模糊准则）
 *   │      ↓ satisfied → 目标达成，结束
 *   └── 失败 → 反馈注入下轮任务；停滞检测（同一失败签名连续 N 轮 → onStall）
 *
 * 安全底线：预算熔断 + 停滞检测 + onStall 升级人工，防 runaway loop。
 */

import type { ExecutionStep, Logger, ToolResult } from '../../types.js';
import type { LoopSpec } from './loop-spec.js';
import { runVerifiers } from './verifier.js';
import type { Grader } from '../harness/grader.js';

export interface LoopRunnerDeps {
    logger: Logger;
    /**
     * 任务执行函数：每轮调用一次。
     * 生产环境由集成方桥接到 AgentPool（spawn + streamInstance）或主 Agent；
     * 测试中可注入 stub。
     */
    runTask: (task: string, iteration: number) => AsyncGenerator<ExecutionStep>;
    /** 验证器的工具执行通道（通常桥接 ISkillRegistry.executeAction）*/
    executeTool: (tool: string, params: Record<string, unknown>) => Promise<ToolResult>;
    /** LLM 评分兜底（spec.grader 配置时必传）*/
    grader?: Grader;
    /** 停滞/预算耗尽升级回调（通常桥接 InterruptCoordinator / IM 通知）*/
    escalate?: (reason: string, spec: LoopSpec) => Promise<void>;
}

export type LoopOutcome =
    | 'goal_achieved'        // 验证通过（或发现队列清空）
    | 'stalled'              // 停滞熔断
    | 'budget_exhausted'     // 预算耗尽
    | 'cancelled';           // 外部取消

export interface LoopRunResult {
    outcome: LoopOutcome;
    iterations: number;
    totalSteps: number;
    elapsedMs: number;
    lastOutput: string;
}

export class LoopRunner {
    private _result?: LoopRunResult;

    constructor(
        private spec: LoopSpec,
        private deps: LoopRunnerDeps
    ) {}

    getResult(): LoopRunResult | undefined {
        return this._result;
    }

    async *run(opts?: { abortSignal?: AbortSignal }): AsyncGenerator<ExecutionStep> {
        const { spec, deps } = this;
        const startMs = Date.now();
        const maxIterations = spec.budgets?.maxIterations ?? 10;
        const maxSteps = spec.budgets?.maxSteps ?? 500;
        const deadlineMs = startMs + (spec.budgets?.maxWallClockMin ?? 60) * 60_000;
        const noProgressThreshold = spec.stall?.noProgressRounds ?? 3;

        let totalSteps = 0;
        let lastOutput = '';
        let feedback = '';
        let lastFailureSignature = '';
        let sameFailureRounds = 0;
        let iteration = 0;

        const finish = (outcome: LoopOutcome): LoopRunResult => {
            this._result = {
                outcome,
                iterations: iteration,
                totalSteps,
                elapsedMs: Date.now() - startMs,
                lastOutput,
            };
            return this._result;
        };

        yield this._meta(`🔁 Loop [${spec.name ?? spec.id}] 启动 — 目标: ${spec.goal}`);

        while (iteration < maxIterations) {
            if (opts?.abortSignal?.aborted) {
                yield this._meta('⏹ Loop 已被外部取消');
                finish('cancelled');
                return;
            }

            // ── 预算检查 ──
            if (Date.now() > deadlineMs) {
                yield* this._stall('墙钟预算耗尽', finish('budget_exhausted'));
                return;
            }
            if (totalSteps >= maxSteps) {
                yield* this._stall(`步数预算耗尽（${totalSteps}/${maxSteps}）`, finish('budget_exhausted'));
                return;
            }

            iteration++;
            yield this._meta(`🔄 Loop 第 ${iteration}/${maxIterations} 轮`);

            // ── 任务发现 ──
            let discovered = '';
            if (spec.discover) {
                const res = await this._safeTool(spec.discover.tool, spec.discover.params ?? {});
                if (res.kind === 'ok') {
                    discovered = res.value.trim();
                    const emptyish = discovered === '' || discovered === '[]' || discovered === '{}'
                        || /^(none|empty|无|没有)/i.test(discovered);
                    if (emptyish && spec.discover.emptyMeansDone !== false) {
                        yield this._meta('✅ 任务发现结果为空 — 目标已达成');
                        yield this._answer(`目标「${spec.goal}」已达成：待处理任务队列为空。`);
                        finish('goal_achieved');
                        return;
                    }
                    yield this._step('observation', `📋 发现待处理任务:\n${discovered.slice(0, 1500)}`);
                } else {
                    yield this._meta(`⚠️ 任务发现失败（${res.message}），本轮跳过 discover 直接执行`);
                }
            }

            // ── 执行 ──
            const task = this._buildTask(discovered, feedback, iteration);
            for await (const step of deps.runTask(task, iteration)) {
                if (opts?.abortSignal?.aborted) break;
                yield step;
                totalSteps++;
                if (step.type === 'answer') lastOutput = step.content ?? '';
            }

            // ── 确定性验证 ──
            if (spec.verify && spec.verify.length > 0) {
                yield this._meta(`🔍 正在运行 ${spec.verify.length} 项确定性验证...`);
                const report = await runVerifiers(spec.verify, deps.executeTool, deps.logger);

                const summary = report.results
                    .map(r => `${r.passed ? '✓' : '✗'} ${r.name}: ${r.detail}`)
                    .join('\n');
                yield this._step('observation', `验证报告（${report.allPassed ? '全部通过' : '存在失败'}）:\n${summary}`);

                if (!report.allPassed) {
                    // 停滞检测：同一失败签名连续出现
                    if (report.failureSignature === lastFailureSignature) {
                        sameFailureRounds++;
                    } else {
                        lastFailureSignature = report.failureSignature;
                        sameFailureRounds = 1;
                    }
                    if (sameFailureRounds >= noProgressThreshold) {
                        yield* this._stall(
                            `同一验证失败连续 ${sameFailureRounds} 轮无进展（${report.failureSignature}）`,
                            finish('stalled')
                        );
                        return;
                    }

                    feedback = report.results
                        .filter(r => !r.passed)
                        .map(r => `- ${r.name}: ${r.detail}`)
                        .join('\n');
                    continue;
                }

                // 验证全过：重置停滞计数
                sameFailureRounds = 0;
                lastFailureSignature = '';
            }

            // ── LLM Grader 兜底（模糊准则）──
            if (spec.grader && deps.grader) {
                yield this._step('grading', '⚖️ 确定性验证通过，正在进行 LLM 兜底评分...');
                const graderResult = await deps.grader.evaluate(spec.goal, lastOutput, spec.grader, iteration);
                yield this._step('grade_result', JSON.stringify(graderResult));

                if (graderResult.status !== 'satisfied' && graderResult.status !== 'grader_error') {
                    feedback = graderResult.feedback;
                    continue;
                }
            }

            // 验证（+评分）全部通过 → 目标达成
            yield this._meta(`✅ Loop 目标达成（第 ${iteration} 轮，累计 ${totalSteps} steps）`);
            if (lastOutput) yield this._answer(lastOutput);
            finish('goal_achieved');
            return;
        }

        yield* this._stall(`已达最大轮数 ${maxIterations}`, finish('budget_exhausted'));
    }

    // ─────────────────────────────── private ───────────────────────────────

    private _buildTask(discovered: string, feedback: string, iteration: number): string {
        const template = this.spec.execute.promptTemplate
            ?? '目标：{{goal}}\n\n{{discovered}}{{feedback}}';
        return template
            .replace(/\{\{goal\}\}/g, this.spec.goal)
            .replace(/\{\{discovered\}\}/g, discovered ? `待处理任务：\n${discovered}\n\n` : '')
            .replace(/\{\{feedback\}\}/g, feedback ? `上一轮验证失败，需修复：\n${feedback}\n\n` : '')
            .replace(/\{\{iteration\}\}/g, String(iteration));
    }

    private async _safeTool(tool: string, params: Record<string, unknown>): Promise<ToolResult> {
        try {
            return await this.deps.executeTool(tool, params);
        } catch (err) {
            return { kind: 'error', message: (err as Error).message, retryable: false };
        }
    }

    private async *_stall(reason: string, result: LoopRunResult): AsyncGenerator<ExecutionStep> {
        const action = this.spec.onStall ?? 'escalate';
        this.deps.logger.warn(`[loop:${this.spec.id}] Stalled: ${reason} (onStall=${action})`);

        if (action === 'escalate') {
            yield {
                type: 'interrupt',
                content: `🚨 Loop [${this.spec.name ?? this.spec.id}] 停滞，已升级人工处理：${reason}`,
                interruptReason: reason,
                timestamp: new Date(),
            };
            if (this.deps.escalate) {
                try {
                    await this.deps.escalate(reason, this.spec);
                } catch (err) {
                    this.deps.logger.error(`[loop:${this.spec.id}] Escalation failed: ${(err as Error).message}`);
                }
            }
        } else {
            yield this._meta(`⏹ Loop 停止（${reason}，outcome: ${result.outcome}）`);
        }
    }

    private _meta(content: string): ExecutionStep {
        return { type: 'meta', content, timestamp: new Date() };
    }

    private _answer(content: string): ExecutionStep {
        return { type: 'answer', content, timestamp: new Date() };
    }

    private _step(type: ExecutionStep['type'], content: string): ExecutionStep {
        return { type, content, timestamp: new Date() };
    }
}
