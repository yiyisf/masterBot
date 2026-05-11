/**
 * Phase 2: LegacySelfHostedAgent
 * 将现有 Agent 类包装为 IAgent 接口实现。
 * 不修改 Agent 内部实现，保持 ExecutionStep 流式输出。
 */

import type { IAgent, AgentInput, AgentEvent, AgentCapabilities } from './types.js';
import { Agent } from '../agent.js';
import type { LLMAdapter, MemoryAccess, Logger } from '../../types.js';
import type { ISkillRegistry } from '../../skills/registry.js';
import type { LongTermMemory } from '../../memory/long-term.js';
import type { MemoryRouter } from '../../memory/memory-router.js';
import type { SessionEventStore } from '../harness/session-store.js';

export interface LegacyAgentDeps {
    llm: LLMAdapter | (() => LLMAdapter);
    skillRegistry: ISkillRegistry;
    logger: Logger;
    maxIterations?: number;
    maxContextTokens?: number;
    longTermMemory?: LongTermMemory;
    memoryRouter?: MemoryRouter;
    skillConfig?: Record<string, unknown>;
    skillGenerator?: unknown;
    orchestrator?: unknown;
    knowledgeGraph?: unknown;
    deepThinkingProvider?: () => LLMAdapter;
    sessionStore?: SessionEventStore;
    /** 每次 execute 调用时注入会话短期记忆 */
    memoryFactory?: (sessionId: string) => MemoryAccess;
}

export class LegacySelfHostedAgent implements IAgent {
    private readonly agent: Agent;
    private readonly deps: LegacyAgentDeps;

    constructor(deps: LegacyAgentDeps) {
        this.deps = deps;
        this.agent = new Agent({
            llm: deps.llm,
            skillRegistry: deps.skillRegistry,
            logger: deps.logger,
            maxIterations: deps.maxIterations,
            maxContextTokens: deps.maxContextTokens,
            longTermMemory: deps.longTermMemory,
            memoryRouter: deps.memoryRouter,
            skillConfig: deps.skillConfig,
            skillGenerator: deps.skillGenerator,
            orchestrator: deps.orchestrator,
            knowledgeGraph: deps.knowledgeGraph,
            deepThinkingProvider: deps.deepThinkingProvider,
            sessionStore: deps.sessionStore,
        });
    }

    async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
        const memory = this.deps.memoryFactory?.(input.sessionId) ?? makeFallbackMemory();

        const gen = this.agent.run(input.message, {
            sessionId: input.sessionId,
            userId: input.userId,
            memory,
        });

        for await (const step of gen) {
            yield {
                type: mapStepType(step.type),
                data: step,
                timestamp: Date.now(),
            };
        }
    }

    // eslint-disable-next-line require-yield
    async *resume(_sessionId: string): AsyncGenerator<AgentEvent> {
        throw new Error('LegacySelfHostedAgent does not support resume — use sessionStore to reload history');
    }

    async fork(_sessionId: string): Promise<string> {
        throw new Error('LegacySelfHostedAgent does not support fork');
    }

    async checkpoint(_sessionId: string): Promise<string> {
        throw new Error('LegacySelfHostedAgent does not support checkpoint');
    }

    capabilities(): AgentCapabilities {
        return {
            supportsStreaming: true,
            supportsFork: false,
            supportsCheckpoint: false,
            maxContextTokens: 200_000,
        };
    }
}

function mapStepType(type: string): AgentEvent['type'] {
    switch (type) {
        case 'thought': return 'thinking';
        case 'action': return 'tool_call';
        case 'observation': return 'tool_result';
        case 'answer':
        case 'content': return 'text';
        case 'meta':
        case 'context_compressed':
        case 'grading':
        case 'grade_result':
        case 'agent_spawned': return 'state_update';
        default: return 'text';
    }
}

function makeFallbackMemory(): MemoryAccess {
    const store = new Map<string, unknown>();
    return {
        async get(key) { return store.get(key); },
        async set(key, value) { store.set(key, value); },
        async search() { return []; },
    };
}
