/**
 * IAgentEngine — Agent 执行引擎抽象（U16）
 *
 * 把「执行循环」从 AgentHarness 中解耦：Harness 保持 Spec/Grader/预算/审计/HitL
 * 的编排层职责不变，内层执行循环可替换：
 *
 *   AgentHarness
 *      └─ IAgentEngine
 *           ├─ NativeAgentEngine        ← 现有 Agent.run()（默认，全向后兼容）
 *           └─ ClaudeAgentSdkEngine     ← Claude Code 同款 Harness（coder 专用）
 */

import type { Agent } from '../agent.js';
import type {
    ExecutionStep,
    MemoryAccess,
    Message,
} from '../../types.js';

/** 引擎种类（AgentSpec.engine 字段取值）*/
export type AgentEngineKind = 'native' | 'claude-agent-sdk';

export interface EngineRunContext {
    sessionId: string;
    userId?: string;
    memory: MemoryAccess;
    history?: Message[];
    abortSignal?: AbortSignal;
    traceId?: string;
}

export interface IAgentEngine {
    readonly kind: AgentEngineKind;
    run(input: string, context: EngineRunContext): AsyncGenerator<ExecutionStep>;
}

/**
 * NativeAgentEngine — 包装现有 Agent.run()，行为与改造前完全一致
 */
export class NativeAgentEngine implements IAgentEngine {
    readonly kind = 'native' as const;

    constructor(private agent: Agent) {}

    run(input: string, context: EngineRunContext): AsyncGenerator<ExecutionStep> {
        return this.agent.run(input, context);
    }
}
