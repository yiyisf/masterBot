/**
 * Phase 3/4: ClaudeManagedAgent
 * 包装 Claude Agent SDK 的 query()，实现 IAgent 接口。
 * Phase 4 新增：
 *   - 主 Agent 只注入 core tier 技能（减少 input tokens）
 *   - 通过 options.agents 注入 4 个部门专家 Subagent
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { IAgent, AgentInput, AgentEvent, AgentCapabilities } from './types.js';
import { translateSdkStream } from './event-translator.js';
import { buildSdkHooks } from './sdk-hook-adapter.js';
import { createMasterBotMcpServer } from '../../skills/sdk-mcp-wrapper.js';
import { buildSubagentDefs } from './subagents.js';
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

        const memory = this.opts.memoryFactory?.(input.sessionId) ?? makeFallbackMemory();
        const mcpCtx = { sessionId: input.sessionId, userId: input.userId, tenantId: input.tenantId, memory };

        // Phase 4: 主 Agent 只注入 core tier 技能，减少无关工具的 token 消耗
        const coreMcp = await createMasterBotMcpServer(
            this.opts.skillRegistry,
            mcpCtx,
            this.opts.logger,
            ['core'],
        );

        // Phase 4: 部门专家 Subagent 定义（HR / 财务 / IT / 工程）
        const agents = buildSubagentDefs();

        // 将上层 AbortSignal 桥接为 SDK 所需的 AbortController
        const abortController = new AbortController();
        if (input.abortSignal) {
            input.abortSignal.addEventListener('abort', () => abortController.abort(), { once: true });
        }

        const sdkStream = query({
            prompt: input.message,
            options: {
                model: input.model ?? this.opts.defaultModel ?? 'claude-sonnet-4-6',
                maxTurns: this.opts.maxTurns ?? 50,
                sessionId: input.sessionId,
                resume: input.resumeFrom,
                thinking: { type: 'adaptive' },
                abortController,
                hooks,
                agents,
                mcpServers: {
                    'masterbot-skills': coreMcp,
                },
                env: {
                    CLAUDE_AGENT_SDK_CLIENT_APP: 'masterbot/4.0.0',
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
