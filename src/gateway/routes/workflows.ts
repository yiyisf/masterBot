import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import path from 'path';
import crypto from 'crypto';
import { db } from '../../core/database.js';
import { webhookRepository } from '../../core/webhook-repository.js';
import { auditRepository } from '../../core/audit-repository.js';
import { RunbookEngine } from '../../core/runbook-engine.js';
import type { GatewayDeps } from '../route-deps.js';

/**
 * 工作流相关路由：知识图谱、可视化工作流、Conductor 工作流、Conductor AI Copilot 代理、
 * Webhook 管理与入站触发、Runbook、RPA。
 * 从 server.ts 拆分而来（P0-4），逻辑与原实现保持一致，仅将 `this.x` 改为 `deps.x`。
 */
export async function registerWorkflowRoutes(app: FastifyInstance, deps: GatewayDeps): Promise<void> {
    // ===== KNOWLEDGE GRAPH =====
    app.get('/api/knowledge/stats', async () => {
        if (!deps.knowledgeGraph) return { nodeCount: 0, edgeCount: 0 };
        return deps.knowledgeGraph.getStats();
    });

    app.post<{ Body: { content: string; title: string; type?: string; source?: string } }>('/api/knowledge/ingest', async (request, reply) => {
        if (!deps.knowledgeGraph) { reply.status(503); return { error: 'Knowledge graph not available' }; }
        try {
            const { content, title, type, source } = request.body;
            const id = await deps.knowledgeGraph.ingest(content, { title, type, source });
            return { success: true, id };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.get<{ Querystring: { q: string; depth?: string; limit?: string } }>('/api/knowledge/search', async (request, reply) => {
        if (!deps.knowledgeGraph) { reply.status(503); return { error: 'Knowledge graph not available' }; }
        try {
            const { q, depth, limit } = request.query as any;
            const result = await deps.knowledgeGraph.search(q, {
                depth: depth ? parseInt(depth) : 2,
                limit: limit ? parseInt(limit) : 10,
            });
            return result;
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    // ===== WORKFLOWS =====
    app.get('/api/workflows', async () => {
        const rows = (db as any).prepare('SELECT id, name, description, definition, created_at, updated_at FROM workflows ORDER BY updated_at DESC').all() as any[];
        return rows.map((r: any) => {
            const def = (() => { try { return JSON.parse(r.definition); } catch { return {}; } })();
            return {
                id: r.id,
                name: r.name,
                description: r.description,
                nodes: def.nodes ?? [],
                createdAt: r.created_at,
                updatedAt: r.updated_at,
            };
        });
    });

    app.post<{ Body: { name: string; description?: string; nodes?: any[]; definition?: any } }>('/api/workflows', async (request, reply) => {
        try {
            const { nanoid: nanoidFn } = await import('nanoid');
            const id = nanoidFn();
            const now = new Date().toISOString();
            const { name, description, nodes, definition } = request.body;
            // Frontend sends `nodes`; backend stores as `definition: { nodes }`
            const defObj = definition ?? (nodes !== undefined ? { nodes } : { nodes: [] });
            (db as any).prepare(`INSERT INTO workflows (id, name, description, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
                .run(id, name, description || null, JSON.stringify(defObj), now, now);
            return { success: true, id };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.put<{ Params: { id: string }; Body: { name: string; description?: string; nodes?: any[]; definition?: any } }>('/api/workflows/:id', async (request, reply) => {
        try {
            const { id } = request.params;
            const existing = (db as any).prepare('SELECT id FROM workflows WHERE id = ?').get(id);
            if (!existing) { reply.status(404); return { error: 'Workflow not found' }; }
            const now = new Date().toISOString();
            const { name, description, nodes, definition } = request.body;
            const defObj = definition ?? (nodes !== undefined ? { nodes } : { nodes: [] });
            (db as any).prepare(
                'UPDATE workflows SET name = ?, description = ?, definition = ?, updated_at = ? WHERE id = ?'
            ).run(name, description || null, JSON.stringify(defObj), now, id);
            return { success: true };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.delete<{ Params: { id: string } }>('/api/workflows/:id', async (request, reply) => {
        try {
            (db as any).prepare('DELETE FROM workflows WHERE id = ?').run(request.params.id);
            return { success: true };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.post<{ Params: { id: string } }>('/api/workflows/:id/execute', async (request, reply) => {
        try {
            const row = (db as any).prepare('SELECT * FROM workflows WHERE id = ?').get(request.params.id) as any;
            if (!row) { reply.status(404); return { error: 'Workflow not found' }; }
            const definition = JSON.parse(row.definition);
            const { nanoid: nanoidFn } = await import('nanoid');
            const sessionId = nanoidFn();
            const memory = deps.sessionManager.getSession(sessionId);
            // Build prompt from workflow nodes
            const nodeDescs = (definition.nodes || []).map((n: any) => `${n.type}: ${n.label}`).join(' → ');
            const prompt = `执行工作流 "${row.name}":\n${nodeDescs}`;
            deps.agent.execute(prompt, { sessionId, memory }).catch(err => {
                deps.logger.error(`Workflow execution failed: ${err.message}`);
            });
            return { success: true, sessionId };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    // ===== CONDUCTOR WORKFLOWS =====
    app.get('/api/conductor-workflows', async () => {
        const rows = (db as any).prepare('SELECT id, name, description, version, definition, created_at, updated_at FROM conductor_workflows ORDER BY updated_at DESC').all() as any[];
        return rows.map((r: any) => {
            const def = (() => { try { return JSON.parse(r.definition); } catch { return {}; } })();
            return {
                id: r.id,
                name: r.name,
                description: r.description,
                version: r.version,
                definition: def,
                createdAt: r.created_at,
                updatedAt: r.updated_at,
            };
        });
    });

    app.get<{ Params: { id: string } }>('/api/conductor-workflows/:id', async (request, reply) => {
        try {
            const row = (db as any).prepare('SELECT id, name, description, version, definition, created_at, updated_at FROM conductor_workflows WHERE id = ?').get(request.params.id) as any;
            if (!row) { reply.status(404); return { error: 'Conductor workflow not found' }; }
            const def = (() => { try { return JSON.parse(row.definition); } catch { return {}; } })();
            return {
                id: row.id,
                name: row.name,
                description: row.description,
                version: row.version,
                definition: def,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.post<{ Body: { name: string; description?: string; version?: number; definition: any } }>('/api/conductor-workflows', async (request, reply) => {
        try {
            const { nanoid: nanoidFn } = await import('nanoid');
            const id = nanoidFn();
            const now = new Date().toISOString();
            const { name, description, version, definition } = request.body;

            if (!definition) {
                reply.status(400); return { error: 'Missing definition' };
            }

            (db as any).prepare(`INSERT INTO conductor_workflows (id, name, description, version, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
                .run(id, name, description || null, version || 1, typeof definition === 'string' ? definition : JSON.stringify(definition), now, now);
            return { success: true, id };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.put<{ Params: { id: string }; Body: { name: string; description?: string; version?: number; definition: any } }>('/api/conductor-workflows/:id', async (request, reply) => {
        try {
            const { id } = request.params;
            const existing = (db as any).prepare('SELECT id FROM conductor_workflows WHERE id = ?').get(id);
            if (!existing) { reply.status(404); return { error: 'Conductor workflow not found' }; }

            const now = new Date().toISOString();
            const { name, description, version, definition } = request.body;

            if (!definition) {
                reply.status(400); return { error: 'Missing definition' };
            }

            (db as any).prepare(
                'UPDATE conductor_workflows SET name = ?, description = ?, version = ?, definition = ?, updated_at = ? WHERE id = ?'
            ).run(name, description || null, version || 1, typeof definition === 'string' ? definition : JSON.stringify(definition), now, id);
            return { success: true };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.delete<{ Params: { id: string } }>('/api/conductor-workflows/:id', async (request, reply) => {
        try {
            (db as any).prepare('DELETE FROM conductor_workflows WHERE id = ?').run(request.params.id);
            return { success: true };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    // ===== CONDUCTOR AI COPILOT PROXY =====
    // OpenAI-compatible streaming endpoint for WorkflowIDE AI Copilot
    app.post<{ Body: { messages: Array<{ role: string; content: string }> } }>(
        '/api/conductor/chat/completions',
        async (request, reply) => {
            const { messages } = request.body;
            reply.raw.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            const llmAdapter = deps.agent.getLLMAdapter();
            const llmMessages = messages.map((m) => ({
                role: m.role as 'system' | 'user' | 'assistant',
                content: m.content,
            }));
            try {
                for await (const chunk of llmAdapter.chatStream(llmMessages, {})) {
                    if (chunk.type === 'content' && chunk.content) {
                        const payload = {
                            choices: [{ delta: { content: chunk.content }, finish_reason: null }],
                        };
                        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
                    }
                }
            } catch (err: any) {
                deps.logger.error(`[conductor/copilot] Stream error: ${err.message}`);
            }
            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();
        }
    );

    // ===== WEBHOOKS =====
    app.get('/api/webhooks', async () => {
        return webhookRepository.list();
    });

    app.post<{ Body: { name: string; description?: string } }>('/api/webhooks', async (request, reply) => {
        try {
            const { name, description } = request.body;
            if (!name) { reply.status(400); return { error: 'name is required' }; }
            const wh = webhookRepository.create({ name, description });
            return { success: true, webhook: wh };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.patch<{ Params: { id: string }; Body: any }>('/api/webhooks/:id', async (request, reply) => {
        try {
            const wh = webhookRepository.get(request.params.id);
            if (!wh) { reply.status(404); return { error: 'Webhook not found' }; }
            const { name, enabled, description } = request.body as { name?: string; enabled?: boolean; description?: string };
            webhookRepository.update(request.params.id, { name, enabled, description });
            return { success: true };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.delete<{ Params: { id: string } }>('/api/webhooks/:id', async (request, reply) => {
        try {
            webhookRepository.delete(request.params.id);
            return { success: true };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    // Inbound webhook trigger — HMAC-SHA256 signature verification
    app.post<{ Params: { id: string }; Body: any }>(
        '/api/webhooks/:id/trigger',
        { config: { rawBody: true } },
        async (request, reply) => {
            const { id } = request.params;
            const wh = webhookRepository.get(id);
            if (!wh) { reply.status(404); return { error: 'Webhook not found' }; }
            if (!wh.enabled) { reply.status(403); return { error: 'Webhook is disabled' }; }

            // HMAC-SHA256 signature verification (optional — skip if no signature header)
            const sigHeader = (request.headers['x-signature'] || request.headers['x-hub-signature-256']) as string | undefined;
            if (sigHeader) {
                const rawBody = (request as any).rawBody as Buffer | undefined;
                const bodyStr = rawBody ? rawBody.toString() : JSON.stringify(request.body);
                const expected = 'sha256=' + crypto.createHmac('sha256', wh.secret).update(bodyStr).digest('hex');
                if (!crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))) {
                    reply.status(401);
                    return { error: 'Invalid signature' };
                }
            }

            webhookRepository.recordTrigger(id);

            // Trigger agent execution asynchronously
            const sessionId = nanoid();
            const memory = deps.sessionManager.getSession(sessionId);
            const payload = JSON.stringify(request.body || {});
            const prompt = `Webhook "${wh.name}" triggered with payload: ${payload}\n请分析此 Webhook 事件并采取相应行动。`;

            // Record webhook execution
            const webhookExecId = auditRepository.createExecution({
                type: 'webhook',
                name: wh.name,
                sessionId,
                triggerSource: 'webhook',
                triggerRef: id,
                inputSummary: payload.slice(0, 500),
            });
            const webhookStartMs = Date.now();

            deps.agent.execute(prompt, { sessionId, memory }).then(({ answer }) => {
                auditRepository.updateExecution(webhookExecId, {
                    status: 'success',
                    outputSummary: answer?.slice(0, 500),
                    durationMs: Date.now() - webhookStartMs,
                });
            }).catch(err => {
                deps.logger.error(`Webhook agent execution failed: ${err.message}`);
                auditRepository.updateExecution(webhookExecId, {
                    status: 'failed',
                    errorMessage: err.message,
                    durationMs: Date.now() - webhookStartMs,
                });
            });

            return { success: true, sessionId, message: 'Webhook received, agent triggered' };
        }
    );

    // ===== RUNBOOKS =====
    const runbookEngine = new RunbookEngine(deps.agent.getSkillRegistry(), deps.logger);

    app.get('/api/runbooks', async () => {
        return runbookEngine.listRunbooks();
    });

    app.post<{ Body: { filename: string; content: string } }>('/api/runbooks', async (request, reply) => {
        try {
            const { filename, content } = request.body;
            if (!filename || !content) { reply.status(400); return { error: 'filename and content required' }; }
            const { writeFileSync, mkdirSync, existsSync } = await import('fs');
            const runbooksDir = path.join(process.cwd(), 'runbooks');
            if (!existsSync(runbooksDir)) mkdirSync(runbooksDir, { recursive: true });
            const safeName = filename.endsWith('.yaml') ? filename : filename + '.yaml';
            writeFileSync(path.join(runbooksDir, safeName), content, 'utf-8');
            return { success: true, filename: safeName };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.post<{ Params: { filename: string }; Body: { variables?: Record<string, unknown> } }>(
        '/api/runbooks/:filename/execute',
        async (request, reply) => {
            try {
                const runbook = runbookEngine.loadRunbook(request.params.filename);
                const sessionId = nanoid();
                const memory = deps.sessionManager.getSession(sessionId);
                const skillContext = {
                    sessionId,
                    logger: deps.logger,
                    memory,
                    config: (deps.config as any).skills || {},
                    llm: deps.agent.getLLMAdapter(),
                };
                const result = await runbookEngine.execute(runbook, {
                    sessionId,
                    variables: request.body?.variables,
                    skillContext,
                });
                return result;
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        }
    );

    // ===== RPA API =====
    app.post<{ Body: { type: string; params: Record<string, unknown> } }>('/api/rpa/execute', async (request, reply) => {
        try {
            const { type, params } = request.body;
            const sessionId = nanoid();
            const memory = deps.sessionManager.getSession(sessionId);
            const skillContext = {
                sessionId,
                logger: deps.logger,
                memory,
                config: (deps.config as any).skills || {},
                llm: deps.agent.getLLMAdapter(),
            };
            const toolName = `browser-automation.${type}`;
            const result = await deps.agent.getSkillRegistry().executeAction(toolName, params, skillContext);
            return result;
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });

    app.post<{ Body: { prompt: string; url?: string } }>('/api/rpa/prompt', async (request, reply) => {
        try {
            const { prompt, url } = request.body;
            const sessionId = nanoid();
            const memory = deps.sessionManager.getSession(sessionId);
            const fullPrompt = `[RPA任务] ${url ? `目标网站: ${url}\n` : ''}${prompt}\n\n请使用 browser-automation 技能完成此任务。每次操作后截图确认状态。`;
            deps.agent.execute(fullPrompt, { sessionId, memory }).catch(err => {
                deps.logger.error(`RPA agent execution failed: ${err.message}`);
            });
            return { success: true, sessionId, message: 'RPA agent started' };
        } catch (err: any) {
            reply.status(500); return { error: err.message };
        }
    });
}
