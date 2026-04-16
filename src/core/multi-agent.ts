import type { Logger, Message, ExecutionStep, MemoryAccess, LLMAdapter } from '../types.js';
import { Agent } from './agent.js';

export interface WorkerAgentConfig {
    id: string;
    name: string;
    systemPrompt: string;
    skills?: string[];  // skill name filter (empty = all)
    description?: string;
}

export interface DelegationResult {
    workerId: string;
    workerName: string;
    answer: string;
    steps: ExecutionStep[];
}

export interface DelegateContext {
    sessionId: string;
    userId?: string;
    memory: MemoryAccess;
    history?: Message[];
    abortSignal?: AbortSignal;
    traceId?: string;
}

/**
 * @deprecated Phase 28: MultiAgentOrchestrator 已进入渐进退役阶段。
 * delegate_to_agent 工具现优先走 AgentPool（Harness 路径），此类仅作回退用。
 * 新 Worker 请通过 SOUL.md 或 API 注册为 AgentSpec。
 * 计划在 Phase 30 确认无回退调用后完全移除此文件。
 *
 * Orchestrator that manages worker agents and delegates tasks
 * Phase 21: added delegateStream + supervisorDelegate
 */
export class MultiAgentOrchestrator {
    private workers: Map<string, Agent> = new Map();
    private workerConfigs: Map<string, WorkerAgentConfig> = new Map();
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Register a worker agent
     */
    registerWorker(config: WorkerAgentConfig, agent: Agent): void {
        this.workers.set(config.id, agent);
        this.workerConfigs.set(config.id, config);
        this.logger.info(`[multi-agent] Registered worker: ${config.name} (${config.id})`);
    }

    /**
     * Delegate a task to a specific worker (non-streaming, waits for full result)
     */
    async delegate(
        workerId: string,
        task: string,
        context: DelegateContext
    ): Promise<DelegationResult> {
        const worker = this.workers.get(workerId);
        const config = this.workerConfigs.get(workerId);

        if (!worker || !config) {
            throw new Error(`Worker agent "${workerId}" not found. Available workers: ${Array.from(this.workerConfigs.keys()).join(', ')}`);
        }

        this.logger.info(`[multi-agent] Delegating to ${config.name}: ${task.substring(0, 100)}`);

        const result = await worker.execute(task, context);

        return {
            workerId,
            workerName: config.name,
            answer: result.answer,
            steps: result.steps,
        };
    }

    /**
     * 流式委托 — Phase 21
     * 将 Worker 的每个 ExecutionStep 实时 yield 给父 Agent
     */
    async *delegateStream(
        workerId: string,
        task: string,
        context: DelegateContext
    ): AsyncGenerator<ExecutionStep> {
        const worker = this.workers.get(workerId);
        const config = this.workerConfigs.get(workerId);

        if (!worker || !config) {
            throw new Error(`Worker agent "${workerId}" not found. Available workers: ${Array.from(this.workerConfigs.keys()).join(', ')}`);
        }

        this.logger.info(`[multi-agent] Stream-delegating to ${config.name}: ${task.substring(0, 100)}`);

        for await (const step of worker.run(task, context)) {
            // 携带 delegatedFrom 标记，前端可区分来源
            yield { ...step, delegatedFrom: workerId } as ExecutionStep;
        }
    }

    /**
     * Supervisor 模式 — Phase 21
     * 让 LLM 根据 Worker 描述自动选择最佳 Worker，再委托
     */
    async supervisorDelegate(
        task: string,
        context: DelegateContext,
        llmAdapter: LLMAdapter
    ): Promise<DelegationResult> {
        const descriptions = this.getWorkerDescriptions();

        const prompt = `你是一个任务路由器。根据以下可用 Worker 的描述，为任务选择最合适的 Worker。

可用 Workers:
${descriptions}

任务: ${task.substring(0, 500)}

请直接回复最合适的 Worker ID（一个单词，不加任何解释）:`;

        const response = await llmAdapter.chat([{ role: 'user', content: prompt }]);
        const rawContent = typeof response.content === 'string'
            ? response.content
            : (response.content as Array<{ type: string; text?: string }>)
                .filter(p => p.type === 'text').map(p => p.text ?? '').join('');

        const workerId = rawContent.trim().split(/[\s\n]/)[0].trim();
        this.logger.info(`[multi-agent] Supervisor selected worker: ${workerId}`);

        return this.delegate(workerId, task, context);
    }

    /**
     * Get list of registered workers for the LLM
     */
    getWorkerDescriptions(): string {
        if (this.workers.size === 0) return '(no workers registered)';
        return Array.from(this.workerConfigs.values())
            .map(w => `- ${w.id}: ${w.name} — ${(w.description || w.systemPrompt).substring(0, 200)}`)
            .join('\n');
    }

    /**
     * List all worker configs
     */
    listWorkers(): WorkerAgentConfig[] {
        return Array.from(this.workerConfigs.values());
    }

    hasWorkers(): boolean {
        return this.workers.size > 0;
    }
}
