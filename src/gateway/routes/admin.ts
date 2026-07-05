import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { llmFactory } from '../../llm/index.js';
import { historyRepository } from '../../core/repository.js';
import { db } from '../../core/database.js';
import { auditRepository } from '../../core/audit-repository.js';
import type { GatewayDeps } from '../route-deps.js';

/**
 * 管理类路由：系统状态、模型/安全/Agent 配置、企业连接器、定时任务、
 * 自我改进事件、Token 用量、长期记忆管理、Prompt 模板库。
 * 从 server.ts 拆分而来（P0-4），逻辑与原实现保持一致，仅将 `this.x` 改为 `deps.x`。
 */
export async function registerAdminRoutes(app: FastifyInstance, deps: GatewayDeps): Promise<void> {
    // System status
    app.get('/api/status', async () => {
        const sessions = historyRepository.getSessions();
        const memoryCount = (() => {
            try { return (db.prepare('SELECT COUNT(*) as c FROM memories').get() as any)?.c ?? 0; } catch { return 0; }
        })();
        const knowledgeNodeCount = (() => {
            try { return (db.prepare('SELECT COUNT(*) as c FROM knowledge_nodes').get() as any)?.c ?? 0; } catch { return 0; }
        })();
        const activeScheduledTaskCount = (() => {
            try { return (db.prepare('SELECT COUNT(*) as c FROM scheduled_tasks WHERE enabled=1').get() as any)?.c ?? 0; } catch { return 0; }
        })();
        const recentImprovements = (() => {
            try { return db.prepare('SELECT * FROM improvement_events ORDER BY created_at DESC LIMIT 3').all(); } catch { return []; }
        })();

        return {
            status: 'active',
            version: '0.1.0',
            stats: {
                totalSessions: sessions.length,
                totalMessages: historyRepository.getTotalMessageCount(),
                skillCount: (await deps.agent.getSkillRegistry().getToolDefinitions()).length,
                memoryCount,
                knowledgeNodeCount,
                activeScheduledTaskCount,
            },
            sessions: sessions.map(s => ({
                id: s.id,
                title: s.title || s.first_msg || '新对话',
                updatedAt: s.updated_at
            })),
            llm: {
                provider: deps.agent.getLLMAdapter().provider,
            },
            recentImprovements,
        };
    });

    // ===== CONFIG MANAGEMENT =====

    // Model configuration (Read/Update)
    // apiKey values are masked in the response to prevent leaking credentials to the browser
    app.get('/api/config/models', async () => {
        const providers: Record<string, any> = {};
        for (const [name, cfg] of Object.entries(deps.config.models.providers)) {
            const p = cfg as any;
            providers[name] = {
                ...p,
                apiKey: p.apiKey ? p.apiKey.slice(0, 4) + '****' : '',
            };
        }
        return { ...deps.config.models, providers };
    });

    app.patch<{ Body: any }>('/api/config/models', async (request, reply) => {
        const newModelConfig = request.body as any;
        deps.config.models.default = newModelConfig.default;
        deps.config.models.providers = {
            ...deps.config.models.providers,
            ...newModelConfig.providers
        };
        llmFactory.clearCache();
        deps.logger.info(`LLM configuration hot-reloaded: ${deps.config.models.default}`);
        return { success: true, message: 'Configuration updated and hot-reloaded' };
    });

    // Test LLM provider connectivity with a minimal chat call
    app.post<{ Body: { providerName: string } }>('/api/config/models/test', async (request, reply) => {
        const { providerName } = request.body;
        deps.logger.info(`[config] Starting connectivity test for provider: ${providerName}`);

        const providerConfig = deps.config.models.providers[providerName];
        if (!providerConfig) {
            deps.logger.warn(`[config] Provider "${providerName}" not found in configuration`);
            reply.status(404); return { success: false, error: `Provider "${providerName}" not found` };
        }

        // Detailed debug logging
        const maskedKey = providerConfig.apiKey ? `${providerConfig.apiKey.slice(0, 4)}...${providerConfig.apiKey.slice(-4)}` : 'missing';
        deps.logger.info(`[config] Testing provider "${providerName}": baseUrl="${providerConfig.baseUrl}", model="${providerConfig.model}", type="${providerConfig.type}", apiKey=${maskedKey}`);

        try {
            const adapter = llmFactory.getAdapter(providerName, providerConfig);

            // Add 30s timeout to prevent hanging if the provider is unreachable
            const signal = AbortSignal.timeout(30000);

            const result = await adapter.chat(
                [{ role: 'user', content: 'Reply with "OK" only, no other text.' }],
                { maxTokens: 10, abortSignal: signal }
            );

            const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
            deps.logger.info(`[config] Connectivity test success for ${providerName}: ${content.trim()}`);
            return {
                success: true,
                response: content.trim(),
                debugInfo: {
                    baseUrl: providerConfig.baseUrl,
                    model: providerConfig.model,
                    apiKey: maskedKey
                }
            };
        } catch (err: any) {
            const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timeout');
            deps.logger.error(`[config] Connectivity test failed for ${providerName}${isTimeout ? ' (Timeout)' : ''}: ${err.message}`);
            return {
                success: false,
                error: isTimeout ? 'Request timed out (30s)' : err.message,
                debugInfo: {
                    baseUrl: providerConfig.baseUrl,
                    model: providerConfig.model,
                    apiKey: maskedKey
                }
            };
        }
    });

    // Security configuration (Read/Update)
    app.get('/api/config/security', async () => {
        return {
            sandbox: deps.config.skills.shell?.sandbox ?? { enabled: true, mode: 'blocklist' },
            auth: deps.config.auth ?? { enabled: false, mode: 'api-key' },
        };
    });

    app.patch<{ Body: { sandbox?: any; auth?: any } }>('/api/config/security', async (request, reply) => {
        const { sandbox, auth } = request.body;
        if (sandbox !== undefined) {
            if (!deps.config.skills.shell) deps.config.skills.shell = {};
            deps.config.skills.shell.sandbox = { ...deps.config.skills.shell?.sandbox, ...sandbox };
        }
        if (auth !== undefined) {
            deps.config.auth = { ...deps.config.auth, ...auth } as any;
        }
        deps.logger.info('[config] Security settings updated');
        return { success: true };
    });

    // Agent configuration (Read/Update)
    app.get('/api/config/agent', async () => {
        return deps.config.agent;
    });

    app.patch<{ Body: { maxIterations?: number; maxContextTokens?: number } }>('/api/config/agent', async (request, reply) => {
        const { maxIterations, maxContextTokens } = request.body;
        if (maxIterations !== undefined) deps.config.agent.maxIterations = Number(maxIterations);
        if (maxContextTokens !== undefined) deps.config.agent.maxContextTokens = Number(maxContextTokens);
        deps.logger.info(`[config] Agent settings updated: maxIterations=${deps.config.agent.maxIterations}, maxContextTokens=${deps.config.agent.maxContextTokens}`);
        return { success: true };
    });

    // ===== ENTERPRISE CONNECTORS =====
    app.get('/api/connectors', async () => {
        if (!deps.connectorManager) return [];
        return deps.connectorManager.listConfigs();
    });

    app.post<{ Body: any }>('/api/connectors', async (request, reply) => {
        if (!deps.connectorManager) { reply.status(503); return { error: 'Connector manager not available' }; }
        try {
            const config = request.body as any;
            deps.connectorManager.save(config);
            // Register the new source
            const { ConnectorSkillSource } = await import('../../skills/connector-source.js');
            const source = new ConnectorSkillSource(config, deps.logger);
            await source.initialize();
            await deps.agent.getSkillRegistry().registerSource(source);
            return { success: true };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.delete<{ Params: { name: string } }>('/api/connectors/:name', async (request, reply) => {
        if (!deps.connectorManager) { reply.status(503); return { error: 'Connector manager not available' }; }
        try {
            deps.connectorManager.delete(request.params.name);
            return { success: true };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    // ===== SCHEDULED TASKS =====
    app.get('/api/scheduled-tasks', async () => {
        if (!deps.scheduler) return [];
        return deps.scheduler.getTasks();
    });

    app.post<{ Body: any }>('/api/scheduled-tasks', async (request, reply) => {
        if (!deps.scheduler) { reply.status(503); return { error: 'Scheduler not available' }; }
        try {
            const { name, cronExpr, prompt, sessionId, enabled } = request.body as any;
            const id = deps.scheduler.createTask({ name, cronExpr, prompt, sessionId, enabled: enabled !== false });
            return { success: true, id };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.patch<{ Params: { id: string }; Body: any }>('/api/scheduled-tasks/:id', async (request, reply) => {
        if (!deps.scheduler) { reply.status(503); return { error: 'Scheduler not available' }; }
        try {
            deps.scheduler.updateTask(request.params.id, request.body);
            return { success: true };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.delete<{ Params: { id: string } }>('/api/scheduled-tasks/:id', async (request, reply) => {
        if (!deps.scheduler) { reply.status(503); return { error: 'Scheduler not available' }; }
        try {
            deps.scheduler.deleteTask(request.params.id);
            return { success: true };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.post<{ Params: { id: string } }>('/api/scheduled-tasks/:id/trigger', async (request, reply) => {
        if (!deps.scheduler) { reply.status(503); return { error: 'Scheduler not available' }; }
        try {
            const task = deps.scheduler.getTask(request.params.id);
            if (!task) { reply.status(404); return { error: 'Task not found' }; }
            const { nanoid: nanoidFn } = await import('nanoid');
            const sessionId = task.sessionId || nanoidFn();
            const memory = deps.sessionManager.getSession(sessionId);

            // Create audit run record for manual trigger
            const runId = auditRepository.createScheduledRun({
                scheduledTaskId: task.id,
                taskName: task.name,
                cronExpr: task.cronExpr,
                sessionId,
                triggerType: 'manual',
                prompt: task.prompt,
            });
            const manualStartMs = Date.now();

            // Run async
            deps.agent.execute(task.prompt, { sessionId, memory }).then(({ answer }) => {
                auditRepository.updateScheduledRun(runId, {
                    status: 'success',
                    resultSummary: answer?.slice(0, 500),
                    durationMs: Date.now() - manualStartMs,
                });
            }).catch(err => {
                deps.logger.error(`Manual trigger failed: ${err.message}`);
                auditRepository.updateScheduledRun(runId, {
                    status: 'failed',
                    errorMessage: err.message,
                    durationMs: Date.now() - manualStartMs,
                });
            });
            return { success: true, sessionId };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    // ===== SELF-IMPROVEMENT =====
    app.get<{ Querystring: { limit?: string } }>('/api/improvements', async (request) => {
        const limit = parseInt((request.query as any).limit ?? '50', 10);
        try {
            return db.prepare('SELECT * FROM improvement_events ORDER BY created_at DESC LIMIT ?').all(limit);
        } catch {
            return [];
        }
    });

    // ===== TOKEN USAGE =====
    app.get<{ Querystring: { days?: string } }>('/api/usage/daily', async (request) => {
        const days = Math.min(parseInt((request.query as any).days ?? '7', 10), 90);
        try {
            return db.prepare(`
                SELECT date(created_at) as date,
                       SUM(prompt_tokens) as prompt_tokens,
                       SUM(completion_tokens) as completion_tokens,
                       SUM(total_tokens) as total_tokens
                FROM token_usage
                WHERE created_at >= date('now', '-' || ? || ' days')
                GROUP BY date(created_at)
                ORDER BY date ASC
            `).all(days);
        } catch { return []; }
    });

    app.get('/api/usage/summary', async () => {
        try {
            const monthly = db.prepare(`
                SELECT SUM(prompt_tokens) as prompt_tokens,
                       SUM(completion_tokens) as completion_tokens,
                       SUM(total_tokens) as total_tokens
                FROM token_usage
                WHERE created_at >= date('now', 'start of month')
            `).get() as any;
            const byModel = db.prepare(`
                SELECT model,
                       SUM(prompt_tokens) as prompt_tokens,
                       SUM(completion_tokens) as completion_tokens,
                       SUM(total_tokens) as total_tokens,
                       COUNT(*) as calls
                FROM token_usage
                WHERE created_at >= date('now', 'start of month')
                GROUP BY model
                ORDER BY total_tokens DESC
            `).all() as any[];
            const today = (db.prepare(
                `SELECT SUM(total_tokens) as t FROM token_usage WHERE date(created_at) = date('now')`
            ).get() as any)?.t ?? 0;
            return {
                monthly: monthly ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                byModel: byModel ?? [],
                today,
            };
        } catch { return { monthly: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, byModel: [], today: 0 }; }
    });

    // ===== LONG-TERM MEMORIES =====
    app.get<{ Querystring: { q?: string; limit?: string } }>('/api/memories', async (request) => {
        const { q, limit } = request.query as { q?: string; limit?: string };
        const lim = parseInt(limit ?? '50', 10);
        try {
            if (q) {
                return db.prepare(
                    `SELECT id, key, content, session_id, created_at FROM memories WHERE content LIKE ? AND superseded_by IS NULL ORDER BY created_at DESC LIMIT ?`
                ).all(`%${q}%`, lim);
            }
            return db.prepare('SELECT id, key, content, session_id, created_at FROM memories WHERE superseded_by IS NULL ORDER BY created_at DESC LIMIT ?').all(lim);
        } catch {
            return [];
        }
    });

    app.delete<{ Params: { id: string } }>('/api/memories/:id', async (request, reply) => {
        try {
            db.prepare('DELETE FROM memories WHERE id = ?').run(request.params.id);
            return { success: true };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    // 迁移旧记忆到文件式存储（data/.memory/ 目录）
    app.post('/api/memories/migrate', async (_request, reply) => {
        if (!deps.longTermMemory) { reply.status(503); return { error: 'Long-term memory not enabled' }; }
        try {
            const result = await deps.longTermMemory.migrateToFiles();
            return { success: true, ...result };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    // ===== PROMPT TEMPLATES =====
    app.get<{ Querystring: { category?: string; q?: string } }>('/api/prompts', async (request) => {
        const { category, q } = request.query as { category?: string; q?: string };
        try {
            if (category && q) {
                return db.prepare('SELECT * FROM prompt_templates WHERE category = ? AND (title LIKE ? OR prompt LIKE ?) ORDER BY use_count DESC, created_at DESC').all(category, `%${q}%`, `%${q}%`);
            } else if (category) {
                return db.prepare('SELECT * FROM prompt_templates WHERE category = ? ORDER BY use_count DESC, created_at DESC').all(category);
            } else if (q) {
                return db.prepare('SELECT * FROM prompt_templates WHERE title LIKE ? OR prompt LIKE ? ORDER BY use_count DESC').all(`%${q}%`, `%${q}%`);
            }
            return db.prepare('SELECT * FROM prompt_templates ORDER BY use_count DESC, category, created_at DESC').all();
        } catch { return []; }
    });

    app.post<{ Body: { title: string; description?: string; prompt: string; category?: string } }>('/api/prompts', async (request, reply) => {
        const { title, description, prompt: promptText, category } = request.body;
        if (!title || !promptText) { reply.status(400); return { error: 'title and prompt are required' }; }
        const id = nanoid();
        const now = new Date().toISOString();
        try {
            db.prepare('INSERT INTO prompt_templates (id, title, description, prompt, category, is_builtin, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)').run(id, title, description ?? null, promptText, category ?? 'general', now);
            return { success: true, id };
        } catch (err: any) { reply.status(500); return { error: err.message }; }
    });

    app.patch<{ Params: { id: string }; Body: { title?: string; description?: string; prompt?: string; category?: string } }>('/api/prompts/:id', async (request, reply) => {
        const { title, description, prompt: promptText, category } = request.body;
        try {
            if (title) db.prepare('UPDATE prompt_templates SET title = ? WHERE id = ?').run(title, request.params.id);
            if (description !== undefined) db.prepare('UPDATE prompt_templates SET description = ? WHERE id = ?').run(description, request.params.id);
            if (promptText) db.prepare('UPDATE prompt_templates SET prompt = ? WHERE id = ?').run(promptText, request.params.id);
            if (category) db.prepare('UPDATE prompt_templates SET category = ? WHERE id = ?').run(category, request.params.id);
            return { success: true };
        } catch (err: any) { reply.status(500); return { error: err.message }; }
    });

    app.delete<{ Params: { id: string } }>('/api/prompts/:id', async (request, reply) => {
        try {
            const row = db.prepare('SELECT is_builtin FROM prompt_templates WHERE id = ?').get(request.params.id) as any;
            if (row?.is_builtin) { reply.status(403); return { error: 'Cannot delete built-in templates' }; }
            db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(request.params.id);
            return { success: true };
        } catch (err: any) { reply.status(500); return { error: err.message }; }
    });

    app.post<{ Params: { id: string } }>('/api/prompts/:id/use', async (request, reply) => {
        try {
            db.prepare('UPDATE prompt_templates SET use_count = use_count + 1 WHERE id = ?').run(request.params.id);
            return { success: true };
        } catch (err: any) { reply.status(500); return { error: err.message }; }
    });
}
