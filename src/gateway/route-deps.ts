import type { Config, Logger } from '../types.js';
import type { Agent } from '../core/agent.js';
import type { SessionMemoryManager } from '../memory/short-term.js';
import type { SelfImprovementEngine } from '../core/self-improvement.js';
import type { ImGateway } from './im-gateway.js';
import type { AgentPool } from '../core/harness/agent-pool.js';
import type { LongTermMemory } from '../memory/long-term.js';
import type { CheckpointManager } from '../core/checkpoint-manager.js';

/**
 * P0-4: server.ts 拆分为 Fastify 插件模块（src/gateway/routes/*.ts）后，
 * 各插件通过此共享依赖包访问 GatewayServer 持有的协作对象，取代原来的 `this.x`。
 */
export interface GatewayDeps {
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
    imGateway?: ImGateway;
    agentPool?: AgentPool;
    longTermMemory?: LongTermMemory;
    checkpointManager?: CheckpointManager;
}
