import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import type { Config, Logger } from '../types.js';
import { Agent } from '../core/agent.js';
import { SessionMemoryManager } from '../memory/short-term.js';
import { createAuthHook } from './auth.js';
import { registerMcpServerRoutes } from './mcp-server.js';
import type { SelfImprovementEngine } from '../core/self-improvement.js';
import { AgentGateway } from '../core/agent-gateway.js';
import type { AgentPool } from '../core/harness/agent-pool.js';
import { ImGateway, FeishuAdapter } from './im-gateway.js';
import type { GatewayDeps } from './route-deps.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerSkillsRoutes } from './routes/skills.js';
import { registerSessionsRoutes } from './routes/sessions.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerWorkflowRoutes } from './routes/workflows.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerImRoutes } from './routes/im.js';
import { registerAgentPoolRoutes } from './routes/agents.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerRequirementRoutes } from './routes/requirements.js';

/**
 * Gateway 服务器
 * 提供 HTTP 和 WebSocket 接口
 *
 * P0-4: 路由注册已按业务域拆分为 Fastify 插件（./routes/*.ts），本类只负责
 * 组合根装配（依赖收集 → GatewayDeps）、中间件、静态资源与生命周期管理。
 */
export class GatewayServer {
    private app: FastifyInstance;
    private agent: Agent;
    private sessionManager: SessionMemoryManager;
    private logger: Logger;
    private config: Config;
    private knowledgeGraph?: any;
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

    /**
     * 组装路由插件所需的依赖包（P0-4）。
     */
    private buildRouteDeps(): GatewayDeps {
        return {
            agent: this.agent,
            sessionManager: this.sessionManager,
            logger: this.logger,
            config: this.config,
            knowledgeGraph: this.knowledgeGraph,
            skillGenerator: this.skillGenerator,
            skillRegistry: this.skillRegistry,
            connectorManager: this.connectorManager,
            scheduler: this.scheduler,
            selfImprovementEngine: this.selfImprovementEngine,
            imGateway: this.imGateway,
            agentPool: this.agentPool,
            longTermMemory: this.longTermMemory,
            checkpointManager: this.checkpointManager,
        };
    }

    private setupRoutes(): void {
        // Health check
        this.app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

        // U6: MCP Server 模式 — 技能注册表经 Streamable HTTP 暴露给外部 MCP 客户端
        if (this.skillRegistry) {
            registerMcpServerRoutes(this.app, {
                registry: this.skillRegistry,
                logger: this.logger,
                getMemory: (sessionId) => this.sessionManager.getSession(sessionId),
            });
        }

        const deps = this.buildRouteDeps();
        registerChatRoutes(this.app, deps);
        registerSkillsRoutes(this.app, deps);
        registerSessionsRoutes(this.app, deps);
        registerAdminRoutes(this.app, deps);
        registerWorkflowRoutes(this.app, deps);
        registerAuditRoutes(this.app, deps);
        registerImRoutes(this.app, deps);
        registerAgentPoolRoutes(this.app, deps);
        registerProjectRoutes(this.app, deps);
        registerRequirementRoutes(this.app, deps);

        // ===== AGENT GATEWAY =====
        this.agentGateway.registerRoutes(this.app);
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
