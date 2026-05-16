/**
 * Canary Service — Tier 3 评估层
 *
 * 渐进式发布控制：5% → 25% → 50% → 100%。
 * 支持基于 error_rate 的自动回滚。
 */

import { randomUUID } from 'crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Logger } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CanaryFlag {
    id: string;
    flag_name: string;
    /** 当前 stage index（0=5%, 1=25%, 2=50%, 3=100%） */
    current_stage: number;
    stages: number[];
    stage_started_at: string;
    observe_hours: number;
    error_rate_threshold: number;
    auto_rollback: boolean;
    status: 'running' | 'paused' | 'completed' | 'rolled_back';
    created_at: string;
    updated_at: string;
}

interface CanaryFlagRow {
    id: string;
    flag_name: string;
    current_stage: number;
    stages: string;
    stage_started_at: string;
    observe_hours: number;
    error_rate_threshold: number;
    auto_rollback: number;
    status: string;
    created_at: string;
    updated_at: string;
}

interface CanaryMetricRow {
    stage: number;
    error_count: number;
    success_count: number;
    thumbs_up: number;
    thumbs_down: number;
    total_tokens: number;
}

// ─── CanaryService ────────────────────────────────────────────────────────────

export class CanaryService {
    constructor(private readonly db: DatabaseSync, private readonly logger: Logger) {}

    createFlag(
        flagName: string,
        opts?: Partial<Pick<CanaryFlag, 'stages' | 'observe_hours' | 'error_rate_threshold'>>,
    ): CanaryFlag {
        const existing = this.getFlag(flagName);
        if (existing) {
            this.logger.warn(`[canary] flag "${flagName}" already exists, returning existing`);
            return existing;
        }

        const id = randomUUID();
        const now = new Date().toISOString();
        const stages = opts?.stages ?? [5, 25, 50, 100];
        const observeHours = opts?.observe_hours ?? 24;
        const errorRateThreshold = opts?.error_rate_threshold ?? 0.05;

        this.db.prepare(`
            INSERT INTO canary_flags (
                id, flag_name, current_stage, stages, stage_started_at,
                observe_hours, error_rate_threshold, auto_rollback, status, created_at, updated_at
            ) VALUES (?, ?, 0, ?, ?, ?, ?, 1, 'running', ?, ?)
        `).run(id, flagName, JSON.stringify(stages), now, observeHours, errorRateThreshold, now, now);

        this.logger.info(`[canary] created flag "${flagName}" stages=${JSON.stringify(stages)}`);
        return this.getFlag(flagName)!;
    }

    listFlags(): CanaryFlag[] {
        const rows = this.db.prepare('SELECT * FROM canary_flags ORDER BY created_at DESC').all() as unknown as CanaryFlagRow[];
        return rows.map(rowToFlag);
    }

    getFlag(flagName: string): CanaryFlag | null {
        const row = this.db.prepare('SELECT * FROM canary_flags WHERE flag_name = ?').get(flagName) as unknown as CanaryFlagRow | undefined;
        return row ? rowToFlag(row) : null;
    }

    /** 返回当前 rollout 百分比（0-100） */
    getCurrentPercent(flagName: string): number {
        const flag = this.getFlag(flagName);
        if (!flag || flag.status !== 'running') return 0;
        const stages = flag.stages;
        return stages[flag.current_stage] ?? 0;
    }

    /** 提升到下一个 stage。若已是最后 stage，标记 completed */
    promoteStage(flagName: string): CanaryFlag | null {
        const flag = this.getFlag(flagName);
        if (!flag) return null;
        if (flag.status !== 'running') {
            this.logger.warn(`[canary] flag "${flagName}" is ${flag.status}, cannot promote`);
            return flag;
        }

        const nextStage = flag.current_stage + 1;
        const now = new Date().toISOString();

        if (nextStage >= flag.stages.length) {
            // 已到最后 stage，完成
            this.db.prepare(`
                UPDATE canary_flags SET status = 'completed', updated_at = ? WHERE flag_name = ?
            `).run(now, flagName);
            this.logger.info(`[canary] flag "${flagName}" COMPLETED`);
        } else {
            this.db.prepare(`
                UPDATE canary_flags
                SET current_stage = ?, stage_started_at = ?, updated_at = ?
                WHERE flag_name = ?
            `).run(nextStage, now, now, flagName);
            this.logger.info(`[canary] flag "${flagName}" promoted to stage ${nextStage} (${flag.stages[nextStage]}%)`);
        }

        return this.getFlag(flagName);
    }

    /** 回滚到上一个 stage。若已是 stage 0，则标记 rolled_back */
    rollbackStage(flagName: string): CanaryFlag | null {
        const flag = this.getFlag(flagName);
        if (!flag) return null;

        const now = new Date().toISOString();

        if (flag.current_stage <= 0) {
            // 回滚到 0% — 标记为已回滚
            this.db.prepare(`
                UPDATE canary_flags SET status = 'rolled_back', updated_at = ? WHERE flag_name = ?
            `).run(now, flagName);
            this.logger.warn(`[canary] flag "${flagName}" ROLLED BACK completely (was at stage 0)`);
        } else {
            const prevStage = flag.current_stage - 1;
            this.db.prepare(`
                UPDATE canary_flags
                SET current_stage = ?, stage_started_at = ?, updated_at = ?
                WHERE flag_name = ?
            `).run(prevStage, now, now, flagName);
            this.logger.warn(`[canary] flag "${flagName}" rolled back to stage ${prevStage} (${flag.stages[prevStage]}%)`);
        }

        return this.getFlag(flagName);
    }

    recordMetric(
        flagName: string,
        stage: number,
        metric: {
            error?: boolean;
            success?: boolean;
            thumbsUp?: boolean;
            thumbsDown?: boolean;
            tokens?: number;
        },
    ): void {
        const id = randomUUID();
        const now = new Date().toISOString();

        this.db.prepare(`
            INSERT INTO canary_metrics (
                id, flag_name, stage,
                error_count, success_count,
                thumbs_up, thumbs_down,
                total_tokens, recorded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            flagName,
            stage,
            metric.error ? 1 : 0,
            metric.success ? 1 : 0,
            metric.thumbsUp ? 1 : 0,
            metric.thumbsDown ? 1 : 0,
            metric.tokens ?? 0,
            now,
        );
    }

    /**
     * 检查是否需要自动回滚（error_rate > threshold）。
     * 若需要则执行回滚并返回 true。
     */
    checkAutoRollback(flagName: string): boolean {
        const flag = this.getFlag(flagName);
        if (!flag || !flag.auto_rollback || flag.status !== 'running') return false;

        const metrics = this.getMetrics(flagName);
        const currentMetric = metrics.find(m => m.stage === flag.current_stage);
        if (!currentMetric) return false;

        if (currentMetric.error_rate > flag.error_rate_threshold) {
            this.logger.warn(
                `[canary] auto-rollback triggered for "${flagName}": ` +
                `error_rate=${currentMetric.error_rate.toFixed(3)} > threshold=${flag.error_rate_threshold}`,
            );
            this.rollbackStage(flagName);
            return true;
        }

        return false;
    }

    getMetrics(flagName: string): Array<{
        stage: number;
        error_rate: number;
        satisfaction_rate: number;
        total_tokens: number;
    }> {
        const rows = this.db.prepare(`
            SELECT
                stage,
                SUM(error_count)   AS error_count,
                SUM(success_count) AS success_count,
                SUM(thumbs_up)     AS thumbs_up,
                SUM(thumbs_down)   AS thumbs_down,
                SUM(total_tokens)  AS total_tokens
            FROM canary_metrics
            WHERE flag_name = ?
            GROUP BY stage
            ORDER BY stage ASC
        `).all(flagName) as unknown as CanaryMetricRow[];

        return rows.map(row => {
            const total = row.error_count + row.success_count;
            const feedback = row.thumbs_up + row.thumbs_down;
            return {
                stage: row.stage,
                error_rate: total > 0 ? row.error_count / total : 0,
                satisfaction_rate: feedback > 0 ? row.thumbs_up / feedback : 0,
                total_tokens: row.total_tokens,
            };
        });
    }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function rowToFlag(row: CanaryFlagRow): CanaryFlag {
    return {
        id: row.id,
        flag_name: row.flag_name,
        current_stage: row.current_stage,
        stages: JSON.parse(row.stages) as number[],
        stage_started_at: row.stage_started_at,
        observe_hours: row.observe_hours,
        error_rate_threshold: row.error_rate_threshold,
        auto_rollback: Boolean(row.auto_rollback),
        status: row.status as CanaryFlag['status'],
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}
