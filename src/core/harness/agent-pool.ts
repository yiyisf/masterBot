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
import type { SessionMemoryManager } from '../../memory/short-term.js';
import type { DatabaseSync } from 'node:sqlite';

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
        private credentialVault?: CredentialVault,
        private sessionMemoryManager?: SessionMemoryManager,
        private db?: DatabaseSync
    ) {}

    // ─────────────────────────────────────────────────
    // 持久化辅助（agent_instances 表）
    // ─────────────────────────────────────────────────

    private persistInstance(info: AgentInstanceInfo): void {
        if (!this.db) return;
        try {
            this.db.prepare(`
                INSERT INTO agent_instances
                    (id, spec_id, spec_name, state, task, started_at, completed_at, step_count, last_score, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    state        = excluded.state,
                    completed_at = excluded.completed_at,
                    step_count   = excluded.step_count,
                    last_score   = excluded.last_score,
                    error        = excluded.error
            `).run(
                info.instanceId,
                info.specId,
                info.specName,
                info.state,
                info.task ?? null,
                info.startedAt ? info.startedAt.getTime() : null,
                info.completedAt ? info.completedAt.getTime() : null,
                info.stepCount,
                info.lastScore ?? null,
                info.error ?? null,
            );
        } catch (err) {
            this.logger.warn(`[agent-pool] persistInstance failed: ${(err as Error).message}`);
        }
    }

    /** 从 DB 加载历史实例元数据（不在内存中的） */
    private loadHistoricalInstances(): AgentInstanceInfo[] {
        if (!this.db) return [];
        try {
            const liveIds = Array.from(this.instances.keys());
            const placeholders = liveIds.length > 0
                ? liveIds.map(() => '?').join(',')
                : "'__none__'";  // 避免空 IN () 导致 SQL 语法错误
            const rows = this.db.prepare(`
                SELECT id, spec_id, spec_name, state, task, started_at, completed_at,
                       step_count, last_score, error
                FROM agent_instances
                WHERE id NOT IN (${placeholders})
                ORDER BY started_at DESC
                LIMIT 200
            `).all(...(liveIds as import('node:sqlite').SQLInputValue[])) as Array<{
                id: string;
                spec_id: string;
                spec_name: string;
                state: string;
                task: string | null;
                started_at: number | null;
                completed_at: number | null;
                step_count: number;
                last_score: number | null;
                error: string | null;
            }>;
            return rows.map(r => ({
                instanceId: r.id,
                specId: r.spec_id,
                specName: r.spec_name,
                state: r.state as AgentLifecycleState,
                task: r.task ?? '',
                revision: 0,
                startedAt: r.started_at ? new Date(r.started_at) : new Date(0),
                completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
                stepCount: r.step_count,
                lastScore: r.last_score ?? undefined,
                error: r.error ?? undefined,
            }));
        } catch (err) {
            this.logger.warn(`[agent-pool] loadHistoricalInstances failed: ${(err as Error).message}`);
            return [];
        }
    }

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
            emitEvent,
            // M1: 透传 sessionStore，使 harness 下的 session_recall 工具可用
            this.sessionStore
        );

        this.instances.set(harness.instanceId, harness);
        this.steps.set(harness.instanceId, []);
        this.runningCount.set(spec.id, (this.runningCount.get(spec.id) ?? 0) + 1);

        this.logger.info(`[agent-pool] Spawned ${spec.name} instance ${harness.instanceId}`);

        // 持久化初始实例记录
        this.persistInstance({
            instanceId: harness.instanceId,
            specId: spec.id,
            specName: spec.name,
            state: 'running',
            task,
            revision: 0,
            startedAt: harness.getStartedAt(),
            completedAt: undefined,
            stepCount: 0,
            lastScore: undefined,
            error: undefined,
        });

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

        // LLM 流式 token 聚合缓冲：将连续的 type='content' chunk 合并为单条步骤，
        // 避免前端展示数百条碎片步骤（每个词一条）。
        let contentBuffer = '';
        let contentTimestamp: Date | null = null;

        const flushContent = () => {
            if (!contentBuffer) return;
            const merged: ExecutionStep = {
                type: 'content',
                content: contentBuffer,
                timestamp: contentTimestamp!,
            };
            steps.push(merged);
            agentBus.publish(`agent.step.${harness.instanceId}`, merged, harness.instanceId);
            contentBuffer = '';
            contentTimestamp = null;
        };

        const pushStep = (step: ExecutionStep) => {
            steps.push(step);
            agentBus.publish(`agent.step.${harness.instanceId}`, step, harness.instanceId);
        };

        try {
            for await (const step of harness.execute(task, context)) {
                if (step.type === 'content') {
                    // 累积流式 token，不逐 token 写入
                    if (!contentTimestamp) contentTimestamp = step.timestamp;
                    contentBuffer += step.content ?? '';
                } else {
                    // 非 content 步骤：先刷出已缓冲的内容，再推送当前步骤
                    flushContent();
                    pushStep(step);
                }
            }
            flushContent(); // 流结束时刷出剩余缓冲

            agentBus.publish(`agent.complete.${harness.instanceId}`, {
                instanceId: harness.instanceId,
                state: harness.getState(),
                lastScore: harness.getLastScore(),
            }, harness.instanceId);
            // 持久化最终状态
            this.persistInstance({
                instanceId: harness.instanceId,
                specId: harness.spec.id,
                specName: harness.spec.name,
                state: harness.getState(),
                task,
                revision: 0,
                startedAt: harness.getStartedAt(),
                completedAt: harness.getCompletedAt(),
                stepCount: steps.length,
                lastScore: harness.getLastScore(),
                error: harness.getError(),
            });
        } catch (err) {
            flushContent();
            agentBus.publish(`agent.error.${harness.instanceId}`, {
                instanceId: harness.instanceId,
                error: (err as Error).message,
            }, harness.instanceId);
            // 持久化失败状态
            this.persistInstance({
                instanceId: harness.instanceId,
                specId: harness.spec.id,
                specName: harness.spec.name,
                state: harness.getState(),
                task,
                revision: 0,
                startedAt: harness.getStartedAt(),
                completedAt: harness.getCompletedAt(),
                stepCount: steps.length,
                lastScore: harness.getLastScore(),
                error: harness.getError() ?? (err as Error).message,
            });
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
            lastActivity = Date.now();
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
            clearInterval(autoCleanupTimer);
            // 通知等待中的 consumer 结束
            if (resolve) { resolve({ value: undefined as any, done: true }); resolve = null; }
        };

        // D5: 10 分钟无新步骤自动 cleanup，防止订阅泄漏
        const AUTO_CLEANUP_MS = 10 * 60 * 1000;
        let lastActivity = Date.now();
        const autoCleanupTimer = setInterval(() => {
            if (Date.now() - lastActivity > AUTO_CLEANUP_MS) {
                this.logger.warn(`[agent-pool] subscribeToInstance(${instanceId}) auto-cleanup after inactivity`);
                cleanup();
            }
        }, 30_000);

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
        // 内存中的活跃/近期实例
        const live: AgentInstanceInfo[] = Array.from(this.instances.values()).map(h => ({
            instanceId: h.instanceId,
            specId: h.spec.id,
            specName: h.spec.name,
            state: h.getState(),
            task: '',
            revision: 0,
            startedAt: h.getStartedAt(),
            completedAt: h.getCompletedAt(),
            // 使用 pool 缓存的已合并步骤数（UI 显示的步骤），而非 harness 内部的
            // 流式 content chunk 计数（每个 token 块各自+1，会远大于实际步骤数）
            stepCount: this.steps.get(h.instanceId)?.length ?? h.getStepCount(),
            lastScore: h.getLastScore(),
            error: h.getError(),
        }));

        // 补充 DB 中历史记录（应用重启后仍可查看）
        const historical = this.loadHistoricalInstances();

        // 合并，去重（live 优先）
        const liveIds = new Set(live.map(i => i.instanceId));
        return [...live, ...historical.filter(i => !liveIds.has(i.instanceId))];
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

        // D3: 从 ShortTermMemory 重建 MemoryAccess（若无则创建空实现）
        const memory = this.sessionMemoryManager
            ? this.sessionMemoryManager.getSession(sessionId)
            : { get: async () => undefined, set: async () => {}, search: async () => [] };

        return this.spawn(ctx.specId, ctx.originalTask, {
            sessionId,
            userId: ctx.userId,
            history: ctx.resumeHistory,
            memory,
            trigger: 'wake_recovery',
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

    // ─────────────────────────────────────────────────
    // Phase 28: supervisorDelegate LLM 路由（从 MultiAgentOrchestrator 迁移）
    // ─────────────────────────────────────────────────

    /**
     * 通过 LLM 为任务选择最合适的 AgentSpec。
     * 从 MultiAgentOrchestrator.supervisorDelegate() 提取的路由逻辑。
     */
    async selectSpec(task: string, llm: LLMAdapter): Promise<string | null> {
        const specs = this.listSpecs();
        if (specs.length === 0) return null;

        const descriptions = specs
            .map(s => `- ${s.id}: ${s.name} — ${s.description.slice(0, 200)}`)
            .join('\n');

        const prompt = `根据以下可用 Agent 描述，为任务选择最合适的 Agent。
可用 Agents:\n${descriptions}\n
任务: ${task.slice(0, 500)}\n
直接回复 Agent ID（一个词）:`;

        const response = await llm.chat([{ role: 'user', content: prompt }]);
        const content = typeof response.content === 'string'
            ? response.content
            : (response.content as any[]).map(p => (p as any).text ?? '').join('');

        const specId = content.trim().split(/[\s\n]/)[0];
        return this.getSpec(specId) ? specId : null;
    }
}
