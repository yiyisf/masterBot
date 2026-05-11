/**
 * Task 1: ClaudeManagedAgent
 * 包装 Claude Agent SDK 的 query()，实现 IAgent 接口。
 * Anthropic provider 通过此类享受 SDK 的 caching / compaction / subagent 能力。
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { IAgent, AgentInput, AgentEvent, AgentCapabilities } from './types.js';
import { translateSdkStream } from './event-translator.js';
import { buildSdkHooks } from './sdk-hook-adapter.js';
import { createMasterBotMcpServer } from '../../skills/sdk-mcp-wrapper.js';
import type { HookRegistry } from '../hooks/registry.js';
import type { ISkillRegistry } from '../../skills/registry.js';
import type { Logger, MemoryAccess } from '../../types.js';

export interface ClaudeManagedAgentOptions {
    hookRegistry: HookRegistry;
    skillRegistry: ISkillRegistry;
    logger: Logger;
    /** 每次 execute 调用时注入会话短期记忆 */
    memoryFactory?: (sessionId: string) => MemoryAccess;
    /** 默认模型，可被 AgentInput.model 覆盖 */
    defaultModel?: string;
    /** 最大对话轮次 */
    maxTurns?: number;
}

export class ClaudeManagedAgent implements IAgent {
    private readonly opts: ClaudeManagedAgentOptions;

    constructor(opts: ClaudeManagedAgentOptions) {
        this.opts = opts;
    }

    async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
        const ctx = {
            sessionId: input.sessionId,
            userId: input.userId,
            tenantId: input.tenantId,
        };

        // 构建 SDK hook 配置，桥接 globalHookRegistry
        const hooks = buildSdkHooks(this.opts.hookRegistry, ctx);

        // 构建 in-process MCP Server（包装所有 SKILL.md 技能）
        const memory = this.opts.memoryFactory?.(input.sessionId) ?? makeFallbackMemory();
        const masterbotMcp = await createMasterBotMcpServer(
            this.opts.skillRegistry,
            { sessionId: input.sessionId, userId: input.userId, tenantId: input.tenantId, memory },
            this.opts.logger,
        );

        const sdkStream = query({
            prompt: input.message,
            options: {
                model: input.model ?? this.opts.defaultModel ?? 'claude-sonnet-4-6',
                maxTurns: this.opts.maxTurns ?? 50,
                sessionId: input.sessionId,
                resume: input.resumeFrom,
                thinking: { type: 'adaptive' },
                hooks,
                mcpServers: {
                    'masterbot-skills': masterbotMcp,
                },
                // 禁用内置 Claude Code 工具（避免与 masterBot 工具重叠），
                // 但保留 Bash 供需要 shell 访问的技能
                // Phase 4 会精细化这里的工具列表
                env: {
                    CLAUDE_AGENT_SDK_CLIENT_APP: 'masterbot/3.0.0',
                },
            },
        });

        this.opts.logger.debug?.(`[ClaudeManagedAgent] session=${input.sessionId} model=${input.model ?? this.opts.defaultModel ?? 'claude-sonnet-4-6'}`);

        yield* translateSdkStream(sdkStream);
    }

    // eslint-disable-next-line require-yield
    async *resume(sessionId: string): AsyncGenerator<AgentEvent> {
        throw new Error(`ClaudeManagedAgent.resume: use execute({ resumeFrom: "${sessionId}" }) instead`);
    }

    async fork(_sessionId: string): Promise<string> {
        throw new Error('ClaudeManagedAgent.fork: Phase 5 will implement this via SDK forkSession');
    }

    async checkpoint(_sessionId: string): Promise<string> {
        throw new Error('ClaudeManagedAgent.checkpoint: Phase 5 will implement via SDK sessionId persistence');
    }

    capabilities(): AgentCapabilities {
        return {
            supportsStreaming: true,
            supportsFork: false,       // Phase 5
            supportsCheckpoint: false, // Phase 5
            maxContextTokens: 200_000,
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
