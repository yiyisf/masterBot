/**
 * Phase 2: AgentRouter
 * 按 provider 和 feature flag 路由到不同 Agent 实现。
 * Phase 3 将注入 ClaudeManagedAgent；当前仅路由到 LegacySelfHostedAgent。
 */

import type { IAgent, AgentInput, AgentEvent, AgentCapabilities } from './types.js';
import type { Logger } from '../../types.js';
import type { CheckpointManager } from '../checkpoint-manager.js';
import { historyRepository } from '../repository.js';

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
    /** Phase 5: 当 agent 不支持 checkpoint 时的 fallback */
    checkpointManager?: CheckpointManager;
}

// ─── AgentRouter ──────────────────────────────────────────────────────────────

export class AgentRouter implements IAgent {
    private readonly opts: Required<Omit<AgentRouterOptions, 'claudeFactory' | 'checkpointManager'>> & { claudeFactory?: AgentFactory; checkpointManager?: CheckpointManager };
    private readonly legacyAgent: IAgent;
    private claudeAgent?: IAgent;

    constructor(options: AgentRouterOptions) {
        this.opts = {
            legacyFactory: options.legacyFactory,
            claudeFactory: options.claudeFactory,
            featureFlags: options.featureFlags ?? new EnvFeatureFlagService(),
            logger: options.logger,
            checkpointManager: options.checkpointManager,
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
        yield* this.legacyAgent.resume(sessionId);
    }

    async fork(sessionId: string): Promise<string> {
        // Phase 5: 优先走 ClaudeManagedAgent（SDK forkSession），fallback legacy
        const agent = this.claudeAgent ?? this.legacyAgent;
        return agent.fork(sessionId);
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
