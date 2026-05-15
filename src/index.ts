import 'dotenv/config';
import { initOtel } from './observability/otel.js';
import { setupDefaultHooks } from './core/hooks/setup.js';
import { globalHookRegistry } from './core/hooks/registry.js';
import { LegacySelfHostedAgent } from './core/agent/legacy.js';
import { ClaudeManagedAgent } from './core/agent/claude-managed.js';
import { AgentRouter } from './core/agent/router.js';
import { createDefaultFeatureFlagService } from './config/feature-flag.js';
import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { llmFactory } from './llm/index.js';
import { SkillRegistry, SkillLoader, McpSkillSource } from './skills/index.js';
import { Agent } from './core/index.js';
import { SessionMemoryManager, LongTermMemory, EpisodicMemoryStore, SemanticMemoryStore } from './memory/index.js';
import { ProceduralMemory } from './memory/procedural.js';
import { initDuckDB } from './persistence/duckdb-client.js';
import { createEmbedderFromEnv } from './memory/embedder.js';
import { GatewayServer } from './gateway/index.js';
import { db } from './core/database.js';
import fs from 'fs';
import path from 'path';
import type { McpServerConfig } from './types.js';
import { nanoid } from 'nanoid';
import { SchedulerService } from './core/scheduler.js';
import { KnowledgeGraph } from './memory/knowledge-graph.js';
import { MultiAgentOrchestrator } from './core/multi-agent.js';
import { SkillGenerator } from './core/skill-generator.js';
import { ConnectorManager } from './skills/connector-source.js';
import { SelfImprovementEngine } from './core/self-improvement.js';
import { initMemoryRouter } from './memory/memory-router.js';
import { SoulLoader } from './core/soul-loader.js';
import { AgentPool, SessionEventStore, CredentialVault } from './core/harness/agent-pool.js';
import { CheckpointManager } from './core/checkpoint-manager.js';
import { historyRepository } from './core/repository.js';

async function main() {
    console.log(`
   ██████╗███╗   ███╗ █████╗ ███████╗████████╗███████╗██████╗ 
  ██╔════╝████╗ ████║██╔══██╗██╔════╝╚══██╔══╝██╔════╝██╔══██╗
  ██║     ██╔████╔██║███████║███████╗   ██║   █████╗  ██████╔╝
  ██║     ██║╚██╔╝██║██╔══██║╚════██║   ██║   ██╔══╝  ██╔══██╗
  ╚██████╗██║ ╚═╝ ██║██║  ██║███████║   ██║   ███████╗██║  ██║
   ╚═════╝╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
                    Enterprise AI Assistant
  `);

    // 初始化 OTel（在加载配置前，确保追踪从最早时刻生效）
    initOtel({ serviceName: 'masterbot' });

    // Load configuration
    const config = await loadConfig();

    // Create logger
    const logger = createLogger({
        level: config.logging.level,
        prettyPrint: config.logging.prettyPrint,
    });

    logger.info('Starting CMaster Bot...');

    // Phase 2: 注册内置 Hook（sandbox/retry/audit/otel）
    // Phase 3 ClaudeManagedAgent 上线后将自动从 globalHookRegistry 获益
    setupDefaultHooks({
        sandbox: config.skills.shell?.sandbox,
        logger,
    });

    logger.info(`LLM system ready (Default: ${config.models.default})`);

    // Initialize skill system
    const skillRegistry = new SkillRegistry(logger);
    const skillLoader = new SkillLoader(skillRegistry, logger);

    if (config.skills.autoLoad) {
        await skillLoader.loadFromDirectories(config.skills.directories);
        const tools = await skillRegistry.getToolDefinitions();
        logger.info(`Skill system initialized with ${tools.length} tools`);
    }

    // Initialize memory
    const sessionManager = new SessionMemoryManager({
        maxMessages: config.memory.shortTerm.maxMessages,
        maxSessions: config.memory.shortTerm.maxSessions ?? 100,
        logger,
    });

    // Initialize long-term memory (v2: FTS5 搜索，无 embedding 依赖)
    let longTermMemory: LongTermMemory | undefined;
    if (config.memory.longTerm.enabled) {
        longTermMemory = new LongTermMemory({ db, logger, dataDir: 'data/.memory' });
        longTermMemory.initialize();
        logger.info('[memory] Long-term memory initialized (FTS5, no embedding)');
    }

    // Initialize new services (must be before Agent so they can be injected)
    const connectorManager = new ConnectorManager('connectors', logger);
    const connectorSources = await connectorManager.loadAll();
    for (const source of connectorSources) {
        await skillRegistry.registerSource(source);
        logger.info(`Connector "${source.name}" loaded`);
    }

    const getLlm = () => {
        const provider = config.models.default;
        return llmFactory.getAdapter(provider, config.models.providers[provider]);
    };

    const knowledgeGraph = new KnowledgeGraph(getLlm(), logger);
    const orchestrator = new MultiAgentOrchestrator(logger);
    const skillGenerator = new SkillGenerator(getLlm(), logger);

    // Phase 6.5: 初始化 DuckDB VSS + Embedder（可选，失败不影响启动）
    const embedder = createEmbedderFromEnv(logger);
    const duckdbClient = embedder
        ? await initDuckDB(path.join('data', 'vectors.duckdb'), logger, 1536)
        : undefined;
    if (duckdbClient?.isReady()) {
        logger.info('[memory] DuckDB VSS initialized — vector semantic search enabled');
    } else {
        logger.info('[memory] DuckDB VSS disabled (OPENAI_API_KEY not set or DuckDB unavailable)');
    }

    // Phase 6: 初始化四层记忆存储
    const episodicStore = new EpisodicMemoryStore(db, logger, duckdbClient, embedder);
    episodicStore.initialize();

    const semanticStore = new SemanticMemoryStore(db, logger);
    semanticStore.initialize();

    const proceduralMemory = new ProceduralMemory(process.cwd(), logger);
    await proceduralMemory.initialize();
    logger.info('[memory] Phase 6 four-layer memory stores initialized');

    // Phase 21: 初始化统一内存路由器（Phase 6 四层存储独立于 longTerm 是否启用）
    initMemoryRouter(longTermMemory, knowledgeGraph, sessionManager, episodicStore, semanticStore, proceduralMemory);
    const { memoryRouter } = await import('./memory/memory-router.js');

    // Phase 24: SessionEventStore — Session 持久层（Meta-Harness Brain/Hands/Session 解耦）
    // 注意：移到 Agent 创建前，确保 sessionStore 可以直接注入 Agent
    const sessionStore = new SessionEventStore(db);

    // Phase 25: CredentialVault — 凭证隔离层（Gap 4）
    // VAULT_MASTER_KEY 未设置时退化为 DEV 模式（用固定 key），生产环境必须设置
    const vaultMasterKey = process.env.VAULT_MASTER_KEY ?? 'masterbot-dev-key-change-in-production';
    if (!process.env.VAULT_MASTER_KEY) {
        logger.warn('[credential-vault] VAULT_MASTER_KEY not set — using default dev key (unsafe for production)');
    }
    const credentialVault = new CredentialVault(db, vaultMasterKey, sessionStore);

    // Phase 23: 初始化 AgentPool（Managed Agents Harness）
    const agentPool = new AgentPool(
        (provider?: string) => {
            const p = provider ?? config.models.default;
            const llmConfig = config.models.providers[p] ?? config.models.providers[config.models.default];
            return llmFactory.getAdapter(p, llmConfig);
        },
        skillRegistry,
        logger,
        longTermMemory,
        memoryRouter,
        sessionStore,
        credentialVault,
        // D3: 注入 sessionMemoryManager，使 wake 恢复时可访问短期记忆
        sessionManager,
        // 注入 db，用于 agent 实例持久化（重启后历史记录不丢失）
        db
    );

    // Phase 23: 加载 SOUL.md Agent 规格（新格式 + 兼容旧格式）
    const soulLoader = new SoulLoader(agentPool, logger);
    await soulLoader.loadAgents(path.join(process.cwd(), 'agents'));
    await soulLoader.loadAgents(path.join(process.cwd(), 'agents/builtin'));

    // Phase 28: 将 MultiAgentOrchestrator 中的旧 Worker 统一注册为 AgentSpec
    if (typeof orchestrator.hasWorkers === 'function' && orchestrator.hasWorkers()) {
        for (const worker of orchestrator.listWorkers()) {
            if (!agentPool.getSpec(worker.id)) {
                agentPool.registerLegacyWorker(
                    worker.id,
                    worker.name,
                    worker.description ?? '',
                    worker.systemPrompt,
                    worker.skills
                );
                logger.info(`[startup] Legacy worker "${worker.name}" registered as AgentSpec`);
            }
        }
    }

    // Phase 24: 启动时扫描未完成 session，自动 wake（Harness as Cattle）
    await agentPool.scanAndWake();

    // Phase 26: Agent 在 agentPool 创建后初始化，确保 agentPool 和 sessionStore 可直接注入
    const agent = new Agent({
        llm: () => {
            const provider = config.models.default;
            const llmConfig = config.models.providers[provider];
            return llmFactory.getAdapter(provider, llmConfig);
        },
        skillRegistry,
        logger,
        maxIterations: config.agent?.maxIterations ?? 10,
        maxContextTokens: config.agent?.maxContextTokens,
        longTermMemory,
        memoryRouter,
        skillConfig: {
            sandbox: config.skills.shell?.sandbox,
        },
        skillGenerator,
        orchestrator,
        knowledgeGraph,
        sessionStore,
        agentPool,
    });

    // Phase 5: 检查点管理器（先于 agentRouter 初始化，供 ClaudeManagedAgent 使用）
    const checkpointManagerForAgent = new CheckpointManager(db, logger);
    checkpointManagerForAgent.initialize();

    // Phase 3: 构建 AgentRouter（ClaudeManagedAgent + LegacySelfHostedAgent 双引擎）
    const featureFlags = createDefaultFeatureFlagService();
    const agentRouter = new AgentRouter({
        legacyFactory: () => new LegacySelfHostedAgent({
            llm: () => {
                const provider = config.models.default;
                const llmConfig = config.models.providers[provider];
                return llmFactory.getAdapter(provider, llmConfig);
            },
            skillRegistry,
            logger,
            maxIterations: config.agent?.maxIterations ?? 10,
            maxContextTokens: config.agent?.maxContextTokens,
            longTermMemory,
            memoryRouter,
            skillConfig: { sandbox: config.skills.shell?.sandbox },
            skillGenerator,
            orchestrator,
            knowledgeGraph,
            sessionStore,
            memoryFactory: (sessionId) => sessionManager.getSession(sessionId),
        }),
        claudeFactory: () => new ClaudeManagedAgent({
            hookRegistry: globalHookRegistry,
            skillRegistry,
            logger,
            memoryFactory: (sessionId) => sessionManager.getSession(sessionId),
            defaultModel: config.models.providers['anthropic']?.model ?? 'claude-sonnet-4-6',
            maxTurns: 50,
            // Phase 5: fork/checkpoint 支持
            checkpointManager: checkpointManagerForAgent,
            historyRepository,
            onFork: (parentId, newId) => historyRepository.recordFork(parentId, newId),
        }),
        featureFlags,
        logger,
    });
    logger.info(`[Phase 3] AgentRouter 已初始化（灰度: ${process.env['CLAUDE_MANAGED_AGENT_ROLLOUT_PERCENT'] ?? '5'}%）`);

    const scheduler = new SchedulerService(logger);

    // Initialize self-improvement engine
    const selfImprovementEngine = new SelfImprovementEngine(agent, logger);
    logger.info('Self-improvement engine initialized');

    // Load MCP server configs and register sources
    const mcpConfigPath = path.join(process.cwd(), 'mcp-servers.json');
    if (fs.existsSync(mcpConfigPath)) {
        try {
            const mcpConfigs: McpServerConfig[] = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
            for (const mcpConfig of mcpConfigs) {
                if (!mcpConfig.enabled) continue;
                try {
                    const source = new McpSkillSource(mcpConfig, logger);
                    await skillRegistry.registerSource(source);
                    logger.info(`MCP server "${mcpConfig.name}" connected`);
                } catch (err) {
                    // Non-fatal: log and continue startup
                    logger.warn(`MCP server "${mcpConfig.name}" failed to connect: ${(err as Error).message}`);
                }
            }
        } catch (err) {
            logger.warn(`Failed to load MCP config: ${(err as Error).message}`);
        }
    }

    // Phase 5: checkpointManager 已在 agentRouter 初始化前创建，此处复用同一实例
    const checkpointManager = checkpointManagerForAgent;

    // Start gateway server
    const server = new GatewayServer({
        agent,
        agentRouter,
        sessionManager,
        logger,
        config,
        knowledgeGraph,
        orchestrator,
        skillGenerator,
        skillRegistry,
        connectorManager,
        scheduler,
        selfImprovementEngine,
        agentPool,
        longTermMemory,
        checkpointManager,
        semanticStore,
        episodicStore,
    });

    await server.start(config.server.port, config.server.host);

    // Start scheduler after server is running
    scheduler.setTriggerHandler(async (task, _runId) => {
        const sessionId = task.sessionId || nanoid();
        const memory = sessionManager.getSession(sessionId);
        logger.info(`[scheduler] Executing task "${task.name}"`);
        const { answer } = await agent.execute(task.prompt, { sessionId, memory });
        // runId is already updated by SchedulerService's .then()/.catch() handlers
        return answer;
    });
    scheduler.start();
    logger.info('Scheduler started');

    // Phase 6: 每天凌晨 2 点清理过期 episodic 记忆（90 天 TTL）
    setInterval(() => {
        try {
            const deleted = episodicStore.purgeExpired();
            if (deleted > 0) logger.info(`[episodic] Purged ${deleted} expired memories`);
        } catch (err) {
            logger.warn(`[episodic] purgeExpired failed: ${(err as Error).message}`);
        }
    }, 24 * 60 * 60 * 1000); // every 24 hours

    // Graceful shutdown
    const shutdown = async () => {
        logger.info('Shutting down...');
        await server.stop();
        sessionManager.destroy();
        await skillRegistry.unregisterAll();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((error) => {
    console.error('Failed to start:', error);
    process.exit(1);
});
