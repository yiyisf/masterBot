import type { FastifyInstance } from 'fastify';
import { requirementRepository, type RequirementStatus } from '../../core/requirement-repository.js';
import { requirementSyncService } from '../../core/requirement-sync-service.js';
import type { GatewayDeps } from '../route-deps.js';

/**
 * 研发流程管理模块：需求同步 / 手动创建 / 列表路由。
 * 实施地图 #61 ticket #63（同步层）；发起研发/重试/取消/回答中断/核验合并等路由留给执行层 ticket。
 */
export async function registerRequirementRoutes(app: FastifyInstance, deps: GatewayDeps): Promise<void> {
    // 手动触发同步（spec §2.5：仅手动触发，不做定时任务）
    app.post<{ Params: { id: string } }>('/api/projects/:id/sync', async (request, reply) => {
        try {
            const result = await requirementSyncService.syncProject(request.params.id);
            return result;
        } catch (error: any) {
            deps.logger.error(`Sync project error: ${error.message}`);
            if (error.message?.startsWith('Project not found')) {
                reply.status(404);
                return { error: error.message };
            }
            reply.status(500);
            return { error: error.message };
        }
    });

    // 手动创建需求
    app.post<{ Params: { id: string }; Body: { title: string; description?: string; labels?: string[] } }>(
        '/api/projects/:id/requirements',
        async (request, reply) => {
            const { title, description, labels } = request.body ?? {};
            if (!title) {
                reply.status(400);
                return { error: 'Missing required field: title' };
            }
            try {
                const requirement = requirementSyncService.createManualRequirement(request.params.id, { title, description, labels });
                reply.status(201);
                return requirement;
            } catch (error: any) {
                deps.logger.error(`Create manual requirement error: ${error.message}`);
                if (error.message?.startsWith('Project not found')) {
                    reply.status(404);
                    return { error: error.message };
                }
                reply.status(500);
                return { error: error.message };
            }
        }
    );

    // 列出项目下的需求（可选按状态过滤，对应状态看板列）
    app.get<{ Params: { id: string }; Querystring: { status?: string } }>(
        '/api/projects/:id/requirements',
        async (request) => {
            const status = request.query.status as RequirementStatus | undefined;
            return requirementRepository.listByProject(request.params.id, status ? { status } : undefined);
        }
    );

    app.get<{ Params: { id: string } }>('/api/requirements/:id', async (request, reply) => {
        const requirement = requirementRepository.getById(request.params.id);
        if (!requirement) { reply.status(404); return { error: 'Requirement not found' }; }
        return requirement;
    });
}
