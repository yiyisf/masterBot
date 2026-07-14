import type { FastifyInstance } from 'fastify';
import { requirementRepository, type RequirementStatus, type AnalysisSpec } from '../../core/requirement-repository.js';
import { requirementRunRepository } from '../../core/requirement-run-repository.js';
import { requirementSyncService } from '../../core/requirement-sync-service.js';
import { requirementExecutionService, type ExecutionEngineKind } from '../../core/requirement-execution-service.js';
import { pendingQuestionsRepository } from '../../core/pending-questions-repository.js';
import { sessionEventStore } from '../../core/harness/session-store.js';
import type { GatewayDeps } from '../route-deps.js';

/**
 * 研发流程管理模块：需求同步 / 手动创建 / 列表 / 发起研发 / 重试 / 取消 / 核验合并 /
 * run 查询 / 执行时间线路由。实施地图 #61 ticket #63（同步层）+ #64（执行层基座）+
 * #67（前端配套补齐后端）。回答中断复用既有 `/api/sessions/:id/interrupt-response`
 * （键控用的就是 requirement_run.session_id）。
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

    // 发起研发（默认 claude-code 引擎，可选 codex/opencode/pi；点火即走，异步执行，状态变化通过 requirement/run 轮询）
    app.post<{ Params: { id: string }; Body: { engine?: ExecutionEngineKind; approvalMode?: 'auto' | 'ask-on-risky' } }>(
        '/api/requirements/:id/start',
        async (request, reply) => {
            try {
                const result = await requirementExecutionService.start(request.params.id, {
                    engine: request.body?.engine,
                    approvalMode: request.body?.approvalMode,
                });
                reply.status(202);
                return result;
            } catch (error: any) {
                deps.logger.error(`Start requirement execution error: ${error.message}`);
                if (error.message?.startsWith('Requirement not found') || error.message?.startsWith('Project not found')) {
                    reply.status(404);
                    return { error: error.message };
                }
                if (error.message?.includes('startable state')) {
                    reply.status(409);
                    return { error: error.message };
                }
                reply.status(500);
                return { error: error.message };
            }
        }
    );

    // ─────────────────────────── 两阶段自动化（spec #85）───────────────────────────

    // 发起需求分析阶段；reanalyze=true 显式重新分析（作废尚未 implemented 的卡片）
    app.post<{ Params: { id: string }; Body: { engine?: ExecutionEngineKind; approvalMode?: 'auto' | 'ask-on-risky'; reanalyze?: boolean } }>(
        '/api/requirements/:id/analysis',
        async (request, reply) => {
            try {
                const result = await requirementExecutionService.startAnalysis(request.params.id, {
                    engine: request.body?.engine,
                    approvalMode: request.body?.approvalMode,
                    reanalyze: request.body?.reanalyze,
                });
                reply.status(202);
                return result;
            } catch (error: any) {
                deps.logger.error(`Start analysis error: ${error.message}`);
                if (error.message?.startsWith('Requirement not found') || error.message?.startsWith('Project not found')) {
                    reply.status(404);
                    return { error: error.message };
                }
                if (error.message?.includes('analyzable state') || error.message?.includes('cannot be reanalyzed')) {
                    reply.status(409);
                    return { error: error.message };
                }
                reply.status(500);
                return { error: error.message };
            }
        }
    );

    // 核验通过后发起（或从失败卡续跑）拆卡实现阶段
    app.post<{ Params: { id: string }; Body: { engine?: ExecutionEngineKind; approvalMode?: 'auto' | 'ask-on-risky' } }>(
        '/api/requirements/:id/implementation',
        async (request, reply) => {
            try {
                const result = await requirementExecutionService.startImplementation(request.params.id, {
                    engine: request.body?.engine,
                    approvalMode: request.body?.approvalMode,
                });
                reply.status(202);
                return result;
            } catch (error: any) {
                deps.logger.error(`Start implementation error: ${error.message}`);
                if (error.message?.startsWith('Requirement not found') || error.message?.startsWith('Project not found')) {
                    reply.status(404);
                    return { error: error.message };
                }
                if (error.message?.includes('implementable state') || error.message?.includes('no cards')) {
                    reply.status(409);
                    return { error: error.message };
                }
                reply.status(500);
                return { error: error.message };
            }
        }
    );

    // 核验阶段编辑分析规格
    app.patch<{ Params: { id: string }; Body: AnalysisSpec }>('/api/requirements/:id/analysis-spec', async (request, reply) => {
        const requirement = requirementRepository.getById(request.params.id);
        if (!requirement) { reply.status(404); return { error: 'Requirement not found' }; }
        requirementRepository.updateAnalysisSpec(request.params.id, request.body ?? {});
        return requirementRepository.getById(request.params.id);
    });

    // 该需求当前（最新）的待回答问题集，waiting_input 时供页面渲染问答表单
    app.get<{ Params: { id: string } }>('/api/requirements/:id/pending-questions', async (request) => {
        return pendingQuestionsRepository.getLatestByRequirement(request.params.id) ?? null;
    });

    // 卡片列表（核验阶段编辑、实现阶段查看进度共用）
    app.get<{ Params: { id: string } }>('/api/requirements/:id/cards', async (request) => {
        return requirementRepository.listCardsByParent(request.params.id);
    });

    // 核验阶段手动添加一张卡片（追加到末尾）
    app.post<{ Params: { id: string }; Body: { title: string } }>('/api/requirements/:id/cards', async (request, reply) => {
        const title = request.body?.title?.trim();
        if (!title) { reply.status(400); return { error: 'Missing required field: title' }; }
        const parent = requirementRepository.getById(request.params.id);
        if (!parent) { reply.status(404); return { error: 'Requirement not found' }; }
        const existing = requirementRepository.listCardsByParent(parent.id);
        const cardNo = existing.length > 0 ? Math.max(...existing.map(c => c.cardNo ?? 0)) + 1 : 1;
        const card = requirementRepository.createCard({
            parentId: parent.id, projectId: parent.projectId,
            reqKey: `${parent.reqKey}-card-${cardNo}`, source: 'manual', sourceKey: `card-${cardNo}`,
            title, cardNo,
        });
        reply.status(201);
        return card;
    });

    // 核验阶段编辑卡片标题 / 调整顺序
    app.patch<{ Params: { id: string; cardId: string }; Body: { title?: string; cardNo?: number } }>(
        '/api/requirements/:id/cards/:cardId',
        async (request, reply) => {
            const card = requirementRepository.getById(request.params.cardId);
            if (!card || card.parentId !== request.params.id) { reply.status(404); return { error: 'Card not found' }; }
            if (request.body?.title !== undefined) requirementRepository.updateCardTitle(card.id, request.body.title);
            if (request.body?.cardNo !== undefined) requirementRepository.updateCardOrder(card.id, request.body.cardNo);
            return requirementRepository.getById(card.id);
        }
    );

    // 核验阶段删除一张尚未执行的卡片
    app.delete<{ Params: { id: string; cardId: string } }>('/api/requirements/:id/cards/:cardId', async (request, reply) => {
        const card = requirementRepository.getById(request.params.cardId);
        if (!card || card.parentId !== request.params.id) { reply.status(404); return { error: 'Card not found' }; }
        requirementRepository.deleteCard(card.id);
        return { success: true };
    });

    // 人工「跳过此卡」：标记 cancelled，之后调用 /implementation 会自然跳过它继续下一张
    app.post<{ Params: { id: string; cardId: string } }>('/api/requirements/:id/cards/:cardId/skip', async (request, reply) => {
        try {
            requirementExecutionService.skipCard(request.params.cardId);
            return requirementRepository.getById(request.params.cardId);
        } catch (error: any) {
            deps.logger.error(`Skip card error: ${error.message}`);
            if (error.message?.startsWith('Card not found')) {
                reply.status(404);
                return { error: error.message };
            }
            if (error.message?.includes('is not a card') || error.message?.includes('already terminal')) {
                reply.status(409);
                return { error: error.message };
            }
            reply.status(500);
            return { error: error.message };
        }
    });

    // run 列表与详情（执行记录回放的入口，静态浏览用）
    app.get<{ Params: { id: string } }>('/api/requirements/:id/runs', async (request) => {
        return requirementRunRepository.listByRequirement(request.params.id);
    });

    // 某次 run 的执行时间线（session_events 静态回放，不做实时节奏动画，spec §6.2）
    app.get<{ Params: { id: string; runId: string } }>(
        '/api/requirements/:id/runs/:runId/events',
        async (request, reply) => {
            const run = requirementRunRepository.getById(request.params.runId);
            if (!run || run.requirementId !== request.params.id) {
                reply.status(404);
                return { error: 'Run not found' };
            }
            return { events: sessionEventStore.getEvents(run.sessionId) };
        }
    );

    // 失败重试（默认复用同一 worktree 现场，沿用上次引擎，spec §4.1/§4.4）
    app.post<{ Params: { id: string }; Body: { approvalMode?: 'auto' | 'ask-on-risky' } }>(
        '/api/requirements/:id/retry',
        async (request, reply) => {
            try {
                const result = await requirementExecutionService.retry(request.params.id, {
                    approvalMode: request.body?.approvalMode,
                });
                reply.status(202);
                return result;
            } catch (error: any) {
                deps.logger.error(`Retry requirement execution error: ${error.message}`);
                if (error.message?.startsWith('Requirement not found') || error.message?.startsWith('Project not found')
                    || error.message?.startsWith('No previous run found')) {
                    reply.status(404);
                    return { error: error.message };
                }
                if (error.message?.includes('retryable state')) {
                    reply.status(409);
                    return { error: error.message };
                }
                reply.status(500);
                return { error: error.message };
            }
        }
    );

    // 人工中止执行中的需求
    app.post<{ Params: { id: string } }>('/api/requirements/:id/cancel', async (request, reply) => {
        try {
            await requirementExecutionService.cancel(request.params.id);
            return { success: true };
        } catch (error: any) {
            deps.logger.error(`Cancel requirement execution error: ${error.message}`);
            if (error.message?.startsWith('Requirement not found') || error.message?.startsWith('No run found')) {
                reply.status(404);
                return { error: error.message };
            }
            if (error.message?.includes('cancellable state')) {
                reply.status(409);
                return { error: error.message };
            }
            reply.status(500);
            return { error: error.message };
        }
    });

    // 两阶段自动化统一回答入口（spec #85）：页面提交回答后，平台按引擎能力自动分派——
    // claude-code 原生中断走内存 Promise，非交互引擎走 resume_token 续接；页面全程不感知引擎。
    app.post<{ Params: { id: string }; Body: { answers: string[] } }>('/api/requirements/:id/answers', async (request, reply) => {
        try {
            const answers = request.body?.answers;
            if (!Array.isArray(answers) || answers.length === 0) {
                reply.status(400);
                return { error: 'Missing required field: answers (non-empty array)' };
            }
            await requirementExecutionService.submitAnswers(request.params.id, answers);
            return { success: true };
        } catch (error: any) {
            deps.logger.error(`Submit answers error: ${error.message}`);
            if (error.message?.startsWith('Requirement not found') || error.message?.startsWith('Project not found')
                || error.message?.startsWith('No pending question set') || error.message?.startsWith('No run found')) {
                reply.status(404);
                return { error: error.message };
            }
            if (error.message?.includes('waiting for input') || error.message?.includes('no resumable session')) {
                reply.status(409);
                return { error: error.message };
            }
            reply.status(500);
            return { error: error.message };
        }
    });

    // 人工核验通过、PR 已在 GitHub 上合并后调用：标记需求完成 + 自动清理 worktree（spec §4.3）
    app.post<{ Params: { id: string } }>('/api/requirements/:id/merge', async (request, reply) => {
        try {
            await requirementExecutionService.merge(request.params.id);
            return { success: true };
        } catch (error: any) {
            deps.logger.error(`Merge requirement error: ${error.message}`);
            if (error.message?.startsWith('Requirement not found') || error.message?.startsWith('Project not found')) {
                reply.status(404);
                return { error: error.message };
            }
            if (error.message?.includes('mergeable state')) {
                reply.status(409);
                return { error: error.message };
            }
            reply.status(500);
            return { error: error.message };
        }
    });
}
