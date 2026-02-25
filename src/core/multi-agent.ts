import type { Logger, Message, ExecutionStep, MemoryAccess } from '../types.js';
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

/**
 * Orchestrator that manages worker agents and delegates tasks
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
     * Delegate a task to a specific worker
     */
    async delegate(
        workerId: string,
        task: string,
        context: {
            sessionId: string;
            userId?: string;
            memory: MemoryAccess;
            history?: Message[];
            abortSignal?: AbortSignal;
        }
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
     * Get list of registered workers for the LLM
     */
    getWorkerDescriptions(): string {
        if (this.workers.size === 0) return '(no workers registered)';
        return Array.from(this.workerConfigs.values())
            .map(w => `- ${w.id}: ${w.name} — ${w.description || w.systemPrompt.substring(0, 80)}`)
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
