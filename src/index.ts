import 'dotenv/config';
import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { llmFactory } from './llm/index.js';
import { SkillRegistry, SkillLoader, McpSkillSource } from './skills/index.js';
import { Agent } from './core/index.js';
import { SessionMemoryManager, LongTermMemory } from './memory/index.js';
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

    // Load configuration
    const config = await loadConfig();

    // Create logger
    const logger = createLogger({
        level: config.logging.level,
        prettyPrint: config.logging.prettyPrint,
    });

    logger.info('Starting CMaster Bot...');

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

    // Initialize long-term memory
    let longTermMemory: LongTermMemory | undefined;
    if (config.memory.longTerm.enabled) {
        // M5: 选择支持 embedding 的提供商
        // 优先级：config.models.embeddingProvider > 第一个 openai/ollama/gemini 类型的提供商 > 默认提供商
        const embeddingProviderName = config.models.embeddingProvider
            ?? Object.entries(config.models.providers).find(
                ([, cfg]) => cfg.type === 'openai' || cfg.type === 'ollama' || cfg.type === 'gemini'
            )?.[0]
            ?? config.models.default;

        const embeddingLlmConfig = config.models.providers[embeddingProviderName];
        logger.info(`[memory] Using provider "${embeddingProviderName}" for embeddings (model: ${embeddingLlmConfig?.embeddingModel ?? 'default'})`);

        const embeddingFn = async (texts: string[]) => {
            const adapter = llmFactory.getAdapter(embeddingProviderName, embeddingLlmConfig);
            return adapter.embeddings(texts);
        };

        longTermMemory = new LongTermMemory({ db, logger, embeddingFn });
        longTermMemory.initialize();
        logger.info('Long-term memory initialized (SQLite)');
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

    // Phase 21: 初始化统一内存路由器
    if (longTermMemory) {
        initMemoryRouter(longTermMemory, knowledgeGraph, sessionManager);
    }
    const { memoryRouter } = await import('./memory/memory-router.js');

    // Initialize agent with dynamic LLM getter for hot-reloading
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
    });

    // Phase 24: SessionEventStore — Session 持久层（Meta-Harness Brain/Hands/Session 解耦）
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
        credentialVault
    );

    // Phase 23: 加载 SOUL.md Agent 规格（新格式 + 兼容旧格式）
    const soulLoader = new SoulLoader(agentPool, logger);
    await soulLoader.loadAgents(path.join(process.cwd(), 'agents'));
    await soulLoader.loadAgents(path.join(process.cwd(), 'agents/builtin'));

    // Phase 24: 启动时扫描未完成 session，自动 wake（Harness as Cattle）
    await agentPool.scanAndWake();

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

    // Start gateway server
    const server = new GatewayServer({
        agent,
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
