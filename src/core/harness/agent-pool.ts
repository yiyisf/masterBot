/**
 * AgentPool — Agent 实例池
 * Phase 23: Managed Agents Harness
 * Phase 24: Session 持久化 + Wake 协议
 *
 * 管理 AgentSpec 注册和 AgentHarness 实例的完整生命周期：
 * - 并发控制（per-spec concurrency limit）
 * - 排队（超过并发上限时入队）
 * - 实例 CRUD 及步骤缓存（内存 + SQLite 双写）
 * - Wake 协议：任意实例崩溃后可从 session_events 恢复
 * - 自动 cleanup（超过阈值时回收已完成实例）
 */

import { AgentHarness, type HarnessExecutionContext } from './agent-harness.js';
import { defaultAgentSpec, type AgentSpec, type AgentInstanceInfo, type AgentLifecycleState } from './agent-spec.js';
import { agentBus } from './agent-bus.js';
import { SessionEventStore } from './session-store.js';
import { CredentialVault } from './credential-vault.js';
import type { LLMAdapter, Logger, ExecutionStep } from '../../types.js';
import type { SkillRegistry } from '../../skills/registry.js';
import type { LongTermMemory } from '../../memory/long-term.js';
import type { MemoryRouter } from '../../memory/memory-router.js';

export { SessionEventStore, CredentialVault };

interface QueueItem {
    specId: string;
    task: string;
    context: HarnessExecutionContext;
    resolve: (harness: AgentHarness) => void;
    reject: (err: Error) => void;
}

export class AgentPool {
    private specs = new Map<string, AgentSpec>();
    private instances = new Map<string, AgentHarness>();
    private steps = new Map<string, ExecutionStep[]>();
    private runningCount = new Map<string, number>();
    private queue: QueueItem[] = [];

    constructor(
        private getLLM: (provider?: string) => LLMAdapter,
        private baseRegistry: SkillRegistry,
        private logger: Logger,
        private longTermMemory?: LongTermMemory,
        private memoryRouter?: MemoryRouter,
        private sessionStore?: SessionEventStore,
        private credentialVault?: CredentialVault
    ) {}

    // ─────────────────────────────────────────────────
    // Spec 管理
    // ─────────────────────────────────────────────────

    registerSpec(spec: AgentSpec): void {
        this.specs.set(spec.id, spec);
        this.logger.info(`[agent-pool] Registered spec: ${spec.name} (${spec.id})`);
    }

    unregisterSpec(id: string): void {
        this.specs.delete(id);
    }

    getSpec(id: string): AgentSpec | undefined {
        return this.specs.get(id);
    }

    listSpecs(): AgentSpec[] {
        return Array.from(this.specs.values());
    }

    /** 兼容旧 WorkerAgentConfig 格式，转换为 AgentSpec 并注册 */
    registerLegacyWorker(id: string, name: string, description: string, systemPrompt: string, skills?: string[]): void {
        const spec = defaultAgentSpec({
            id,
            name,
            description,
            systemPrompt,
            tools: skills && skills.length > 0
                ? { allow: skills.map(s => `${s}.*`), deny: [] }
                : { allow: [], deny: [] },
        });
        this.registerSpec(spec);
    }

    // ─────────────────────────────────────────────────
    // 实例管理
    // ─────────────────────────────────────────────────

    /**
     * 创建并启动一个 Agent 实例。
     * 若 spec 并发已满，进入排队（返回 Promise 等待调度）。
     * 返回 instanceId，调用方通过 streamInstance() 消费步骤。
     */
    async spawn(
        specId: string,
        task: string,
        context: HarnessExecutionContext
    ): Promise<string> {
        const spec = this.specs.get(specId);
        if (!spec) throw new Error(`AgentPool: spec "${specId}" not found`);

        const running = this.runningCount.get(specId) ?? 0;
        if (running >= spec.resources.concurrency) {
            // 入队等待
            return new Promise((resolve, reject) => {
                this.queue.push({
                    specId, task, context,
                    resolve: (harness) => resolve(harness.instanceId),
                    reject,
                });
                this.logger.info(`[agent-pool] Queued task for spec ${specId} (running=${running}/${spec.resources.concurrency})`);
            });
        }

        return this.createInstance(spec, task, context);
    }

    private createInstance(spec: AgentSpec, task: string, context: HarnessExecutionContext): string {
        const sessionId = context.sessionId;

        // 为本 session 生成 opaque sessionToken（供 CredentialProxy 换凭证）
        const sessionToken = this.credentialVault?.generateSessionToken(sessionId) ?? sessionId;

        // 将 sessionToken 注入 HarnessExecutionContext（传给 AgentHarness → SkillContext）
        const enrichedContext: HarnessExecutionContext = {
            ...context,
            sessionToken,
        };

        // 构建 emitEvent 回调，绑定到当前 session
        const emitEvent = this.sessionStore
            ? (type: string, payload: Record<string, unknown>, causedBy?: string) => {
                return this.sessionStore!.append({
                    sessionId,
                    timestamp: Date.now(),
                    type: type as any,
                    payload,
                    causedBy,
                });
            }
            : undefined;

        const harness = new AgentHarness(
            spec,
            this.getLLM,
            this.baseRegistry,
            this.logger,
            this.longTermMemory,
            this.memoryRouter,
            undefined,
            emitEvent
        );

        this.instances.set(harness.instanceId, harness);
        this.steps.set(harness.instanceId, []);
        this.runningCount.set(spec.id, (this.runningCount.get(spec.id) ?? 0) + 1);

        this.logger.info(`[agent-pool] Spawned ${spec.name} instance ${harness.instanceId}`);

        // 异步驱动，步骤缓存到 steps map（使用含 sessionToken 的 enrichedContext）
        this.driveInstance(harness, task, enrichedContext).catch(err => {
            this.logger.error(`[agent-pool] Instance ${harness.instanceId} failed: ${err.message}`);
        });

        return harness.instanceId;
    }

    private async driveInstance(
        harness: AgentHarness,
        task: string,
        context: HarnessExecutionContext
    ): Promise<void> {
        const steps = this.steps.get(harness.instanceId)!;
        try {
            for await (const step of harness.execute(task, context)) {
                steps.push(step);
                // 广播实时步骤
                agentBus.publish(`agent.step.${harness.instanceId}`, step, harness.instanceId);
            }
            agentBus.publish(`agent.complete.${harness.instanceId}`, {
                instanceId: harness.instanceId,
                state: harness.getState(),
                lastScore: harness.getLastScore(),
            }, harness.instanceId);
        } catch (err) {
            agentBus.publish(`agent.error.${harness.instanceId}`, {
                instanceId: harness.instanceId,
                error: (err as Error).message,
            }, harness.instanceId);
        } finally {
            this.runningCount.set(harness.spec.id, Math.max(0, (this.runningCount.get(harness.spec.id) ?? 1) - 1));
            this.drainQueue(harness.spec.id);
            // 超过 200 个实例时自动回收旧实例，保留最近 100 个
            if (this.instances.size > 200) this.cleanup(100);
        }
    }

    /** 消费实例步骤流（实时订阅 AgentBus）*/
    async *streamInstance(instanceId: string): AsyncGenerator<ExecutionStep> {
        const harness = this.instances.get(instanceId);
        if (!harness) throw new Error(`Instance ${instanceId} not found`);

        // 先 yield 已缓存的步骤
        const cached = this.steps.get(instanceId) ?? [];
        for (const step of cached) yield step;

        // 订阅后续步骤
        if (harness.getState() === 'running' || harness.getState() === 'queued') {
            yield* this.subscribeToInstance(instanceId);
        }
    }

    private subscribeToInstance(instanceId: string): AsyncGenerator<ExecutionStep> {
        let resolve: ((value: IteratorResult<ExecutionStep>) => void) | null = null;
        const buffer: ExecutionStep[] = [];
        let done = false;

        const unsubStep = agentBus.subscribe(`agent.step.${instanceId}`, (msg) => {
            const step = msg.payload as ExecutionStep;
            if (resolve) { resolve({ value: step, done: false }); resolve = null; }
            else buffer.push(step);
        }, 'pool-stream');

        const cleanup = () => {
            if (done) return;
            done = true;
            unsubStep();
            unsubComplete();
            unsubError();
            // 通知等待中的 consumer 结束
            if (resolve) { resolve({ value: undefined as any, done: true }); resolve = null; }
        };

        // 必须先声明再赋值，避免 cleanup 引用未初始化的变量
        let unsubComplete: () => void;
        let unsubError: () => void;
        unsubComplete = agentBus.subscribe(`agent.complete.${instanceId}`, cleanup, 'pool-stream');
        unsubError = agentBus.subscribe(`agent.error.${instanceId}`, cleanup, 'pool-stream');

        return {
            [Symbol.asyncIterator]() { return this; },
            async next(): Promise<IteratorResult<ExecutionStep>> {
                if (buffer.length > 0) return { value: buffer.shift()!, done: false };
                if (done) return { value: undefined as any, done: true };
                return new Promise(r => { resolve = r; });
            },
            async return() { cleanup(); return { value: undefined as any, done: true }; },
            async throw(err?: unknown) { cleanup(); throw err; },
        } as AsyncGenerator<ExecutionStep>;
    }

    private drainQueue(specId: string): void {
        const spec = this.specs.get(specId);
        if (!spec) return;
        const running = this.runningCount.get(specId) ?? 0;
        if (running >= spec.resources.concurrency) return;

        const idx = this.queue.findIndex(q => q.specId === specId);
        if (idx === -1) return;

        const item = this.queue.splice(idx, 1)[0];
        const instanceId = this.createInstance(spec, item.task, item.context);
        item.resolve(this.instances.get(instanceId)!);
    }

    // ─────────────────────────────────────────────────
    // 生命周期控制
    // ─────────────────────────────────────────────────

    pause(instanceId: string): void {
        this.instances.get(instanceId)?.pause();
    }

    resume(instanceId: string): void {
        this.instances.get(instanceId)?.resume();
    }

    cancel(instanceId: string): void {
        this.instances.get(instanceId)?.cancel();
    }

    // ─────────────────────────────────────────────────
    // 查询
    // ─────────────────────────────────────────────────

    listInstances(): AgentInstanceInfo[] {
        return Array.from(this.instances.values()).map(h => ({
            instanceId: h.instanceId,
            specId: h.spec.id,
            specName: h.spec.name,
            state: h.getState(),
            task: '',   // task 存储在步骤中，此处省略
            revision: 0,
            startedAt: h.getStartedAt(),
            completedAt: h.getCompletedAt(),
            stepCount: h.getStepCount(),
            lastScore: h.getLastScore(),
            error: h.getError(),
        }));
    }

    getInstanceSteps(instanceId: string): ExecutionStep[] {
        return this.steps.get(instanceId) ?? [];
    }

    getInstance(instanceId: string): AgentHarness | undefined {
        return this.instances.get(instanceId);
    }

    /** 清理已完成/失败实例（保留最近 N 个）*/
    cleanup(keepLast = 50): void {
        const terminal: AgentLifecycleState[] = ['completed', 'failed', 'cancelled'];
        const done = Array.from(this.instances.entries())
            .filter(([, h]) => terminal.includes(h.getState()))
            .sort(([, a], [, b]) => (b.getCompletedAt()?.getTime() ?? 0) - (a.getCompletedAt()?.getTime() ?? 0));

        for (const [id] of done.slice(keepLast)) {
            this.instances.delete(id);
            this.steps.delete(id);
        }
    }

    // ─────────────────────────────────────────────────
    // Wake 协议（Phase 24）
    // ─────────────────────────────────────────────────

    /**
     * 从 session_events 日志恢复一个未完成的 Agent 实例（Gap 3 增强）。
     * - 使用 rebuildWakeContext() 检测悬挂 tool_call
     * - 将重建的消息历史注入到恢复的 Agent 实例
     */
    async wake(sessionId: string): Promise<string | null> {
        if (!this.sessionStore) return null;

        const ctx = this.sessionStore.rebuildWakeContext(sessionId);
        if (!ctx) {
            this.logger.warn(`[agent-pool] wake(${sessionId}): cannot rebuild context`);
            return null;
        }

        const spec = this.specs.get(ctx.specId);
        if (!spec) {
            this.logger.warn(`[agent-pool] wake(${sessionId}): spec "${ctx.specId}" not found, skipping`);
            return null;
        }

        this.logger.info(
            `[agent-pool] Waking session ${sessionId} (spec=${ctx.specId}, ` +
            `completedSteps=${ctx.completedSteps}, pendingToolCalls=${ctx.pendingToolCalls.length})`
        );

        // 写入 harness_wake 审计事件
        this.sessionStore.append({
            sessionId,
            timestamp: Date.now(),
            type: 'harness_wake',
            payload: {
                specId: ctx.specId,
                reason: 'startup_scan',
                completedSteps: ctx.completedSteps,
                pendingToolCalls: ctx.pendingToolCalls.map(p => p.toolName),
            },
        });

        return this.spawn(ctx.specId, ctx.originalTask, {
            sessionId,
            userId: ctx.userId,
            history: ctx.resumeHistory,
            memory: {
                get: async () => undefined,
                set: async () => {},
                search: async () => [],
            },
        });
    }

    /**
     * 启动时扫描所有未完成 session 并自动 wake。
     * 由 index.ts 在服务启动后调用。
     */
    async scanAndWake(): Promise<void> {
        if (!this.sessionStore) return;

        const unfinished = this.sessionStore.getUnfinished();
        if (unfinished.length === 0) return;

        this.logger.info(`[agent-pool] Found ${unfinished.length} unfinished session(s), attempting wake...`);
        for (const sessionId of unfinished) {
            await this.wake(sessionId).catch(err => {
                this.logger.warn(`[agent-pool] wake(${sessionId}) failed: ${(err as Error).message}`);
            });
        }
    }

    /**
     * 获取 sessionId 对应的持久化事件（跨重启可查询，支持 EventSelector 过滤）
     */
    getSessionEvents(sessionId: string, selector?: import('./session-store.js').EventSelector) {
        if (!this.sessionStore) return [];
        return selector
            ? this.sessionStore.getEvents(sessionId, selector)
            : this.sessionStore.getEvents(sessionId);
    }
}
