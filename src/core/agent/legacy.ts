/**
 * Phase 2: LegacySelfHostedAgent
 * 将现有 Agent 类包装为 IAgent 接口实现。
 * 不修改 Agent 内部实现，保持 ExecutionStep 流式输出。
 */

import type { IAgent, AgentInput, AgentEvent, AgentCapabilities } from './types.js';
import { Agent } from '../agent.js';
import type { LLMAdapter, MemoryAccess, Logger, ExecutionStep } from '../../types.js';
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
            tenantId: input.tenantId,
            memory,
            abortSignal: input.abortSignal,
        });

        for await (const step of gen) {
            yield stepToAgentEvent(step);
        }
    }

    // eslint-disable-next-line require-yield
    async *resume(_sessionId: string): AsyncGenerator<AgentEvent> {
        throw new Error('LegacySelfHostedAgent does not support resume — use sessionStore to reload history');
    }

    async fork(_sessionId: string): Promise<string> {
        throw new Error('LegacySelfHostedAgent does not support fork');
    }

    async checkpoint(_sessionId: string, _label?: string): Promise<string> {
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

/**
 * ExecutionStep → AgentEvent 的完整映射。
 * 确保 data 字段名与 agentEventToExecutionStep 期望的 SDK 格式对齐：
 *   - text 事件：  data.text
 *   - thinking:    data.thinking
 *   - tool_call:   data.toolName / data.toolInput
 *   - tool_result: data.result / data.toolName
 *   - state_update + result_success: data.result
 */
function stepToAgentEvent(step: ExecutionStep): AgentEvent {
    const timestamp = step.timestamp instanceof Date ? step.timestamp.getTime() : Date.now();
    const content = step.content ?? '';

    switch (step.type) {
        case 'answer':
            return {
                type: 'text',
                data: { text: content, subtype: 'result_success', result: content },
                timestamp,
            };
        case 'content':
            return { type: 'text', data: { text: content }, timestamp };
        case 'thought':
            return { type: 'thinking', data: { thinking: content }, timestamp };
        case 'action':
            return {
                type: 'tool_call',
                data: { toolName: step.toolName ?? '', toolInput: step.toolInput ?? {} },
                timestamp,
            };
        case 'observation':
            return {
                type: 'tool_result',
                data: { result: content, toolName: step.toolName, toolOutput: step.toolOutput },
                timestamp,
            };
        case 'context_compressed':
            return {
                type: 'state_update',
                data: { subtype: 'context_compressed', result: content, droppedCount: (step as any).droppedCount },
                timestamp,
            };
        default:
            // plan, task_created, task_completed, task_failed, grading, grade_result, interrupt, meta, …
            return {
                type: 'state_update',
                data: { subtype: step.type, result: content, ...(step as unknown as Record<string, unknown>) },
                timestamp,
            };
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
