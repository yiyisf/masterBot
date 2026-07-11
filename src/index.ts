import 'dotenv/config';
import { initOtel } from './core/otel.js';
import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { llmFactory } from './llm/index.js';
import { SkillRegistry, SkillLoader, McpSkillSource } from './skills/index.js';
import { Agent } from './core/index.js';
import { SessionMemoryManager, LongTermMemory } from './memory/index.js';
import { MemoryGovernor } from './memory/memory-governor.js';
import { GatewayServer } from './gateway/index.js';
import { db } from './core/database.js';
import fs from 'fs';
import path from 'path';
import type { McpServerConfig } from './types.js';
import { nanoid } from 'nanoid';
import { SchedulerService } from './core/scheduler.js';
import { KnowledgeGraph } from './memory/knowledge-graph.js';
import { SkillGenerator } from './core/skill-generator.js';
import { ConnectorManager } from './skills/connector-source.js';
import { SelfImprovementEngine } from './core/self-improvement.js';
import { initMemoryRouter } from './memory/memory-router.js';
import { SoulLoader } from './core/soul-loader.js';
import { AgentPool, SessionEventStore, CredentialVault } from './core/harness/agent-pool.js';
import { CheckpointManager } from './core/checkpoint-manager.js';
import { syncSourceRegistry } from './core/requirement-sync.js';
import { GitHubSyncSource } from './core/requirement-sync-github.js';

async function main() {
    // U4: 在所有其他初始化之前启动 OTel（仅当 OTEL_EXPORTER_OTLP_ENDPOINT 配置时生效）
    await initOtel();

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

    // P1-7: token 用量落盘由组合根订阅，LLM 适配器不再直接依赖 DB
    llmFactory.setUsageHandler((usage) => {
        try {
            db.prepare(
                'INSERT INTO token_usage (id, model, prompt_tokens, completion_tokens, total_tokens) VALUES (?, ?, ?, ?, ?)'
            ).run(nanoid(), usage.model, usage.promptTokens, usage.completionTokens, usage.totalTokens);
        } catch (err) {
            logger.warn(`[llm] Failed to record token usage: ${(err as Error).message}`);
        }
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

    // Initialize new services (must be before Agent so they can be injected)
    const connectorManager = new ConnectorManager('connectors', logger);
    const connectorSources = await connectorManager.loadAll();
    for (const source of connectorSources) {
        await skillRegistry.registerSource(source);
        logger.info(`Connector "${source.name}" loaded`);
    }

    // 研发流程管理模块：默认 GitHub 需求同步适配器注册（spec §2.5）
    syncSourceRegistry.register(new GitHubSyncSource());
    logger.info('Requirement sync source "github" registered');

    const getLlm = () => {
        const provider = config.models.default;
        return llmFactory.getAdapter(provider, config.models.providers[provider]);
    };

    // U1: 构造向量嵌入函数，供长期记忆混合检索使用
    // 优先使用 embeddingModel 配置的适配器；如未配置则跳过向量搜索
    const buildEmbedder = (): ((texts: string[]) => Promise<number[][]>) | undefined => {
        const embeddingProvider = config.models.embeddingModel;
        if (!embeddingProvider) return undefined;
        try {
            const embeddingLlm = llmFactory.getAdapter(embeddingProvider, config.models.providers[embeddingProvider]);
            // `embeddings()` is a required LLMAdapter method (always present), but AnthropicAdapter's
            // implementation unconditionally throws — checking `typeof === 'function'` would always
            // pass and wire in a doomed embedder. Only the openai-compatible adapter actually supports it.
            if (embeddingLlm.provider !== 'anthropic') {
                return (texts: string[]) => embeddingLlm.embeddings(texts);
            }
            logger.warn(`[memory] Embedding provider "${embeddingProvider}" (anthropic) does not support embeddings, vector search disabled`);
        } catch (err) {
            logger.warn(`[memory] Embedding provider "${embeddingProvider}" not available, vector search disabled: ${(err as Error).message}`);
        }
        return undefined;
    };

    // Initialize long-term memory (v3: FTS5 + 可选向量混合检索)
    let longTermMemory: LongTermMemory | undefined;
    if (config.memory.longTerm.enabled) {
        const embedder = buildEmbedder();
        longTermMemory = new LongTermMemory({ db, logger, dataDir: 'data/.memory', embedder });
        longTermMemory.initialize();
        logger.info(`[memory] Long-term memory initialized (${embedder ? 'FTS5+Vector hybrid' : 'FTS5'})`);
    }

    // U5: 记忆治理引擎 — 写入查重/冲突检测 + 周期性反思
    let memoryGovernor: MemoryGovernor | undefined;
    if (longTermMemory) {
        memoryGovernor = new MemoryGovernor(longTermMemory, getLlm, logger);
        // 每 24h 反思一次：衰减过期记忆置信度、清理低置信度条目
        const reflectionTimer = setInterval(() => {
            memoryGovernor!.reflect().catch(err =>
                logger.warn(`[memory-gov] Scheduled reflection failed: ${(err as Error).message}`)
            );
        }, 24 * 60 * 60 * 1000);
        reflectionTimer.unref?.();
        logger.info('[memory] Memory governor initialized (dedup/conflict detection + daily reflection)');
    }

    const knowledgeGraph = new KnowledgeGraph(getLlm(), logger);
    const skillGenerator = new SkillGenerator(getLlm(), logger);

    // Phase 21: 初始化统一内存路由器
    if (longTermMemory) {
        initMemoryRouter(longTermMemory, knowledgeGraph);
    }
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
        memoryGovernor,
        memoryRouter,
        skillConfig: {
            sandbox: config.skills.shell?.sandbox,
        },
        skillGenerator,
        knowledgeGraph,
        sessionStore,
        agentPool,
    });

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

    // T2-4: 初始化检查点管理器
    const checkpointManager = new CheckpointManager(db, logger);
    checkpointManager.initialize();

    // Start gateway server
    const server = new GatewayServer({
        agent,
        sessionManager,
        logger,
        config,
        knowledgeGraph,
        skillGenerator,
        skillRegistry,
        connectorManager,
        scheduler,
        selfImprovementEngine,
        agentPool,
        longTermMemory,
        checkpointManager,
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
