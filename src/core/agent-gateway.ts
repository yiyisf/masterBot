import type { FastifyInstance } from 'fastify';
import type { Logger } from '../types.js';

export interface AgentManifest {
    id: string;
    name: string;
    description: string;
    capabilities: string[];
    version: string;
}

interface RegisteredWorker {
    agent: any;
    manifest: AgentManifest;
}

/**
 * Agent 网关 — 为每个 Worker Agent 暴露标准 HTTP 端点
 * POST /agents/:workerId/run    — 接收任务，返回结果
 * GET  /agents/:workerId/manifest — 返回 Agent 能力描述
 * GET  /agents — 列出所有注册的 Worker Agent
 */
export class AgentGateway {
    private workers = new Map<string, RegisteredWorker>();

    constructor(private logger: Logger) {}

    /**
     * 注册一个 Worker Agent
     */
    register(workerId: string, agent: any, manifest: AgentManifest): void {
        this.workers.set(workerId, { agent, manifest });
        this.logger.info(`[AgentGateway] Registered worker: ${workerId}`);
    }

    /**
     * 将路由挂载到 Fastify 实例（/agents 前缀）
     */
    registerRoutes(app: FastifyInstance): void {
        // List all workers
        app.get('/agents', async () => {
            return Array.from(this.workers.entries()).map(([workerId, w]) => ({
                ...w.manifest,
                id: workerId,
                online: true,
            }));
        });

        // Get manifest
        app.get<{ Params: { workerId: string } }>('/agents/:workerId/manifest', async (request, reply) => {
            const worker = this.workers.get(request.params.workerId);
            if (!worker) {
                reply.status(404);
                return { error: 'Worker not found' };
            }
            return worker.manifest;
        });

        // Run a task on a worker
        app.post<{ Params: { workerId: string }; Body: { prompt: string; sessionId?: string; context?: any } }>(
            '/agents/:workerId/run',
            async (request, reply) => {
                const worker = this.workers.get(request.params.workerId);
                if (!worker) {
                    reply.status(404);
                    return { error: 'Worker not found' };
                }

                const { prompt, sessionId, context } = request.body;
                if (!prompt) {
                    reply.status(400);
                    return { error: 'Missing prompt' };
                }

                try {
                    this.logger.info(`[AgentGateway] Running task on worker ${request.params.workerId}`);
                    const result = await worker.agent.execute(prompt, { sessionId, ...context });
                    return { success: true, answer: result.answer, steps: result.steps };
                } catch (err: any) {
                    reply.status(500);
                    return { error: err.message };
                }
            }
        );
    }

    /**
     * 获取已注册的所有 worker 列表（供 multi-agent 内部调用）
     */
    getWorkerIds(): string[] {
        return Array.from(this.workers.keys());
    }

    /**
     * 直接调用 worker（本地模式，不走 HTTP）
     */
    async runLocal(workerId: string, prompt: string, options?: any): Promise<any> {
        const worker = this.workers.get(workerId);
        if (!worker) throw new Error(`Worker "${workerId}" not found`);
        return worker.agent.execute(prompt, options ?? {});
    }
}
