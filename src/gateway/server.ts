import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { nanoid } from 'nanoid';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { resolveCliCommand } from '../skills/utils.js';
import { llmFactory } from '../llm/index.js';
import type { Config, ChatRequest, Logger, Message, McpServerConfig } from '../types.js';
import { resolveInterrupt, cancelInterrupt } from '../core/interrupt-coordinator.js';
import { Agent } from '../core/agent.js';
import { SessionMemoryManager } from '../memory/short-term.js';
import { historyRepository } from '../core/repository.js';
import { taskRepository } from '../core/task-repository.js';
import { McpSkillSource } from '../skills/mcp-source.js';
import { McpRegistryClient } from '../skills/mcp-registry.js';
import { createAuthHook } from './auth.js';
import { db } from '../core/database.js';
import { webhookRepository } from '../core/webhook-repository.js';
import { RunbookEngine } from '../core/runbook-engine.js';
import { SelfImprovementEngine } from '../core/self-improvement.js';
import { AgentGateway } from '../core/agent-gateway.js';
import type { AgentPool } from '../core/harness/agent-pool.js';
import { auditRepository } from '../core/audit-repository.js';
import { ImGateway, FeishuAdapter, imUserRegistry, imSessionMapper } from './im-gateway.js';

/**
 * Gateway 服务器
 * 提供 HTTP 和 WebSocket 接口
 */
export class GatewayServer {
    private app: FastifyInstance;
    private agent: Agent;
    private sessionManager: SessionMemoryManager;
    private logger: Logger;
    private config: Config;
    private knowledgeGraph?: any;
    private orchestrator?: any;
    private skillGenerator?: any;
    private skillRegistry?: any;
    private connectorManager?: any;
    private scheduler?: any;
    private selfImprovementEngine?: SelfImprovementEngine;
    private agentGateway: AgentGateway;
    private imGateway?: ImGateway;
    private agentPool?: AgentPool;
    private longTermMemory?: import('../memory/long-term.js').LongTermMemory;
    private checkpointManager?: import('../core/checkpoint-manager.js').CheckpointManager;

    constructor(options: {
        agent: Agent;
        sessionManager: SessionMemoryManager;
        logger: Logger;
        config: Config;
        knowledgeGraph?: any;
        orchestrator?: any;
        skillGenerator?: any;
        skillRegistry?: any;
        connectorManager?: any;
        scheduler?: any;
        selfImprovementEngine?: SelfImprovementEngine;
        agentPool?: AgentPool;
        longTermMemory?: import('../memory/long-term.js').LongTermMemory;
        checkpointManager?: import('../core/checkpoint-manager.js').CheckpointManager;
    }) {
        this.agent = options.agent;
        this.sessionManager = options.sessionManager;
        this.logger = options.logger;
        this.config = options.config;
        this.knowledgeGraph = options.knowledgeGraph;
        this.orchestrator = options.orchestrator;
        this.skillGenerator = options.skillGenerator;
        this.skillRegistry = options.skillRegistry;
        this.connectorManager = options.connectorManager;
        this.scheduler = options.scheduler;
        this.selfImprovementEngine = options.selfImprovementEngine;
        this.agentGateway = new AgentGateway(options.logger);
        this.agentPool = options.agentPool;
        this.longTermMemory = options.longTermMemory;
        this.checkpointManager = options.checkpointManager;

        // Initialize IM Gateway if enabled
        if (options.config.im?.enabled && options.config.im.platform === 'feishu') {
            const feishuCfg = options.config.im.feishu;
            if (feishuCfg?.appId) {
                const adapter = new FeishuAdapter(feishuCfg, options.logger);
                this.imGateway = new ImGateway({
                    adapter,
                    logger: options.logger,
                    defaultRole: options.config.im.defaultRole,
                    hitlTimeoutMinutes: options.config.im.hitlTimeoutMinutes,
                    baseUrl: `http://${options.config.server.host}:${options.config.server.port}`,
                    runAgent: async (prompt, sessionId) => {
                        const memory = options.sessionManager.getSession(sessionId);
                        const { answer } = await options.agent.execute(prompt, { sessionId, memory });
                        return answer ?? '';
                    },
                });
                options.logger.info('[im-gateway] Feishu adapter initialized');
            }
        }

        this.app = Fastify({
            logger: options.config.logging.prettyPrint
                ? { level: options.config.logging.level }
                : false,
        });

        this.setupMiddleware();
        this.setupRoutes();
        this.setupStatic();
    }

    private async setupMiddleware(): Promise<void> {
        await this.app.register(cors, {
            origin: true,
            credentials: true,
        });
        await this.app.register(websocket);

        if (this.config.auth?.enabled) {
            this.app.addHook('onRequest', createAuthHook(this.config.auth, this.logger));
        }
    }

    private async setupStatic(): Promise<void> {
        const distPath = path.join(process.cwd(), 'web/out');
        if (fs.existsSync(distPath)) {
            this.logger.info(`Serving static files from ${distPath}`);

            // Build a set of known page routes at startup (once) so the onRequest hook
            // can do an O(1) Set lookup instead of a synchronous fs.existsSync on every request.
            const pageRoutes = new Set<string>();
            try {
                for (const entry of fs.readdirSync(distPath, { withFileTypes: true })) {
                    if (entry.isDirectory() && fs.existsSync(path.join(distPath, entry.name, 'index.html'))) {
                        pageRoutes.add('/' + entry.name);
                    }
                }
                this.logger.debug(`[static] Registered ${pageRoutes.size} page routes for trailing-slash redirect`);
            } catch (err) {
                this.logger.warn(`[static] Failed to scan page routes: ${(err as Error).message}`);
            }

            // Next.js static export with trailingSlash:true generates {route}/index.html.
            // Redirect paths without trailing slash to the slash version so the correct
            // page HTML is served (e.g. /agents → /agents/).
            this.app.addHook('onRequest', (request, reply, done) => {
                const rawUrl = request.raw.url ?? '';
                const urlPath = rawUrl.split('?')[0];
                if (pageRoutes.has(urlPath)) {
                    reply.redirect(rawUrl.replace(urlPath, urlPath + '/'), 301);
                    return;
                }
                done();
            });

            await this.app.register(fastifyStatic, {
                root: distPath,
                prefix: '/',
                index: 'index.html',
                redirect: true,
            });

            // Handle client-side routing (SPAs fallback to index.html for non-asset routes)
            this.app.setNotFoundHandler((request, reply) => {
                const { url } = request;

                // Don't fallback for API or Files (preventing SyntaxError for missing assets)
                if (url.startsWith('/api') || url.includes('.')) {
                    reply.status(404).send({ error: 'Not Found' });
                    return;
                }

                // Fallback to index.html for unknown routes
                reply.sendFile('index.html');
            });
        } else {
            this.logger.warn(`Static files not found at ${distPath}. Web UI will be unavailable.`);
        }
    }

    private setupRoutes(): void {
        // Health check
        this.app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

        // Chat API (non-streaming)
        this.app.post<{ Body: ChatRequest }>('/api/chat', async (request, reply) => {
            const { message, sessionId = nanoid(), userId, context } = request.body;

            this.logger.info(`Chat request: session=${sessionId}`);

            const memory = this.sessionManager.getSession(sessionId);
            const history = historyRepository.getMessages(sessionId);

            try {
                const { answer, steps } = await this.agent.execute(message, {
                    sessionId,
                    userId,
                    memory,
                    history,
                });

                // Update history — 用事务原子保存，防止进程崩溃导致对话只存一半
                historyRepository.saveConversationTurn(
                    sessionId,
                    { role: 'user', content: message },
                    { role: 'assistant', content: answer }
                );

                // Auto-generate title for new sessions (async)
                if ((history?.length || 0) <= 2) {
                    this.agent.generateTitle(message).then(title => {
                        this.logger.info(`Generated title for session ${sessionId}: ${title}`);
                        historyRepository.updateSessionTitle(sessionId, title);
                    }).catch(err => {
                        this.logger.error(`Title generation failed: ${err.message}`);
                    });
                }

                return {
                    sessionId,
                    message: answer,
                    steps,
                };
            } catch (error: any) {
                this.logger.error(`Chat error: ${error.message}`);
                reply.status(500);
                return { error: error.message };
            }
        });

        // Chat API (streaming via SSE)
        this.app.post<{ Body: ChatRequest }>('/api/chat/stream', async (request, reply) => {
            const { message, messageContent, sessionId = nanoid(), userId, history: clientHistory, attachments } = request.body;

            this.logger.info(`Stream chat request: session=${sessionId}`);

            // Sync with client history if provided (client as source of truth)
            if (clientHistory) {
                // historyRepository.syncHistory(sessionId, clientHistory);
            }

            const memory = this.sessionManager.getSession(sessionId);
            const history = historyRepository.getMessages(sessionId);

            reply.raw.setHeader('Content-Type', 'text/event-stream');
            reply.raw.setHeader('Cache-Control', 'no-cache');
            reply.raw.setHeader('Connection', 'keep-alive');

            const abortController = new AbortController();

            // Listen to response closure instead of request closure to detect client disconnection accurately
            reply.raw.on('close', () => {
                if (!reply.raw.writableFinished) {
                    this.logger.warn(`Stream request interrupted by client (disconnection detected): session=${sessionId}`);
                    abortController.abort();
                    // Cancel any pending human-in-the-loop interrupt so the agent doesn't hang
                    cancelInterrupt(sessionId);
                }
            });

            let assistantAnswer = '';
            const workflowSteps: any[] = [];

            // Use multimodal content if provided, otherwise fall back to plain string
            const userInput = (messageContent && messageContent.length > 0 ? messageContent : message) as string;

            try {
                for await (const step of this.agent.run(userInput, {
                    sessionId,
                    userId,
                    memory,
                    history,
                    abortSignal: abortController.signal,
                    attachments
                })) {
                    if (step.type === 'answer') {
                        assistantAnswer = step.content;
                    }
                    // Collect workflow_generated steps for persistence
                    if ((step as any).type === 'workflow_generated') {
                        const wf = step as any;
                        workflowSteps.push({
                            workflow_generated: {
                                workflow: wf.workflow,
                                subWorkflows: wf.subWorkflows,
                                validation: wf.validation,
                                allValid: wf.allValid,
                                explanation: wf.explanation,
                            },
                        });
                    }
                    if (reply.raw.writable) {
                        reply.raw.write(`data: ${JSON.stringify(step)}\n\n`);
                    } else {
                        abortController.abort(); // 连接已断开，中止 agent
                        break;
                    }
                }

                // Persist history after success — 用事务原子保存，并跳过空答案（客户端中途断连场景）
                if (!abortController.signal.aborted && assistantAnswer) {
                    const assistantMsgMetadata = workflowSteps.length > 0
                        ? { custom: { steps: workflowSteps } }
                        : undefined;
                    const { assistantMsgId } = historyRepository.saveConversationTurn(
                        sessionId,
                        { role: 'user', content: messageContent && messageContent.length > 0 ? messageContent : message, attachments },
                        { role: 'assistant', content: assistantAnswer, metadata: assistantMsgMetadata } as any
                    );

                    // Send meta chunk with assistant message ID for feedback correlation
                    if (reply.raw.writable) {
                        reply.raw.write(`data: ${JSON.stringify({ type: 'meta', assistantMessageId: assistantMsgId })}\n\n`);
                    }

                    // Auto-generate title for new sessions (async)
                    if ((history?.length || 0) <= 2) {
                        this.agent.generateTitle(message).then(title => {
                            this.logger.info(`Generated title for session ${sessionId}: ${title}`);
                            historyRepository.updateSessionTitle(sessionId, title);
                        }).catch(err => {
                            this.logger.error(`Title generation failed: ${err.message}`);
                        });
                    }

                    reply.raw.write('data: [DONE]\n\n');
                }
            } catch (error: any) {
                if (error.name === 'AbortError' || error.message?.includes('aborted')) {
                    this.logger.info(`Stream aborted as requested: session=${sessionId}`);
                } else {
                    this.logger.error(`Stream error: ${error.message}`);
                    if (reply.raw.writable) {
                        reply.raw.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
                    }
                }
            }

            if (!reply.raw.writableFinished) {
                reply.raw.end();
            }
        });

        // WebSocket endpoint
        this.app.get('/ws', { websocket: true }, (socket, request) => {
            const sessionId = nanoid();
            this.logger.info(`WebSocket connected: session=${sessionId}`);

            socket.on('message', async (rawMessage: Buffer) => {
                try {
                    const data = JSON.parse(rawMessage.toString());
                    const { type, message: userMessage } = data;

                    if (type === 'chat') {
                        const memory = this.sessionManager.getSession(sessionId);
                        const history = historyRepository.getMessages(sessionId);

                        for await (const step of this.agent.run(userMessage, { sessionId, memory, history })) {
                            socket.send(JSON.stringify(step));
                        }

                        socket.send(JSON.stringify({ type: 'done' }));
                    }
                } catch (error: any) {
                    socket.send(JSON.stringify({ type: 'error', content: error.message }));
                }
            });

            socket.on('close', () => {
                this.logger.info(`WebSocket disconnected: session=${sessionId}`);
            });
        });

        // List skills (Derived from tools + metadata)
        this.app.get('/api/skills', async () => {
            const skillReg = this.agent.getSkillRegistry();
            const tools = await skillReg.getToolDefinitions();

            // Group tools by skill name (prefix before first dot)
            const skillMap = new Map<string, { name: string; actions: string[] }>();

            for (const tool of tools) {
                const [skillName, actionName] = tool.function.name.split('.');
                if (!skillMap.has(skillName)) {
                    skillMap.set(skillName, { name: skillName, actions: [] });
                }
                skillMap.get(skillName)?.actions.push(actionName);
            }

            return Array.from(skillMap.values()).map(s => {
                const skillMeta = skillReg.getSkill(s.name)?.metadata;
                return {
                    name: s.name,
                    version: skillMeta?.version ?? '2.0.0',
                    description: skillMeta?.description ?? 'Loaded via Skill Registry 2.0',
                    actions: s.actions,
                    status: skillMeta?.status ?? 'active',
                    loadError: skillMeta?.loadError,
                    dependencies: skillMeta?.dependencies,
                };
            });
        });

        // Repair skill: install missing npm deps and hot-reload
        this.app.post<{ Params: { name: string } }>('/api/skills/:name/repair', async (request, reply) => {
            const { name } = request.params;
            const skillReg = this.agent.getSkillRegistry();
            const skill = skillReg.getSkill(name);

            if (!skill) {
                reply.status(404);
                return { error: `Skill "${name}" not found` };
            }

            const deps = skill.metadata.dependencies;
            if (!deps || Object.keys(deps).length === 0) {
                reply.status(400);
                return { error: `Skill "${name}" has no declared dependencies` };
            }

            const packages = Object.keys(deps);
            this.logger.info(`Repairing skill "${name}": installing ${packages.join(', ')}`);

            try {
                await new Promise<void>((resolve, reject) => {
                    execFile(
                        resolveCliCommand('npm'),
                        ['install', '--save', ...packages],
                        { cwd: process.cwd() },
                        (err, stdout, stderr) => {
                            if (err) {
                                this.logger.error(`npm install failed: ${stderr || err.message}`);
                                reject(new Error(stderr || err.message));
                            } else {
                                this.logger.info(`npm install success: ${stdout}`);
                                resolve();
                            }
                        }
                    );
                });

                // Hot-reload skill
                // Find skill directory from local-files source
                const localSource = skillReg.getAllSources()
                    .find((s: any) => s.name === 'local-files') as any;

                if (localSource && typeof localSource.getSkill === 'function') {
                    // Reload from its original directory by re-finding it
                    const skillDirs = (this as any).config?.skills?.directories ?? [];
                    let reloaded = false;
                    for (const dir of skillDirs) {
                        const { join, resolve: resolvePath } = await import('path');
                        const skillDir = resolvePath(join(dir, name));
                        const { existsSync } = await import('fs');
                        if (existsSync(skillDir)) {
                            await localSource.loadSkill(skillDir);
                            reloaded = true;
                            break;
                        }
                    }
                    if (!reloaded) {
                        this.logger.warn(`Could not find skill directory for "${name}" to hot-reload`);
                    }
                }

                return { success: true, message: `依赖安装成功，技能 "${name}" 已热重载` };
            } catch (err: any) {
                reply.status(500);
                return { error: err.message };
            }
        });

        // --- MCP Management API ---
        const registry = this.agent.getSkillRegistry();
        const MCP_CONFIG_PATH = path.join(process.cwd(), 'mcp-servers.json');

        // Helper to read MCP config
        const readMcpConfig = async (): Promise<McpServerConfig[]> => {
            try {
                if (!fs.existsSync(MCP_CONFIG_PATH)) return [];
                const content = await fs.promises.readFile(MCP_CONFIG_PATH, 'utf-8');
                return JSON.parse(content);
            } catch (e) {
                this.logger.error('Failed to read MCP config', e);
                return [];
            }
        };

        // Helper to write MCP config
        const writeMcpConfig = async (config: McpServerConfig[]) => {
            await fs.promises.writeFile(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
        };

        this.app.get('/api/mcp/config', async () => {
            return await readMcpConfig();
        });

        this.app.post<{ Body: McpServerConfig }>('/api/mcp/config', async (request, reply) => {
            const configs = await readMcpConfig();
            const newConfig = request.body;

            if (!newConfig.id) newConfig.id = nanoid();

            const index = configs.findIndex(c => c.id === newConfig.id);
            if (index >= 0) {
                // Unregister old source before updating
                const oldConfig = configs[index];
                await registry.unregisterSource(`mcp-${oldConfig.name}`).catch(() => { });
                configs[index] = newConfig;
            } else {
                configs.push(newConfig);
            }

            await writeMcpConfig(configs);

            // Register the new MCP source if enabled
            if (newConfig.enabled) {
                try {
                    const source = new McpSkillSource(newConfig, this.logger);
                    await registry.registerSource(source);
                } catch (err) {
                    this.logger.warn(`MCP server "${newConfig.name}" saved but connection failed: ${(err as Error).message}`);
                }
            }

            return { success: true, config: newConfig };
        });

        this.app.delete<{ Params: { id: string } }>('/api/mcp/config/:id', async (request, reply) => {
            const configs = await readMcpConfig();
            const toDelete = configs.find(c => c.id === request.params.id);

            // Unregister MCP source before removing config
            if (toDelete) {
                await registry.unregisterSource(`mcp-${toDelete.name}`).catch(() => { });
            }

            const newConfigs = configs.filter(c => c.id !== request.params.id);
            await writeMcpConfig(newConfigs);
            return { success: true };
        });

        // --- MCP Registry API ---
        const mcpRegistry = new McpRegistryClient(this.logger);

        this.app.get<{ Querystring: { cursor?: string; count?: string } }>('/api/mcp/registry', async (request) => {
            const { cursor, count } = request.query;
            return mcpRegistry.listServers(cursor, count ? parseInt(count) : undefined);
        });

        this.app.get<{ Querystring: { q: string } }>('/api/mcp/registry/search', async (request) => {
            const { q } = request.query;
            if (!q) return { servers: [] };
            const servers = await mcpRegistry.searchServers(q);
            return { servers };
        });

        this.app.get<{ Params: { name: string } }>('/api/mcp/registry/:name', async (request) => {
            return mcpRegistry.getServer(request.params.name);
        });

        this.app.post<{ Body: { name: string; env?: Record<string, string> } }>('/api/mcp/registry/install', async (request, reply) => {
            const { name, env } = request.body;
            if (!name) {
                reply.status(400);
                return { error: 'Missing server name' };
            }

            try {
                const entry = await mcpRegistry.getServer(name);
                const newConfig = mcpRegistry.toMcpConfig(entry, env);

                // Persist to mcp-servers.json
                const configs = await readMcpConfig();
                configs.push(newConfig);
                await writeMcpConfig(configs);

                // Register live
                if (newConfig.enabled) {
                    try {
                        const source = new McpSkillSource(newConfig, this.logger);
                        await registry.registerSource(source);
                    } catch (err) {
                        this.logger.warn(`MCP server "${newConfig.name}" installed but connection failed: ${(err as Error).message}`);
                    }
                }

                return { success: true, config: newConfig };
            } catch (err) {
                reply.status(500);
                return { error: (err as Error).message };
            }
        });

        // Get all sessions
        this.app.get('/api/sessions', async () => {
            const sessions = historyRepository.getSessions();
            return sessions.map(s => {
                // 从最后一条消息内容提取纯文本预览（去除 JSON/Markdown 标记）
                const rawPreview: string = s.last_msg ?? s.first_msg ?? '';
                const preview = rawPreview.replace(/```[\s\S]*?```/g, '[代码]').slice(0, 80);
                return {
                    id: s.id,
                    title: s.title || s.first_msg || '新对话',
                    updatedAt: s.updated_at,
                    createdAt: s.created_at,
                    is_pinned: Boolean(s.is_pinned),
                    preview: preview || undefined,
                };
            });
        });

        // Get specific session messages (paginated)
        this.app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>('/api/sessions/:id/messages', async (request, reply) => {
            const { id } = request.params;
            const { limit, before } = request.query as { limit?: string; before?: string };
            const opts = {
                limit: limit ? parseInt(limit, 10) : 50,
                before: before || undefined,
            };
            const messages = historyRepository.getMessages(id, opts);
            const hasMore = before ? messages.length >= opts.limit : false;
            return { messages, hasMore };
        });

        // Get session DAG tasks
        this.app.get<{ Params: { id: string } }>('/api/sessions/:id/tasks', async (request, reply) => {
            const { id } = request.params;
            const dag = taskRepository.getDAG(id);
            return dag;
        });

        // Delete session
        this.app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
            const { id } = request.params;
            this.logger.info(`Delete session request: ${id}`);
            try {
                historyRepository.deleteSession(id);
                return { success: true };
            } catch (error: any) {
                this.logger.error(`Delete session error: ${error.message}`);
                reply.status(500);
                return { error: error.message };
            }
        });

        // Human-in-the-Loop: user approves or rejects a pending interrupt
        this.app.post<{ Params: { id: string }; Body: { approved: boolean } }>(
            '/api/sessions/:id/interrupt-response',
            async (request, reply) => {
                const { id: sessionId } = request.params;
                const { approved } = request.body;
                const resolved = resolveInterrupt(sessionId, approved === true);
                if (!resolved) {
                    reply.status(404);
                    return { error: 'No pending interrupt for this session' };
                }
                this.logger.info(`Interrupt resolved for session ${sessionId}: approved=${approved}`);
                return { ok: true };
            }
        );

        // Update session title
        this.app.patch<{ Params: { id: string }, Body: { title: string } }>('/api/sessions/:id/title', async (request, reply) => {
            const { id } = request.params;
            const { title } = request.body;
            try {
                historyRepository.updateSessionTitle(id, title);
                return { success: true };
            } catch (error: any) {
                this.logger.error(`Update title error: ${error.message}`);
                reply.status(500);
                return { error: error.message };
            }
        });

        // Toggle pin session
        this.app.patch<{ Params: { id: string }, Body: { isPinned: boolean } }>('/api/sessions/:id/pin', async (request, reply) => {
            const { id } = request.params;
            const { isPinned } = request.body;
            try {
                historyRepository.togglePin(id, isPinned);
                return { success: true };
            } catch (error: any) {
                this.logger.error(`Toggle pin error: ${error.message}`);
                reply.status(500);
                return { error: error.message };
            }
        });

        // Feedback API
        this.app.post<{ Body: { messageId: string; sessionId: string; rating: 'positive' | 'negative' } }>('/api/feedback', async (request, reply) => {
            const { messageId, sessionId, rating } = request.body;
            if (!messageId || !sessionId || !rating) {
                reply.status(400);
                return { error: 'Missing required fields: messageId, sessionId, rating' };
            }
            try {
                const id = historyRepository.saveFeedback(messageId, sessionId, rating);

                // Trigger self-improvement on negative feedback (async, non-blocking)
                if (rating === 'negative' && this.selfImprovementEngine) {
                    this.selfImprovementEngine.onNegativeFeedback(messageId, sessionId).catch(err => {
                        this.logger.error(`Self-improvement trigger failed: ${err.message}`);
                    });
                }

                return { success: true, id };
            } catch (error: any) {
                this.logger.error(`Feedback error: ${error.message}`);
                reply.status(500);
                return { error: error.message };
            }
        });

        // System status
        this.app.get('/api/status', async () => {
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
                    skillCount: (await this.agent.getSkillRegistry().getToolDefinitions()).length,
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
                    provider: this.agent.getLLMAdapter().provider,
                },
                recentImprovements,
            };
        });

        // ===== CONFIG MANAGEMENT =====

        // Model configuration (Read/Update)
        // apiKey values are masked in the response to prevent leaking credentials to the browser
        this.app.get('/api/config/models', async () => {
            const providers: Record<string, any> = {};
            for (const [name, cfg] of Object.entries(this.config.models.providers)) {
                const p = cfg as any;
                providers[name] = {
                    ...p,
                    apiKey: p.apiKey ? p.apiKey.slice(0, 4) + '****' : '',
                };
            }
            return { ...this.config.models, providers };
        });

        this.app.patch<{ Body: any }>('/api/config/models', async (request, reply) => {
            const newModelConfig = request.body as any;
            this.config.models.default = newModelConfig.default;
            this.config.models.providers = {
                ...this.config.models.providers,
                ...newModelConfig.providers
            };
            llmFactory.clearCache();
            this.logger.info(`LLM configuration hot-reloaded: ${this.config.models.default}`);
            return { success: true, message: 'Configuration updated and hot-reloaded' };
        });

        // Test LLM provider connectivity with a minimal chat call
        this.app.post<{ Body: { providerName: string } }>('/api/config/models/test', async (request, reply) => {
            const { providerName } = request.body;
            this.logger.info(`[config] Starting connectivity test for provider: ${providerName}`);

            const providerConfig = this.config.models.providers[providerName];
            if (!providerConfig) {
                this.logger.warn(`[config] Provider "${providerName}" not found in configuration`);
                reply.status(404); return { success: false, error: `Provider "${providerName}" not found` };
            }

            // Detailed debug logging
            const maskedKey = providerConfig.apiKey ? `${providerConfig.apiKey.slice(0, 4)}...${providerConfig.apiKey.slice(-4)}` : 'missing';
            this.logger.info(`[config] Testing provider "${providerName}": baseUrl="${providerConfig.baseUrl}", model="${providerConfig.model}", type="${providerConfig.type}", apiKey=${maskedKey}`);

            try {
                const adapter = llmFactory.getAdapter(providerName, providerConfig);

                // Add 30s timeout to prevent hanging if the provider is unreachable
                const signal = AbortSignal.timeout(30000);

                const result = await adapter.chat(
                    [{ role: 'user', content: 'Reply with "OK" only, no other text.' }],
                    { maxTokens: 10, abortSignal: signal }
                );

                const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
                this.logger.info(`[config] Connectivity test success for ${providerName}: ${content.trim()}`);
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
                this.logger.error(`[config] Connectivity test failed for ${providerName}${isTimeout ? ' (Timeout)' : ''}: ${err.message}`);
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
        this.app.get('/api/config/security', async () => {
            return {
                sandbox: this.config.skills.shell?.sandbox ?? { enabled: true, mode: 'blocklist' },
                auth: this.config.auth ?? { enabled: false, mode: 'api-key' },
            };
        });

        this.app.patch<{ Body: { sandbox?: any; auth?: any } }>('/api/config/security', async (request, reply) => {
            const { sandbox, auth } = request.body;
            if (sandbox !== undefined) {
                if (!this.config.skills.shell) this.config.skills.shell = {};
                this.config.skills.shell.sandbox = { ...this.config.skills.shell?.sandbox, ...sandbox };
            }
            if (auth !== undefined) {
                this.config.auth = { ...this.config.auth, ...auth } as any;
            }
            this.logger.info('[config] Security settings updated');
            return { success: true };
        });

        // Agent configuration (Read/Update)
        this.app.get('/api/config/agent', async () => {
            return this.config.agent;
        });

        this.app.patch<{ Body: { maxIterations?: number; maxContextTokens?: number } }>('/api/config/agent', async (request, reply) => {
            const { maxIterations, maxContextTokens } = request.body;
            if (maxIterations !== undefined) this.config.agent.maxIterations = Number(maxIterations);
            if (maxContextTokens !== undefined) this.config.agent.maxContextTokens = Number(maxContextTokens);
            this.logger.info(`[config] Agent settings updated: maxIterations=${this.config.agent.maxIterations}, maxContextTokens=${this.config.agent.maxContextTokens}`);
            return { success: true };
        });

        // ===== SKILL GENERATOR =====
        this.app.post<{ Body: { name: string; description: string; actions: any[] } }>('/api/skills/generate', async (request, reply) => {
            if (!this.skillGenerator) { reply.status(503); return { error: 'Skill generator not available' }; }
            try {
                const { name, description, actions } = request.body;
                const generated = await this.skillGenerator.generate({ name, description, actions });
                const dir = await this.skillGenerator.install(generated);
                // Hot-reload: add skill to existing local-files source to avoid overwriting it
                try {
                    const registry = this.skillRegistry ?? this.agent.getSkillRegistry();
                    const existingLocal = registry.getAllSources()
                        .find((s: any) => s.name === 'local-files' && typeof s.loadSkill === 'function') as any;
                    if (existingLocal) {
                        await existingLocal.loadSkill(dir);
                        this.logger.info(`Hot-reloaded skill "${name}" into existing local-files source`);
                    } else {
                        const { LocalSkillSource } = await import('../skills/loader.js');
                        const tempSource = new LocalSkillSource([dir], this.logger);
                        await tempSource.initialize();
                        await registry.registerSource(tempSource);
                    }
                } catch (err) {
                    this.logger.warn(`Hot-reload failed: ${(err as Error).message}`);
                }
                return { success: true, dir, name };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // ===== ENTERPRISE CONNECTORS =====
        this.app.get('/api/connectors', async () => {
            if (!this.connectorManager) return [];
            return this.connectorManager.listConfigs();
        });

        this.app.post<{ Body: any }>('/api/connectors', async (request, reply) => {
            if (!this.connectorManager) { reply.status(503); return { error: 'Connector manager not available' }; }
            try {
                const config = request.body as any;
                this.connectorManager.save(config);
                // Register the new source
                const { ConnectorSkillSource } = await import('../skills/connector-source.js');
                const source = new ConnectorSkillSource(config, this.logger);
                await source.initialize();
                await this.agent.getSkillRegistry().registerSource(source);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.delete<{ Params: { name: string } }>('/api/connectors/:name', async (request, reply) => {
            if (!this.connectorManager) { reply.status(503); return { error: 'Connector manager not available' }; }
            try {
                this.connectorManager.delete(request.params.name);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // ===== SCHEDULED TASKS =====
        this.app.get('/api/scheduled-tasks', async () => {
            if (!this.scheduler) return [];
            return this.scheduler.getTasks();
        });

        this.app.post<{ Body: any }>('/api/scheduled-tasks', async (request, reply) => {
            if (!this.scheduler) { reply.status(503); return { error: 'Scheduler not available' }; }
            try {
                const { name, cronExpr, prompt, sessionId, enabled } = request.body as any;
                const id = this.scheduler.createTask({ name, cronExpr, prompt, sessionId, enabled: enabled !== false });
                return { success: true, id };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.patch<{ Params: { id: string }; Body: any }>('/api/scheduled-tasks/:id', async (request, reply) => {
            if (!this.scheduler) { reply.status(503); return { error: 'Scheduler not available' }; }
            try {
                this.scheduler.updateTask(request.params.id, request.body);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.delete<{ Params: { id: string } }>('/api/scheduled-tasks/:id', async (request, reply) => {
            if (!this.scheduler) { reply.status(503); return { error: 'Scheduler not available' }; }
            try {
                this.scheduler.deleteTask(request.params.id);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.post<{ Params: { id: string } }>('/api/scheduled-tasks/:id/trigger', async (request, reply) => {
            if (!this.scheduler) { reply.status(503); return { error: 'Scheduler not available' }; }
            try {
                const task = this.scheduler.getTask(request.params.id);
                if (!task) { reply.status(404); return { error: 'Task not found' }; }
                const { nanoid } = await import('nanoid');
                const sessionId = task.sessionId || nanoid();
                const memory = this.sessionManager.getSession(sessionId);

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
                this.agent.execute(task.prompt, { sessionId, memory }).then(({ answer }) => {
                    auditRepository.updateScheduledRun(runId, {
                        status: 'success',
                        resultSummary: answer?.slice(0, 500),
                        durationMs: Date.now() - manualStartMs,
                    });
                }).catch(err => {
                    this.logger.error(`Manual trigger failed: ${err.message}`);
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

        // ===== KNOWLEDGE GRAPH =====
        this.app.get('/api/knowledge/stats', async () => {
            if (!this.knowledgeGraph) return { nodeCount: 0, edgeCount: 0 };
            return this.knowledgeGraph.getStats();
        });

        this.app.post<{ Body: { content: string; title: string; type?: string; source?: string } }>('/api/knowledge/ingest', async (request, reply) => {
            if (!this.knowledgeGraph) { reply.status(503); return { error: 'Knowledge graph not available' }; }
            try {
                const { content, title, type, source } = request.body;
                const id = await this.knowledgeGraph.ingest(content, { title, type, source });
                return { success: true, id };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.get<{ Querystring: { q: string; depth?: string; limit?: string } }>('/api/knowledge/search', async (request, reply) => {
            if (!this.knowledgeGraph) { reply.status(503); return { error: 'Knowledge graph not available' }; }
            try {
                const { q, depth, limit } = request.query as any;
                const result = await this.knowledgeGraph.search(q, {
                    depth: depth ? parseInt(depth) : 2,
                    limit: limit ? parseInt(limit) : 10,
                });
                return result;
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // ===== WORKFLOWS =====
        this.app.get('/api/workflows', async () => {
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

        this.app.post<{ Body: { name: string; description?: string; nodes?: any[]; definition?: any } }>('/api/workflows', async (request, reply) => {
            try {
                const { nanoid } = await import('nanoid');
                const id = nanoid();
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

        this.app.put<{ Params: { id: string }; Body: { name: string; description?: string; nodes?: any[]; definition?: any } }>('/api/workflows/:id', async (request, reply) => {
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

        this.app.delete<{ Params: { id: string } }>('/api/workflows/:id', async (request, reply) => {
            try {
                (db as any).prepare('DELETE FROM workflows WHERE id = ?').run(request.params.id);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.post<{ Params: { id: string } }>('/api/workflows/:id/execute', async (request, reply) => {
            try {
                const row = (db as any).prepare('SELECT * FROM workflows WHERE id = ?').get(request.params.id) as any;
                if (!row) { reply.status(404); return { error: 'Workflow not found' }; }
                const definition = JSON.parse(row.definition);
                const { nanoid } = await import('nanoid');
                const sessionId = nanoid();
                const memory = this.sessionManager.getSession(sessionId);
                // Build prompt from workflow nodes
                const nodeDescs = (definition.nodes || []).map((n: any) => `${n.type}: ${n.label}`).join(' → ');
                const prompt = `执行工作流 "${row.name}":\n${nodeDescs}`;
                this.agent.execute(prompt, { sessionId, memory }).catch(err => {
                    this.logger.error(`Workflow execution failed: ${err.message}`);
                });
                return { success: true, sessionId };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // ===== CONDUCTOR WORKFLOWS =====
        this.app.get('/api/conductor-workflows', async () => {
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

        this.app.get<{ Params: { id: string } }>('/api/conductor-workflows/:id', async (request, reply) => {
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

        this.app.post<{ Body: { name: string; description?: string; version?: number; definition: any } }>('/api/conductor-workflows', async (request, reply) => {
            try {
                const { nanoid } = await import('nanoid');
                const id = nanoid();
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

        this.app.put<{ Params: { id: string }; Body: { name: string; description?: string; version?: number; definition: any } }>('/api/conductor-workflows/:id', async (request, reply) => {
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

        this.app.delete<{ Params: { id: string } }>('/api/conductor-workflows/:id', async (request, reply) => {
            try {
                (db as any).prepare('DELETE FROM conductor_workflows WHERE id = ?').run(request.params.id);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // ===== CONDUCTOR AI COPILOT PROXY =====
        // OpenAI-compatible streaming endpoint for WorkflowIDE AI Copilot
        this.app.post<{ Body: { messages: Array<{ role: string; content: string }> } }>(
            '/api/conductor/chat/completions',
            async (request, reply) => {
                const { messages } = request.body;
                reply.raw.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                });
                const llmAdapter = this.agent.getLLMAdapter();
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
                    this.logger.error(`[conductor/copilot] Stream error: ${err.message}`);
                }
                reply.raw.write('data: [DONE]\n\n');
                reply.raw.end();
            }
        );

        // ===== WEBHOOKS =====
        this.app.get('/api/webhooks', async () => {
            return webhookRepository.list();
        });

        this.app.post<{ Body: { name: string; description?: string } }>('/api/webhooks', async (request, reply) => {
            try {
                const { name, description } = request.body;
                if (!name) { reply.status(400); return { error: 'name is required' }; }
                const wh = webhookRepository.create({ name, description });
                return { success: true, webhook: wh };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.patch<{ Params: { id: string }; Body: any }>('/api/webhooks/:id', async (request, reply) => {
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

        this.app.delete<{ Params: { id: string } }>('/api/webhooks/:id', async (request, reply) => {
            try {
                webhookRepository.delete(request.params.id);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // Inbound webhook trigger — HMAC-SHA256 signature verification
        this.app.post<{ Params: { id: string }; Body: any }>(
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
                const memory = this.sessionManager.getSession(sessionId);
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

                this.agent.execute(prompt, { sessionId, memory }).then(({ answer }) => {
                    auditRepository.updateExecution(webhookExecId, {
                        status: 'success',
                        outputSummary: answer?.slice(0, 500),
                        durationMs: Date.now() - webhookStartMs,
                    });
                }).catch(err => {
                    this.logger.error(`Webhook agent execution failed: ${err.message}`);
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
        const runbookEngine = new RunbookEngine(this.agent.getSkillRegistry(), this.logger);

        this.app.get('/api/runbooks', async () => {
            return runbookEngine.listRunbooks();
        });

        this.app.post<{ Body: { filename: string; content: string } }>('/api/runbooks', async (request, reply) => {
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

        this.app.post<{ Params: { filename: string }; Body: { variables?: Record<string, unknown> } }>(
            '/api/runbooks/:filename/execute',
            async (request, reply) => {
                try {
                    const runbook = runbookEngine.loadRunbook(request.params.filename);
                    const sessionId = nanoid();
                    const memory = this.sessionManager.getSession(sessionId);
                    const skillContext = {
                        sessionId,
                        logger: this.logger,
                        memory,
                        config: (this.config as any).skills || {},
                        llm: this.agent.getLLMAdapter(),
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
        this.app.post<{ Body: { type: string; params: Record<string, unknown> } }>('/api/rpa/execute', async (request, reply) => {
            try {
                const { type, params } = request.body;
                const sessionId = nanoid();
                const memory = this.sessionManager.getSession(sessionId);
                const skillContext = {
                    sessionId,
                    logger: this.logger,
                    memory,
                    config: (this.config as any).skills || {},
                    llm: this.agent.getLLMAdapter(),
                };
                const toolName = `browser-automation.${type}`;
                const result = await this.agent.getSkillRegistry().executeAction(toolName, params, skillContext);
                return result;
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        this.app.post<{ Body: { prompt: string; url?: string } }>('/api/rpa/prompt', async (request, reply) => {
            try {
                const { prompt, url } = request.body;
                const sessionId = nanoid();
                const memory = this.sessionManager.getSession(sessionId);
                const fullPrompt = `[RPA任务] ${url ? `目标网站: ${url}\n` : ''}${prompt}\n\n请使用 browser-automation 技能完成此任务。每次操作后截图确认状态。`;
                this.agent.execute(fullPrompt, { sessionId, memory }).catch(err => {
                    this.logger.error(`RPA agent execution failed: ${err.message}`);
                });
                return { success: true, sessionId, message: 'RPA agent started' };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // ===== SELF-IMPROVEMENT =====
        this.app.get<{ Querystring: { limit?: string } }>('/api/improvements', async (request) => {
            const limit = parseInt((request.query as any).limit ?? '50', 10);
            try {
                return db.prepare('SELECT * FROM improvement_events ORDER BY created_at DESC LIMIT ?').all(limit);
            } catch {
                return [];
            }
        });

        // ===== TOKEN USAGE =====
        this.app.get<{ Querystring: { days?: string } }>('/api/usage/daily', async (request) => {
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

        this.app.get('/api/usage/summary', async () => {
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
        this.app.get<{ Querystring: { q?: string; limit?: string } }>('/api/memories', async (request) => {
            const { q, limit } = request.query as { q?: string; limit?: string };
            const lim = parseInt(limit ?? '50', 10);
            try {
                if (q) {
                    return db.prepare(
                        `SELECT id, key, content, session_id, created_at FROM memories WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?`
                    ).all(`%${q}%`, lim);
                }
                return db.prepare('SELECT id, key, content, session_id, created_at FROM memories ORDER BY created_at DESC LIMIT ?').all(lim);
            } catch {
                return [];
            }
        });

        this.app.delete<{ Params: { id: string } }>('/api/memories/:id', async (request, reply) => {
            try {
                db.prepare('DELETE FROM memories WHERE id = ?').run(request.params.id);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // 迁移旧记忆到文件式存储（data/.memory/ 目录）
        this.app.post('/api/memories/migrate', async (_request, reply) => {
            if (!this.longTermMemory) { reply.status(503); return { error: 'Long-term memory not enabled' }; }
            try {
                const result = await this.longTermMemory.migrateToFiles();
                return { success: true, ...result };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // ===== CHECKPOINTS (T2-4) =====
        // GET  /api/sessions/:id/checkpoints         — 列出检查点
        this.app.get<{ Params: { id: string } }>('/api/sessions/:id/checkpoints', async (request, reply) => {
            if (!this.checkpointManager) { reply.status(503); return { error: 'Checkpoint manager not available' }; }
            return this.checkpointManager.list(request.params.id);
        });

        // POST /api/sessions/:id/checkpoints         — 创建检查点
        this.app.post<{ Params: { id: string }; Body: { label?: string } }>('/api/sessions/:id/checkpoints', async (request, reply) => {
            if (!this.checkpointManager) { reply.status(503); return { error: 'Checkpoint manager not available' }; }
            const { id: sessionId } = request.params;
            const { label } = request.body ?? {};
            try {
                // 从 repository 获取当前消息历史
                const { historyRepository } = await import('../core/repository.js');
                const msgs = historyRepository.getMessages(sessionId);

                // 防止超大快照（限 10MB）
                const json = JSON.stringify(msgs);
                if (json.length > 10 * 1024 * 1024) {
                    reply.status(413);
                    return { error: `消息历史过大（${(json.length / 1024 / 1024).toFixed(1)} MB），超出检查点 10 MB 限制` };
                }

                const cpId = this.checkpointManager.save(sessionId, msgs as any[], label);
                return { id: cpId, messageCount: msgs.length };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // POST /api/sessions/:id/checkpoints/:cpId/restore — 恢复检查点（校验 session 归属）
        this.app.post<{ Params: { id: string; cpId: string } }>('/api/sessions/:id/checkpoints/:cpId/restore', async (request, reply) => {
            if (!this.checkpointManager) { reply.status(503); return { error: 'Checkpoint manager not available' }; }
            const { id: sessionId, cpId } = request.params;
            const messages = this.checkpointManager.restore(cpId, sessionId);
            if (!messages) { reply.status(404); return { error: 'Checkpoint not found' }; }
            return { messages, messageCount: messages.length };
        });

        // DELETE /api/sessions/:id/checkpoints/:cpId — 删除检查点（校验 session 归属）
        this.app.delete<{ Params: { id: string; cpId: string } }>('/api/sessions/:id/checkpoints/:cpId', async (request, reply) => {
            if (!this.checkpointManager) { reply.status(503); return { error: 'Checkpoint manager not available' }; }
            const { id: sessionId, cpId } = request.params;
            const deleted = this.checkpointManager.delete(cpId, sessionId);
            if (!deleted) { reply.status(404); return { error: 'Checkpoint not found' }; }
            return { success: true };
        });

        // ===== PROMPT TEMPLATES =====
        this.app.get<{ Querystring: { category?: string; q?: string } }>('/api/prompts', async (request) => {
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

        this.app.post<{ Body: { title: string; description?: string; prompt: string; category?: string } }>('/api/prompts', async (request, reply) => {
            const { title, description, prompt: promptText, category } = request.body;
            if (!title || !promptText) { reply.status(400); return { error: 'title and prompt are required' }; }
            const id = nanoid();
            const now = new Date().toISOString();
            try {
                db.prepare('INSERT INTO prompt_templates (id, title, description, prompt, category, is_builtin, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)').run(id, title, description ?? null, promptText, category ?? 'general', now);
                return { success: true, id };
            } catch (err: any) { reply.status(500); return { error: err.message }; }
        });

        this.app.patch<{ Params: { id: string }; Body: { title?: string; description?: string; prompt?: string; category?: string } }>('/api/prompts/:id', async (request, reply) => {
            const { title, description, prompt: promptText, category } = request.body;
            try {
                if (title) db.prepare('UPDATE prompt_templates SET title = ? WHERE id = ?').run(title, request.params.id);
                if (description !== undefined) db.prepare('UPDATE prompt_templates SET description = ? WHERE id = ?').run(description, request.params.id);
                if (promptText) db.prepare('UPDATE prompt_templates SET prompt = ? WHERE id = ?').run(promptText, request.params.id);
                if (category) db.prepare('UPDATE prompt_templates SET category = ? WHERE id = ?').run(category, request.params.id);
                return { success: true };
            } catch (err: any) { reply.status(500); return { error: err.message }; }
        });

        this.app.delete<{ Params: { id: string } }>('/api/prompts/:id', async (request, reply) => {
            try {
                const row = db.prepare('SELECT is_builtin FROM prompt_templates WHERE id = ?').get(request.params.id) as any;
                if (row?.is_builtin) { reply.status(403); return { error: 'Cannot delete built-in templates' }; }
                db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(request.params.id);
                return { success: true };
            } catch (err: any) { reply.status(500); return { error: err.message }; }
        });

        this.app.post<{ Params: { id: string } }>('/api/prompts/:id/use', async (request, reply) => {
            try {
                db.prepare('UPDATE prompt_templates SET use_count = use_count + 1 WHERE id = ?').run(request.params.id);
                return { success: true };
            } catch (err: any) { reply.status(500); return { error: err.message }; }
        });

        // POST /api/sessions — create a new session
        this.app.post<{ Body: { title?: string } }>('/api/sessions', async (request) => {
            const id = nanoid();
            const title = request.body?.title || '新对话';
            const now = new Date().toISOString();
            db.prepare('INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, title, now, now);
            return { id, title, createdAt: now, updatedAt: now };
        });

        // ===== AUDIT API =====
        this.app.get<{ Querystring: any }>('/api/audit/executions', async (request) => {
            const q = request.query as any;
            const filter = {
                type: q.type,
                status: q.status,
                triggerSource: q.triggerSource,
                startAfter: q.startAfter,
                startBefore: q.startBefore,
                sessionId: q.sessionId,
                limit: q.limit ? parseInt(q.limit, 10) : 50,
                offset: q.offset ? parseInt(q.offset, 10) : 0,
            };
            const total = auditRepository.countExecutions(filter);
            const items = auditRepository.listExecutions(filter);
            return { total, items };
        });

        this.app.get<{ Params: { id: string } }>('/api/audit/executions/:id', async (request, reply) => {
            const record = auditRepository.getExecution(request.params.id);
            if (!record) { reply.status(404); return { error: 'Not found' }; }
            return record;
        });

        this.app.get<{ Querystring: any }>('/api/audit/approvals', async (request) => {
            const q = request.query as any;
            const filter = {
                decision: q.decision,
                sessionId: q.sessionId,
                startAfter: q.startAfter,
                startBefore: q.startBefore,
                limit: q.limit ? parseInt(q.limit, 10) : 50,
                offset: q.offset ? parseInt(q.offset, 10) : 0,
            };
            const total = auditRepository.countApprovals(filter);
            const items = auditRepository.listApprovals(filter);
            return { total, items };
        });

        this.app.get<{ Querystring: any }>('/api/audit/scheduled-runs', async (request) => {
            const q = request.query as any;
            const filter = {
                scheduledTaskId: q.scheduledTaskId,
                status: q.status,
                startAfter: q.startAfter,
                limit: q.limit ? parseInt(q.limit, 10) : 50,
                offset: q.offset ? parseInt(q.offset, 10) : 0,
            };
            const items = auditRepository.listScheduledRuns(filter);
            return { total: items.length, items };
        });

        this.app.get<{ Params: { taskId: string }; Querystring: { limit?: string } }>(
            '/api/audit/scheduled-runs/:taskId/history',
            async (request) => {
                const limit = request.query.limit ? parseInt(request.query.limit, 10) : 20;
                const runs = auditRepository.getRunsForTask(request.params.taskId, limit);
                const successCount = runs.filter(r => r.status === 'success').length;
                const durations = runs.filter(r => r.durationMs != null).map(r => r.durationMs!);
                const avgDurationMs = durations.length
                    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
                    : 0;
                return {
                    runs,
                    stats: {
                        successRate: runs.length ? Math.round((successCount / runs.length) * 1000) / 10 : 0,
                        avgDurationMs,
                    },
                };
            }
        );

        this.app.get<{ Querystring: { from: string; to: string; format?: string } }>(
            '/api/audit/report',
            async (request, reply) => {
                const { from, to, format } = request.query as { from: string; to: string; format?: string };
                if (!from || !to) { reply.status(400); return { error: 'from and to are required' }; }
                const report = auditRepository.generateReportData(from, to);
                if (format === 'csv') {
                    const csv = auditRepository.exportToCSV(report);
                    reply.header('Content-Type', 'text/csv; charset=utf-8');
                    reply.header('Content-Disposition', `attachment; filename="audit-report-${from}-${to}.csv"`);
                    return reply.send(csv);
                }
                return report;
            }
        );

        // ===== TRACE API — Phase 21 =====
        // GET /api/audit/traces — 分页列出最近 traceId
        this.app.get<{ Querystring: { sessionId?: string; limit?: string; offset?: string } }>(
            '/api/audit/traces',
            async (request) => {
                const { sessionId, limit, offset } = request.query as Record<string, string | undefined>;
                const { spanRecorder: sr } = await import('../core/trace.js');
                const items = sr.listTraces({
                    sessionId,
                    limit: limit ? parseInt(limit, 10) : 20,
                    offset: offset ? parseInt(offset, 10) : 0,
                });
                return { items };
            }
        );

        // GET /api/audit/traces/:traceId — 获取某次 trace 的所有 spans（用于瀑布图）
        this.app.get<{ Params: { traceId: string } }>(
            '/api/audit/traces/:traceId',
            async (request, reply) => {
                const { spanRecorder: sr } = await import('../core/trace.js');
                const spans = sr.getTrace(request.params.traceId);
                if (spans.length === 0) {
                    reply.status(404);
                    return { error: 'Trace not found' };
                }
                return { traceId: request.params.traceId, spans };
            }
        );

        // ===== IM GATEWAY API =====
        // GET /api/im/status — IM integration status
        this.app.get('/api/im/status', async () => {
            return {
                enabled: this.config.im?.enabled ?? false,
                platform: this.config.im?.platform ?? null,
                connected: !!this.imGateway,
            };
        });

        // POST /api/im/inbound — IM event push endpoint
        this.app.post<{ Body: unknown }>('/api/im/inbound', {
            config: { rawBody: true },
        }, async (request, reply) => {
            if (!this.imGateway) {
                reply.status(503);
                return { error: 'IM gateway not configured' };
            }
            const rawBody = (request as any).rawBody ?? JSON.stringify(request.body);
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(request.headers)) {
                if (typeof v === 'string') headers[k] = v;
            }
            const result = await this.imGateway.handleInbound(rawBody, headers) as any;
            if (result?.code === 401) { reply.status(401); return { error: result.error }; }
            if (result?.code === 400) { reply.status(400); return { error: result.error }; }
            return result;
        });

        // POST /api/im/card-action — HitL approval card callback
        this.app.post<{ Body: unknown }>('/api/im/card-action', async (request, reply) => {
            if (!this.imGateway) {
                reply.status(503);
                return { error: 'IM gateway not configured' };
            }
            return this.imGateway.handleCardAction(request.body);
        });

        // GET /api/im/users — list IM users
        this.app.get<{ Querystring: { platform?: string } }>('/api/im/users', async (request) => {
            return imUserRegistry.listUsers(request.query.platform);
        });

        // POST /api/im/users — add/update IM user whitelist
        this.app.post<{ Body: { platform: string; imUserId: string; name?: string; role?: string; enabled?: boolean } }>(
            '/api/im/users',
            async (request, reply) => {
                try {
                    const { platform, imUserId, name, role, enabled } = request.body;
                    if (!platform || !imUserId) { reply.status(400); return { error: 'platform and imUserId are required' }; }
                    const id = imUserRegistry.upsertUser({ platform, imUserId, name, role, enabled });
                    return { success: true, id };
                } catch (err: any) {
                    reply.status(500); return { error: err.message };
                }
            }
        );

        // PATCH /api/im/users/:id — update user
        this.app.patch<{ Params: { id: string }; Body: { role?: string; enabled?: boolean; name?: string } }>(
            '/api/im/users/:id',
            async (request, reply) => {
                try {
                    const row = db.prepare('SELECT * FROM im_users WHERE id = ?').get(request.params.id) as any;
                    if (!row) { reply.status(404); return { error: 'User not found' }; }
                    const now = new Date().toISOString();
                    const { role, enabled, name } = request.body;
                    db.prepare('UPDATE im_users SET role = ?, enabled = ?, name = ?, updated_at = ? WHERE id = ?')
                        .run(
                            role ?? row.role,
                            enabled !== undefined ? (enabled ? 1 : 0) : row.enabled,
                            name ?? row.name,
                            now,
                            request.params.id
                        );
                    return { success: true };
                } catch (err: any) {
                    reply.status(500); return { error: err.message };
                }
            }
        );

        // DELETE /api/im/users/:id
        this.app.delete<{ Params: { id: string } }>('/api/im/users/:id', async (request, reply) => {
            try {
                imUserRegistry.deleteUser(request.params.id);
                return { success: true };
            } catch (err: any) {
                reply.status(500); return { error: err.message };
            }
        });

        // GET /api/im/sessions
        this.app.get<{ Querystring: { platform?: string } }>('/api/im/sessions', async (request) => {
            return imSessionMapper.listSessions(request.query.platform);
        });

        // POST /api/im/send — internal API used by im-bot skill to send messages
        this.app.post<{ Body: { platform: string; conversationId: string; userId: string; type: string; content?: string; title?: string; template?: string } }>(
            '/api/im/send',
            async (request, reply) => {
                if (!this.imGateway) {
                    // Mock mode: log only
                    this.logger.info(`[im-bot] Mock send: ${JSON.stringify(request.body)}`);
                    return { success: true, mock: true };
                }
                try {
                    const { platform, conversationId, userId, type, content, title, template } = request.body;
                    const target = { platform, conversationId, userId };
                    if (type === 'text') {
                        await (this.imGateway as any).adapter.sendMessage(target, content ?? '');
                    } else if (type === 'card') {
                        await (this.imGateway as any).adapter.sendMessage(target,
                            `**${title}**\n\n${content}`
                        );
                    }
                    return { success: true };
                } catch (err: any) {
                    reply.status(500); return { error: err.message };
                }
            }
        );

        // ===== AGENT GATEWAY =====
        this.agentGateway.registerRoutes(this.app);

        // ===== MANAGED AGENTS HARNESS API (Phase 23) =====
        this.setupAgentPoolRoutes();
    }

    private setupAgentPoolRoutes(): void {
        const pool = this.agentPool;
        if (!pool) return;

        // GET /api/agents/specs — 列出所有已注册 AgentSpec
        this.app.get('/api/agents/specs', async () => {
            return pool.listSpecs().map(s => ({
                id: s.id,
                name: s.name,
                version: s.version,
                description: s.description,
                tools: s.tools,
                resources: s.resources,
                hasOutcome: !!s.outcome,
            }));
        });

        // POST /api/agents/specs — 动态注册 AgentSpec（JSON body）
        this.app.post<{ Body: any }>('/api/agents/specs', async (request, reply) => {
            try {
                const spec = request.body as Record<string, any>;
                if (!spec['id'] || !spec['name']) {
                    reply.status(400); return { error: 'id and name are required' };
                }
                pool.registerSpec(spec as any);
                return { success: true, id: spec['id'] };
            } catch (err: any) {
                reply.status(400); return { error: err.message };
            }
        });

        // DELETE /api/agents/specs/:id — 移除 AgentSpec
        this.app.delete<{ Params: { id: string } }>('/api/agents/specs/:id', async (request, reply) => {
            pool.unregisterSpec(request.params.id);
            return { success: true };
        });

        // GET /api/agents/instances — 列出所有运行实例
        this.app.get('/api/agents/instances', async () => {
            return pool.listInstances();
        });

        // POST /api/agents/spawn — 手动创建实例
        this.app.post<{ Body: { specId: string; task: string; sessionId?: string } }>('/api/agents/spawn', async (request, reply) => {
            const { specId, task, sessionId } = request.body;
            if (!specId || !task) {
                reply.status(400); return { error: 'specId and task are required' };
            }
            try {
                const sid = sessionId ?? `harness-${Date.now()}`;
                const memory = this.sessionManager.getSession(sid);
                const instanceId = await pool.spawn(specId, task, { sessionId: sid, memory });
                return { instanceId, specId };
            } catch (err: any) {
                reply.status(404); return { error: err.message };
            }
        });

        // GET /api/agents/instances/:id — 实例详情 + steps
        this.app.get<{ Params: { id: string } }>('/api/agents/instances/:id', async (request, reply) => {
            const info = pool.listInstances().find(i => i.instanceId === request.params.id);
            if (!info) { reply.status(404); return { error: 'Instance not found' }; }
            const steps = pool.getInstanceSteps(request.params.id);
            return { ...info, steps };
        });

        // PATCH /api/agents/instances/:id — pause / resume / cancel
        this.app.patch<{ Params: { id: string }; Body: { action: string } }>('/api/agents/instances/:id', async (request, reply) => {
            const { id } = request.params;
            const { action } = request.body;
            switch (action) {
                case 'pause':   pool.pause(id); break;
                case 'resume':  pool.resume(id); break;
                case 'cancel':  pool.cancel(id); break;
                default: reply.status(400); return { error: `Unknown action: ${action}` };
            }
            return { success: true, action, instanceId: id };
        });

        // GET /api/agents/instances/:id/steps — 获取实例步骤历史
        this.app.get<{ Params: { id: string } }>('/api/agents/instances/:id/steps', async (request, reply) => {
            const steps = pool.getInstanceSteps(request.params.id);
            if (!steps) { reply.status(404); return { error: 'Instance not found' }; }
            return { steps };
        });

        // GET /api/agents/sessions/:id/events — 获取 Session 事件日志，支持 EventSelector 过滤（Gap 5）
        // 查询参数：types（逗号分隔）、toolName、last（数字）、from（Unix ms）、to（Unix ms）
        this.app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
            '/api/agents/sessions/:id/events',
            async (request) => {
                const { id } = request.params;
                const q = request.query;

                const selector = Object.keys(q).length > 0 ? {
                    types: q.types ? (q.types.split(',') as any) : undefined,
                    toolName: q.toolName ?? undefined,
                    last: q.last ? parseInt(q.last, 10) : undefined,
                    fromTimestamp: q.from ? parseInt(q.from, 10) : undefined,
                    toTimestamp: q.to ? parseInt(q.to, 10) : undefined,
                } : undefined;

                const events = selector
                    ? pool.getSessionEvents(id, selector)
                    : pool.getSessionEvents(id);

                return { sessionId: id, count: events.length, events };
            }
        );

        this.logger.info('[harness] Managed Agents API routes registered (/api/agents/*)');
    }

    async start(port: number, host: string): Promise<void> {
        try {
            await this.app.listen({ port, host });
            this.logger.info(`Server listening on http://${host}:${port}`);
        } catch (error) {
            this.logger.error(`Failed to start server: ${error}`);
            throw error;
        }
    }

    async stop(): Promise<void> {
        await this.app.close();
        this.logger.info('Server stopped');
    }
}
