/**
 * Phase 2: 统一 Agent 接口
 * 支持 Claude SDK Agent 和 Legacy Self-Hosted Agent 的共同抽象
 */

export type AgentProvider = 'anthropic' | 'openai' | 'gemini' | 'ollama';

export interface AgentInput {
    message: string;
    sessionId: string;
    userId: string;
    tenantId: string;
    provider: AgentProvider;
    model?: string;
    /** 强制走 Legacy 路径（调试用） */
    forceLegacy?: boolean;
    /** 从指定 checkpoint 恢复 */
    resumeFrom?: string;
}

export interface AgentEvent {
    type: 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'state_update' | 'error';
    data: unknown;
    timestamp: number;
}

export interface AgentCapabilities {
    supportsStreaming: boolean;
    supportsFork: boolean;
    supportsCheckpoint: boolean;
    maxContextTokens: number;
}

export interface IAgent {
    execute(input: AgentInput): AsyncGenerator<AgentEvent>;
    resume(sessionId: string): AsyncGenerator<AgentEvent>;
    fork(sessionId: string): Promise<string>;
    checkpoint(sessionId: string): Promise<string>;
    capabilities(): AgentCapabilities;
}
