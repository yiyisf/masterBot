import type { SkillContext, Logger } from '../types.js';
import { SkillRegistry } from '../skills/registry.js';
import { TaskRepository } from './task-repository.js';

export interface DAGStepResult {
    type: 'task_completed' | 'task_failed';
    taskId: string;
    description: string;
    result?: string;
    error?: string;
}

const MAX_ROUNDS = 50;

/**
 * DAG parallel execution engine
 * Executes ready tasks in parallel, respecting dependency ordering
 */
export class DAGExecutor {
    private sessionId: string;
    private skillRegistry: SkillRegistry;
    private skillContext: SkillContext;
    private logger: Logger;
    private taskRepo: TaskRepository;

    constructor(
        sessionId: string,
        skillRegistry: SkillRegistry,
        skillContext: SkillContext,
        logger: Logger,
        taskRepo?: TaskRepository,
    ) {
        this.sessionId = sessionId;
        this.skillRegistry = skillRegistry;
        this.skillContext = skillContext;
        this.logger = logger;
        this.taskRepo = taskRepo ?? new TaskRepository();
    }

    async *execute(): AsyncGenerator<DAGStepResult> {
        let round = 0;

        while (round < MAX_ROUNDS) {
            round++;
            const readyTasks = this.taskRepo.getReadyTasks(this.sessionId);

            if (readyTasks.length === 0) {
                this.logger.info(`DAG execution complete after ${round - 1} rounds`);
                break;
            }

            this.logger.info(`DAG round ${round}: executing ${readyTasks.length} tasks`);

            // Mark all as running
            for (const task of readyTasks) {
                this.taskRepo.updateStatus(task.id, 'running');
            }

            // Execute in parallel
            const results = await Promise.allSettled(
                readyTasks.map(async (task) => {
                    return { taskId: task.id, description: task.description, result: await this.executeTask(task.description) };
                })
            );

            // Process results
            for (const settledResult of results) {
                if (settledResult.status === 'fulfilled') {
                    const { taskId, description, result } = settledResult.value;
                    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
                    this.taskRepo.updateStatus(taskId, 'completed', resultStr);
                    yield { type: 'task_completed', taskId, description, result: resultStr };
                } else {
                    // Find the taskId from the original tasks
                    const idx = results.indexOf(settledResult);
                    const task = readyTasks[idx];
                    const errorMsg = settledResult.reason?.message || String(settledResult.reason);
                    this.taskRepo.updateStatus(task.id, 'failed', errorMsg);
                    yield { type: 'task_failed', taskId: task.id, description: task.description, error: errorMsg };
                }
            }
        }

        if (round >= MAX_ROUNDS) {
            this.logger.warn(`DAG execution hit max rounds (${MAX_ROUNDS})`);
        }
    }

    /**
     * Execute a single task by parsing its description as a tool call JSON
     * Format: {"tool":"skill.action","params":{...}}
     */
    private async executeTask(description: string): Promise<unknown> {
        try {
            const parsed = JSON.parse(description);
            if (parsed.tool && parsed.params) {
                return await this.skillRegistry.executeAction(parsed.tool, parsed.params, this.skillContext);
            }
        } catch {
            // Not JSON — treat as plain text description, return as-is
        }
        return `Task noted: ${description}`;
    }
}
