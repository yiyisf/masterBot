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
export type AgentEngineKind = 'native' | 'claude-agent-sdk' | 'codex' | 'opencode' | 'pi';

/**
 * 引擎能力声明（研发流程管理模块，spec §5.2）。
 * interactiveApproval：执行中能否编程式向人提问/请求审批（codex exec = false）。
 * resume：能否跨进程恢复会话（v1 全部 false；未来 Claude `--resume` 等）。
 */
export interface EngineCapabilities {
    interactiveApproval: boolean;
    resume: boolean;
}

export interface EngineRunContext {
    sessionId: string;
    userId?: string;
    memory: MemoryAccess;
    history?: Message[];
    abortSignal?: AbortSignal;
    traceId?: string;
    /** 运行时工作目录（如需求的 worktree 路径），优先于 spec.engineOptions.cwd（spec §5.2）*/
    cwd?: string;
    /** 审批模式：'auto' 沙箱自动判定（默认）；'ask-on-risky' 危险操作转人工审批（spec §5.4）*/
    approvalMode?: 'auto' | 'ask-on-risky';
}

export interface IAgentEngine {
    readonly kind: AgentEngineKind;
    readonly capabilities: EngineCapabilities;
    run(input: string, context: EngineRunContext): AsyncGenerator<ExecutionStep>;
}

/**
 * NativeAgentEngine — 包装现有 Agent.run()，行为与改造前完全一致
 */
export class NativeAgentEngine implements IAgentEngine {
    readonly kind = 'native' as const;
    // 自研 ReAct 循环已支持 ask_user / danger-approval 中断（agent-run-helpers.ts），无 resume 能力
    readonly capabilities: EngineCapabilities = { interactiveApproval: true, resume: false };

    constructor(private agent: Agent) {}

    run(input: string, context: EngineRunContext): AsyncGenerator<ExecutionStep> {
        return this.agent.run(input, context);
    }
}
