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
        // Create embedding function from default LLM provider
        const embeddingFn = async (texts: string[]) => {
            const provider = config.models.default;
            const llmConfig = config.models.providers[provider];
            const adapter = llmFactory.getAdapter(provider, llmConfig);
            return adapter.embeddings(texts);
        };

        longTermMemory = new LongTermMemory({ db, logger, embeddingFn });
        longTermMemory.initialize();
        logger.info('Long-term memory initialized (SQLite)');
    }

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
        skillConfig: {
            sandbox: config.skills.shell?.sandbox,
        },
    });

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
    });

    await server.start(config.server.port, config.server.host);

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
