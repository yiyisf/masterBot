/**
 * AgentHarness — Agent 执行容器
 * Phase 23: Managed Agents Harness
 *
 * 在 Agent.run() 外包裹一层：
 * - 工具权限过滤（通过 FilteredSkillRegistry）
 * - 生命周期 Hook 执行
 * - 资源超时熔断
 * - Outcome Grader 修订循环
 * - 实例状态追踪
 */

import { nanoid } from 'nanoid';
import { Agent } from '../agent.js';
import { Grader } from './grader.js';
import { HookRunner, type HookContext } from './hook-runner.js';
import type { AgentSpec, AgentLifecycleState } from './agent-spec.js';
import type { GraderResult } from './outcome-spec.js';
import type {
    LLMAdapter,
    Logger,
    ExecutionStep,
    MemoryAccess,
    Message,
} from '../../types.js';
import { type SkillRegistry } from '../../skills/registry.js';
import type { LongTermMemory } from '../../memory/long-term.js';
import type { MemoryRouter } from '../../memory/memory-router.js';

export interface HarnessExecutionContext {
    sessionId: string;
    userId?: string;
    memory: MemoryAccess;
    history?: Message[];
    abortSignal?: AbortSignal;
    traceId?: string;
    /** 父 Agent 实例 ID（用于追踪委派链）*/
    parentInstanceId?: string;
}

export class AgentHarness {
    readonly instanceId: string;
    private state: AgentLifecycleState = 'queued';
    private stepCount = 0;
    private lastScore?: number;
    private startedAt: Date = new Date();
    private completedAt?: Date;
    private error?: string;

    private agent: Agent;
    private grader: Grader;
    private hookRunner: HookRunner;

    constructor(
        readonly spec: AgentSpec,
        private getLLM: (provider?: string) => LLMAdapter,
        baseRegistry: SkillRegistry,
        private logger: Logger,
        longTermMemory?: LongTermMemory,
        memoryRouter?: MemoryRouter,
        private pauseSignal?: { paused: boolean }
    ) {
        this.instanceId = nanoid(12);

        // 构建权限过滤视图
        const filteredRegistry = baseRegistry.createFilteredView(
            spec.tools.allow,
            spec.tools.deny
        );

        // Agent 使用过滤后的 registry，maxIterations 遵守 spec 约束
        // llm 使用函数形式，保持热更新能力（config 切换提供商后生效）
        this.agent = new Agent({
            llm: () => getLLM(spec.resources?.preferredProvider),
            skillRegistry: filteredRegistry,
            logger: this.createScopedLogger(),
            maxIterations: spec.resources.maxIterations,
            longTermMemory,
            memoryRouter,
        });

        this.grader = new Grader(getLLM, logger);

        this.hookRunner = new HookRunner(
            logger,
            // notify stub — 实际由 GatewayServer 注入
            undefined,
            // approve stub — 实际由 interrupt-coordinator 注入
            undefined
        );
    }

    // ─────────────────────────────────────────────────
    // 公开 API
    // ─────────────────────────────────────────────────

    getState(): AgentLifecycleState { return this.state; }
    getStepCount(): number { return this.stepCount; }
    getLastScore(): number | undefined { return this.lastScore; }
    getStartedAt(): Date { return this.startedAt; }
    getCompletedAt(): Date | undefined { return this.completedAt; }
    getError(): string | undefined { return this.error; }

    pause(): void {
        if (this.state === 'running') {
            this.state = 'paused';
            if (this.pauseSignal) this.pauseSignal.paused = true;
        }
    }

    resume(): void {
        if (this.state === 'paused') {
            this.state = 'running';
            if (this.pauseSignal) this.pauseSignal.paused = false;
        }
    }

    cancel(): void {
        this.state = 'cancelled';
    }

    // ─────────────────────────────────────────────────
    // 主执行循环（含 Outcome 修订）
    // ─────────────────────────────────────────────────

    async *execute(
        task: string,
        context: HarnessExecutionContext
    ): AsyncGenerator<ExecutionStep> {
        this.state = 'running';
        this.startedAt = new Date();

        const hookCtx: HookContext = {
            instanceId: this.instanceId,
            specId: this.spec.id,
            specName: this.spec.name,
            sessionId: context.sessionId,
            task,
        };

        // onStart hooks
        await this.hookRunner.run(this.spec.hooks.onStart ?? [], hookCtx);

        const maxRevisions = this.spec.outcome?.grader.maxRevisions ?? 0;
        let revision = 0;
        let currentTask = task;
        let lastOutput = '';

        // 超时控制
        const timeoutMs = this.spec.resources.timeoutMs;
        const deadlineMs = Date.now() + timeoutMs;

        try {
            while (true) {
                if (this.getState() === 'cancelled') break;

                // 检查超时
                if (Date.now() > deadlineMs) {
                    yield this.makeStep('meta', `⏱ Agent [${this.spec.name}] 已超时（${timeoutMs / 1000}s）`);
                    break;
                }

                revision++;

                // ── 执行 Agent ──
                for await (const step of this.agent.run(currentTask, {
                    sessionId: context.sessionId,
                    userId: context.userId,
                    memory: context.memory,
                    history: revision === 1 ? (context.history ?? []) : [],
                    abortSignal: context.abortSignal,
                    traceId: context.traceId,
                })) {
                    if (this.getState() === 'cancelled') break;

                    // 等待暂停恢复
                    while (this.getState() === 'paused') {
                        await new Promise(r => setTimeout(r, 200));
                    }

                    // onToolCall hooks
                    if (step.type === 'action') {
                        const stepCtx = { ...hookCtx, step };
                        try {
                            await this.hookRunner.run(this.spec.hooks.onToolCall ?? [], stepCtx);
                        } catch (err) {
                            // approve-denied → 跳过本次工具调用，告知 Agent
                            yield this.makeStep('observation', `🚫 工具调用被拒绝: ${(err as Error).message.replace('[approve-denied] ', '')}`);
                            continue;
                        }
                    }

                    // 携带 instanceId 标记来源
                    const enriched: ExecutionStep = { ...step, delegatedFrom: this.spec.id };
                    yield enriched;
                    this.stepCount++;

                    // onToolResult hooks
                    if (step.type === 'observation') {
                        await this.hookRunner.run(this.spec.hooks.onToolResult ?? [], { ...hookCtx, step });
                    }

                    if (step.type === 'answer') {
                        lastOutput = step.content ?? '';
                    }
                }

                if (this.getState() === 'cancelled') break;

                // ── 无 Outcome 定义：直接结束 ──
                if (!this.spec.outcome) break;

                // ── Grader 评分 ──
                yield this.makeStep('grading', `⚖️ 正在评估第 ${revision} 次输出...`);
                const graderResult: GraderResult = await this.grader.evaluate(
                    task,
                    lastOutput,
                    this.spec.outcome,
                    revision
                );
                this.lastScore = graderResult.overallScore;

                yield {
                    type: 'grade_result',
                    content: JSON.stringify(graderResult),
                    timestamp: new Date(),
                } as ExecutionStep;

                if (graderResult.status === 'satisfied') break;

                if (graderResult.status === 'failed' || graderResult.status === 'grader_error') {
                    if (graderResult.status === 'failed') {
                        throw new Error(`[Grader] 任务质量评估失败: ${graderResult.feedback}`);
                    }
                    break;  // grader_error 不影响 Agent 结果，接受当前输出
                }

                if (revision > maxRevisions) {
                    yield this.makeStep('meta', `🔄 已达到最大修订次数 ${maxRevisions}，以当前输出为最终结果`);
                    break;
                }

                // needs_revision：注入 Grader 反馈重试
                const failedCriteria = graderResult.criteriaResults
                    .filter(r => !r.passed && r.suggestions)
                    .map(r => `• [${r.criterionId}] ${r.suggestions}`)
                    .join('\n');

                currentTask = `${task}

--- Grader 对上次回答的改进要求（请修订后重新作答）---
${graderResult.feedback}

${failedCriteria ? `各维度具体问题：\n${failedCriteria}` : ''}`;

                yield this.makeStep('meta', `🔄 评分 ${graderResult.overallScore}/100，正在根据 Grader 建议进行第 ${revision + 1} 次修订...`);
            }

            this.state = 'completed';
            this.completedAt = new Date();
            await this.hookRunner.run(this.spec.hooks.onComplete ?? [], hookCtx);

        } catch (err) {
            this.state = 'failed';
            this.completedAt = new Date();
            this.error = (err as Error).message;
            await this.hookRunner.run(this.spec.hooks.onError ?? [], { ...hookCtx, error: err as Error });
            throw err;
        }
    }

    // ─────────────────────────────────────────────────
    // 工具方法
    // ─────────────────────────────────────────────────

    private makeStep(type: ExecutionStep['type'], content: string): ExecutionStep {
        return { type, content, timestamp: new Date() };
    }

    private createScopedLogger(): Logger {
        const prefix = `[${this.spec.name}:${this.instanceId.slice(0, 6)}]`;
        return {
            debug: (msg: string, ...args: any[]) => this.logger.debug(`${prefix} ${msg}`, ...args),
            info: (msg: string, ...args: any[]) => this.logger.info(`${prefix} ${msg}`, ...args),
            warn: (msg: string, ...args: any[]) => this.logger.warn(`${prefix} ${msg}`, ...args),
            error: (msg: string, ...args: any[]) => this.logger.error(`${prefix} ${msg}`, ...args),
        };
    }
}
