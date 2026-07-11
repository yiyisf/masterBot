import type { FastifyInstance } from 'fastify';
import { projectRepository } from '../../core/project-repository.js';
import type { GatewayDeps } from '../route-deps.js';

/**
 * 研发流程管理模块：项目（Project）CRUD 路由。
 * 实施地图 #61 ticket #62（数据层）；需求同步/发起研发等路由在后续 ticket 中补充。
 */
export async function registerProjectRoutes(app: FastifyInstance, deps: GatewayDeps): Promise<void> {
    app.get('/api/projects', async () => {
        return projectRepository.list();
    });

    app.get<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
        const project = projectRepository.getById(request.params.id);
        if (!project) { reply.status(404); return { error: 'Project not found' }; }
        return project;
    });

    app.post<{
        Body: {
            name: string;
            dir: string;
            description?: string;
            syncSource?: string;
            syncConfig?: Record<string, unknown>;
            maxConcurrentRuns?: number;
        };
    }>('/api/projects', async (request, reply) => {
        const { name, dir, description, syncSource, syncConfig, maxConcurrentRuns } = request.body ?? {};
        if (!name || !dir) {
            reply.status(400);
            return { error: 'Missing required fields: name, dir' };
        }
        if (projectRepository.getByName(name)) {
            reply.status(409);
            return { error: `Project name "${name}" already exists` };
        }
        try {
            const project = projectRepository.create({ name, dir, description, syncSource, syncConfig, maxConcurrentRuns });
            reply.status(201);
            return project;
        } catch (error: any) {
            deps.logger.error(`Create project error: ${error.message}`);
            reply.status(500);
            return { error: error.message };
        }
    });

    app.patch<{
        Params: { id: string };
        Body: {
            dir?: string;
            description?: string;
            syncSource?: string;
            syncConfig?: Record<string, unknown>;
            maxConcurrentRuns?: number;
        };
    }>('/api/projects/:id', async (request, reply) => {
        try {
            const project = projectRepository.update(request.params.id, request.body ?? {});
            if (!project) { reply.status(404); return { error: 'Project not found' }; }
            return project;
        } catch (error: any) {
            deps.logger.error(`Update project error: ${error.message}`);
            reply.status(500);
            return { error: error.message };
        }
    });

    app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
        const deleted = projectRepository.delete(request.params.id);
        if (!deleted) { reply.status(404); return { error: 'Project not found' }; }
        return { success: true };
    });
}
