/**
 * Phase 2: AgentRouter
 * 按 provider 和 feature flag 路由到不同 Agent 实现。
 * Phase 3 将注入 ClaudeManagedAgent；当前仅路由到 LegacySelfHostedAgent。
 */

import { nanoid } from 'nanoid';
import type { IAgent, AgentInput, AgentEvent, AgentCapabilities } from './types.js';
import type { Logger } from '../../types.js';

// ─── Feature Flag Service ─────────────────────────────────────────────────────

export interface IFeatureFlagService {
    isEnabled(flag: string, context?: { tenantId?: string; userId?: string }): boolean;
}

/** 简单的环境变量 + Map 实现，Phase 8 Admin Console 将替换 */
export class EnvFeatureFlagService implements IFeatureFlagService {
    private readonly overrides: Map<string, boolean>;

    constructor(overrides?: Record<string, boolean>) {
        this.overrides = new Map(Object.entries(overrides ?? {}));
    }

    isEnabled(flag: string, _context?: { tenantId?: string; userId?: string }): boolean {
        if (this.overrides.has(flag)) return this.overrides.get(flag)!;
        const env = process.env[`FEATURE_${flag.toUpperCase().replace(/-/g, '_')}`];
        return env === 'true' || env === '1';
    }
}

// ─── Fork Repository（最小接口，避免与 HistoryRepository 强耦合）────────────

export interface ForkRepository {
    getMessages(sessionId: string, opts?: { limit?: number }): any[];
    saveMessage(sessionId: string, message: any): string;
    recordFork(parentSessionId: string, newSessionId: string, title?: string): void;
}

// ─── Agent Factory ────────────────────────────────────────────────────────────

export type AgentFactory = () => IAgent;

export interface AgentRouterOptions {
    legacyFactory: AgentFactory;
    /**
     * Phase 3: claudeFactory 注入 ClaudeManagedAgent。
     * 当前可选，缺省时 Anthropic 也走 legacy。
     */
    claudeFactory?: AgentFactory;
    featureFlags?: IFeatureFlagService;
    logger: Logger;
    /**
     * Phase 10 fix: 用于 Legacy 会话的 copy-based fork。
     * SDK forkSession() 只识别 SDK 自己创建的 session ID；Legacy 会话（nanoid）
     * 必须通过消息复制实现 fork。
     */
    historyRepository?: ForkRepository;
}

// ─── AgentRouter ──────────────────────────────────────────────────────────────

export class AgentRouter implements IAgent {
    private readonly opts: Required<Omit<AgentRouterOptions, 'claudeFactory' | 'historyRepository'>>
        & { claudeFactory?: AgentFactory; historyRepository?: ForkRepository };
    private readonly legacyAgent: IAgent;
    private claudeAgent?: IAgent;

    constructor(options: AgentRouterOptions) {
        this.opts = {
            legacyFactory: options.legacyFactory,
            claudeFactory: options.claudeFactory,
            featureFlags: options.featureFlags ?? new EnvFeatureFlagService(),
            logger: options.logger,
            historyRepository: options.historyRepository,
        };
        this.legacyAgent = options.legacyFactory();
        if (options.claudeFactory) {
            this.claudeAgent = options.claudeFactory();
        }
    }

    private resolve(input: AgentInput): IAgent {
        if (input.forceLegacy) {
            this.opts.logger.debug?.('[AgentRouter] forceLegacy=true → legacy');
            return this.legacyAgent;
        }

        if (
            input.provider === 'anthropic' &&
            this.claudeAgent &&
            this.opts.featureFlags.isEnabled('claude-managed-agent', {
                tenantId: input.tenantId,
                userId: input.userId,
            })
        ) {
            this.opts.logger.debug?.('[AgentRouter] routing to ClaudeManagedAgent');
            return this.claudeAgent;
        }

        return this.legacyAgent;
    }

    async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
        const agent = this.resolve(input);
        yield* agent.execute(input);
    }

    async *resume(sessionId: string): AsyncGenerator<AgentEvent> {
        // ClaudeManagedAgent 持有 SDK session 状态，SDK 创建的会话必须由它来恢复。
        if (this.claudeAgent) {
            try {
                yield* this.claudeAgent.resume(sessionId);
                return;
            } catch (err: any) {
                const msg: string = err?.message ?? '';
                if (!msg.includes('Invalid sessionId') && !msg.includes('not found')) throw err;
                this.opts.logger.debug?.(`[AgentRouter] claudeAgent.resume failed (legacy session ${sessionId}), falling back`);
            }
        }
        yield* this.legacyAgent.resume(sessionId);
    }

    async fork(sessionId: string): Promise<string> {
        // 优先尝试 ClaudeManagedAgent SDK fork；若 session 不属于 SDK（Legacy 会话），
        // 则自动降级到 copy-based fork，无需外部感知。
        if (this.claudeAgent) {
            try {
                return await this.claudeAgent.fork(sessionId);
            } catch (err: any) {
                const msg: string = err?.message ?? '';
                if (!msg.includes('Invalid sessionId') && !msg.includes('not found') && !msg.includes('does not support')) {
                    throw err; // 非预期错误直接抛出
                }
                this.opts.logger.warn?.(
                    `[AgentRouter] SDK forkSession rejected (session=${sessionId}, legacy mode) — falling back to copy fork`,
                );
            }
        }
        return this.copyFork(sessionId);
    }

    /**
     * Legacy copy-based fork：将父会话的消息全量复制到新会话。
     * 适用于 Legacy 模式创建的 nanoid 会话（SDK 不感知这些 ID）。
     */
    private async copyFork(parentSessionId: string): Promise<string> {
        const repo = this.opts.historyRepository;
        if (!repo) {
            throw new Error(
                '[AgentRouter] historyRepository is required for legacy copy fork. ' +
                'Inject it via AgentRouterOptions.historyRepository.',
            );
        }
        const newSessionId = nanoid();
        // recordFork 内含 INSERT OR IGNORE INTO sessions，会同时创建新会话记录
        repo.recordFork(parentSessionId, newSessionId);
        const messages = repo.getMessages(parentSessionId);
        for (const msg of messages) {
            // 附件 id 必须重新生成：attachments 表 id 为 PRIMARY KEY，
            // 复用原 id 会导致 UNIQUE constraint violation。
            const attachments = msg.attachments?.map((att: any) => ({ ...att, id: nanoid() }));
            repo.saveMessage(newSessionId, { ...msg, id: nanoid(), attachments });
        }
        this.opts.logger.info?.(
            `[AgentRouter] copy fork ok: ${parentSessionId} → ${newSessionId} (${messages.length} messages copied)`,
        );
        return newSessionId;
    }

    async checkpoint(sessionId: string, label?: string): Promise<string> {
        // Phase 5: 优先走 ClaudeManagedAgent，fallback legacy
        const agent = this.claudeAgent ?? this.legacyAgent;
        return agent.checkpoint(sessionId, label);
    }

    capabilities(): AgentCapabilities {
        // Phase 5: 合并两个 agent 的能力声明（取最大值）
        const legacy = this.legacyAgent.capabilities();
        const managed = this.claudeAgent?.capabilities();
        if (!managed) return legacy;
        return {
            supportsStreaming: legacy.supportsStreaming || managed.supportsStreaming,
            supportsFork: legacy.supportsFork || managed.supportsFork,
            supportsCheckpoint: legacy.supportsCheckpoint || managed.supportsCheckpoint,
            maxContextTokens: Math.max(legacy.maxContextTokens, managed.maxContextTokens),
        };
    }
}
