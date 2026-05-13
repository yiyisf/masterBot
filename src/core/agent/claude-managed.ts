/**
 * Phase 3/4/5: ClaudeManagedAgent
 * 包装 Claude Agent SDK 的 query()，实现 IAgent 接口。
 * Phase 4 新增：
 *   - 主 Agent 只注入 core tier 技能（减少 input tokens）
 *   - Extended/experimental 技能通过独立 MCP 服务器暴露给子 Agent
 *   - 主 Agent 用 disallowedTools 过滤 extended 工具，子 Agent 通过 mcpServers 引用获取
 *   - 通过 options.agents 注入 4 个部门专家 Subagent
 * Phase 5 新增：
 *   - fork()：调用 SDK forkSession()，在 sessions 表记录父子关系
 *   - checkpoint()：将当前消息历史快照存入 CheckpointManager
 *   - capabilities() 更新：supportsFork / supportsCheckpoint = true
 */

import { query, forkSession, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import type { IAgent, AgentInput, AgentEvent, AgentCapabilities } from './types.js';
import { translateSdkStream } from './event-translator.js';
import { buildSdkHooks } from './sdk-hook-adapter.js';
import { createMasterBotMcpServer } from '../../skills/sdk-mcp-wrapper.js';
import { buildSubagentDefs } from './subagents.js';
import type { HookRegistry } from '../hooks/registry.js';
import type { ISkillRegistry } from '../../skills/registry.js';
import type { Logger, MemoryAccess, Message } from '../../types.js';
import type { CheckpointManager } from '../checkpoint-manager.js';
import type { HistoryRepository } from '../repository.js';

// 子 Agent 定义只需计算一次（静态结构，不含运行时状态）
const SUBAGENT_DEFS = buildSubagentDefs();

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
    /** Phase 5: checkpoint 存储，可选（缺省时 checkpoint() 退化为 no-op） */
    checkpointManager?: CheckpointManager;
    /** Phase 5: 会话历史仓库，用于 fork/checkpoint 读取消息 */
    historyRepository?: HistoryRepository;
    /** Phase 5: fork 后在 sessions 表记录父子关系的回调 */
    onFork?: (parentSessionId: string, newSessionId: string) => void;
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
            'masterbot-skills',
        );

        // Phase 4 (P0 fix): extended/experimental 技能注册为独立 MCP 服务器供子 Agent 使用
        // 主 Agent 通过 disallowedTools 过滤这些工具，子 Agent 通过 mcpServers 引用访问
        const extendedMcp = await createMasterBotMcpServer(
            this.opts.skillRegistry,
            mcpCtx,
            this.opts.logger,
            ['extended', 'experimental'],
            'masterbot-extended',
        );

        // 计算需要对主 Agent 隐藏的 extended/experimental 工具名称列表
        const allToolDefs = await this.opts.skillRegistry.getToolDefinitions();
        const disallowedTools = allToolDefs
            .filter(d => (d.tier ?? 'extended') !== 'core')
            .map(d => d.function.name);

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
                agents: SUBAGENT_DEFS,
                disallowedTools,
                mcpServers: {
                    'masterbot-skills': coreMcp,
                    'masterbot-extended': extendedMcp,
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

    /**
     * Phase 5: 分叉会话——基于 SDK forkSession() 创建对话分支。
     * 返回新会话的 UUID，可直接用于后续 execute({ sessionId: newId })。
     */
    async fork(sessionId: string): Promise<string> {
        this.opts.logger.info?.(`[ClaudeManagedAgent] fork session=${sessionId}`);
        const result = await forkSession(sessionId);
        const newSessionId = result.sessionId;
        // onFork 失败不能回滚 SDK 侧分叉，故只记录告警，仍返回新 sessionId
        try {
            this.opts.onFork?.(sessionId, newSessionId);
        } catch (err) {
            this.opts.logger.warn?.(`[ClaudeManagedAgent] onFork callback failed (DB record lost): ${(err as Error).message}`);
        }
        this.opts.logger.info?.(`[ClaudeManagedAgent] fork ok: ${sessionId} → ${newSessionId}`);
        return newSessionId;
    }

    /**
     * Phase 5: 创建检查点——将当前消息历史快照存入 CheckpointManager。
     * 优先从 SDK getSessionMessages() 读取；fallback 读 DB 消息。
     * 返回检查点 ID。
     */
    async checkpoint(sessionId: string, label?: string): Promise<string> {
        if (!this.opts.checkpointManager) {
            throw new Error('[ClaudeManagedAgent] checkpoint requires checkpointManager to be provided');
        }
        this.opts.logger.info?.(`[ClaudeManagedAgent] checkpoint session=${sessionId}`);

        let messages: Message[] = [];

        // 尝试从 SDK JSONL 读取最新消息（更准确）
        try {
            const sdkMsgs = await getSessionMessages(sessionId);
            messages = sdkMsgs
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({
                    id: m.uuid ?? '',
                    sessionId,
                    role: m.role as 'user' | 'assistant',
                    content: typeof m.message === 'string'
                        ? m.message
                        : (m.message as { content?: unknown })?.content?.toString() ?? '',
                    timestamp: new Date().toISOString(),
                    metadata: '{}',
                }));
        } catch (sdkErr) {
            // SDK 读取失败，fallback 到 DB
            this.opts.logger.warn?.(`[ClaudeManagedAgent] getSessionMessages failed, falling back to DB: ${(sdkErr as Error).message}`);
            if (this.opts.historyRepository) {
                const dbMsgs = this.opts.historyRepository.getMessages(sessionId, { limit: 500 });
                messages = dbMsgs as Message[];
            }
        }

        if (messages.length === 0) {
            this.opts.logger.warn?.(`[ClaudeManagedAgent] checkpoint for session=${sessionId} has 0 messages (SDK unavailable and no historyRepository?)`);
        }

        const cpId = this.opts.checkpointManager.save(sessionId, messages, label);
        this.opts.logger.info?.(`[ClaudeManagedAgent] checkpoint ok: ${cpId} (${messages.length} messages)`);
        return cpId;
    }

    capabilities(): AgentCapabilities {
        return {
            supportsStreaming: true,
            supportsFork: true,        // Phase 5 ✅
            supportsCheckpoint: true,  // Phase 5 ✅
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
