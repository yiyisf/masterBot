/**
 * Task 5: FeatureFlag 服务
 * 支持百分比灰度、userId 白/黑名单、环境变量覆盖。
 * Phase 8 Admin Console 将替换为数据库驱动实现，接口不变。
 */

import type { IFeatureFlagService } from '../core/agent/router.js';

export interface FlagConfig {
    /** 全局开关，false 则任何 context 都返回 disabled */
    enabled: boolean;
    /** 0-100 百分比流量，按 userId hash 分流 */
    rolloutPercent?: number;
    /** 强制开启的 userId 列表（白名单） */
    allowList?: string[];
    /** 强制关闭的 userId 列表（黑名单，优先于 allowList） */
    denyList?: string[];
}

export interface FeatureFlagConfig {
    flags: Record<string, FlagConfig>;
}

/**
 * 简单的 djb2 hash，将 userId 映射到 0-99 的桶，用于百分比分流。
 */
function hashUserId(userId: string): number {
    let h = 5381;
    for (let i = 0; i < userId.length; i++) {
        h = ((h << 5) + h) ^ userId.charCodeAt(i);
    }
    return Math.abs(h) % 100;
}

export class FeatureFlagService implements IFeatureFlagService {
    private readonly config: FeatureFlagConfig;

    constructor(config?: FeatureFlagConfig) {
        this.config = config ?? { flags: {} };
    }

    isEnabled(flag: string, context?: { tenantId?: string; userId?: string }): boolean {
        // 环境变量最高优先级（用于紧急回滚）
        const envKey = `FEATURE_${flag.toUpperCase().replace(/-/g, '_')}`;
        if (process.env[envKey] === 'false' || process.env[envKey] === '0') return false;
        if (process.env[envKey] === 'true' || process.env[envKey] === '1') return true;

        const flagCfg = this.config.flags[flag];
        if (!flagCfg) return false;
        if (!flagCfg.enabled) return false;

        const userId = context?.userId ?? 'anonymous';

        // 黑名单优先
        if (flagCfg.denyList?.includes(userId)) return false;

        // 白名单直接放行
        if (flagCfg.allowList?.includes(userId)) return true;

        // 百分比分流（基于 userId hash）
        if (flagCfg.rolloutPercent !== undefined) {
            return hashUserId(userId) < flagCfg.rolloutPercent;
        }

        return true;
    }

    /**
     * 热更新 flag 配置（Phase 8 配置中心推送时调用）
     */
    updateFlag(flag: string, config: FlagConfig): void {
        this.config.flags[flag] = config;
    }
}

/**
 * 从环境变量 CLAUDE_MANAGED_AGENT_ROLLOUT_PERCENT（0-100）创建默认服务实例。
 * 默认灰度 5%。
 */
export function createDefaultFeatureFlagService(): FeatureFlagService {
    const rolloutPercent = parseInt(process.env['CLAUDE_MANAGED_AGENT_ROLLOUT_PERCENT'] ?? '5', 10);
    return new FeatureFlagService({
        flags: {
            'claude-managed-agent': {
                enabled: true,
                rolloutPercent: isNaN(rolloutPercent) ? 5 : Math.max(0, Math.min(100, rolloutPercent)),
            },
        },
    });
}
