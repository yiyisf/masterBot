/**
 * Shadow Traffic Service — Tier 2 评估层
 *
 * 对生产流量按采样率镜像，将 shadow 请求结果与原始结果对比，
 * 检测行为差异（工具调用集合差、答案长度偏差），记录 divergence 统计。
 */

import { randomUUID } from 'crypto';
import type { Logger } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShadowConfig {
    enabled: boolean;
    /** 0-1 采样率，默认 0.1（10%） */
    samplingRate: number;
    /** shadow 请求超时毫秒，默认 5000 */
    timeoutMs: number;
}

export interface ShadowOriginalResult {
    tools: string[];
    answerLength: number;
    durationMs: number;
    tokens?: number;
}

export interface ShadowResult {
    requestId: string;
    timestamp: string;
    original: ShadowOriginalResult;
    shadow: ShadowOriginalResult | null;
    diff: {
        toolsDiff: string[];
        lengthDelta: number;
        diverged: boolean;
    };
}

interface RequestResult {
    tools: string[];
    answer: string;
    durationMs: number;
    tokens?: number;
}

// ─── djb2 hash（用于采样决策）────────────────────────────────────────────────

function djb2(str: string): number {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) ^ str.charCodeAt(i);
    }
    return Math.abs(h);
}

// ─── ShadowTrafficService ────────────────────────────────────────────────────

export class ShadowTrafficService {
    private readonly config: ShadowConfig;
    private readonly logger: Logger;
    private stats = { total: 0, sampled: 0, diverged: 0 };

    constructor(config: ShadowConfig, logger: Logger) {
        this.config = {
            enabled: config.enabled,
            samplingRate: Math.max(0, Math.min(1, config.samplingRate ?? 0.1)),
            timeoutMs: config.timeoutMs ?? 5000,
        };
        this.logger = logger;
    }

    /**
     * 根据 djb2 随机采样决策（非纯随机，确保同一 requestId 始终相同结果）。
     */
    shouldSample(requestId?: string): boolean {
        if (!this.config.enabled) return false;
        const seed = requestId ?? randomUUID();
        const bucket = djb2(seed) % 1000;
        return bucket < this.config.samplingRate * 1000;
    }

    /**
     * 运行 shadow 对比。
     *
     * @param requestId - 请求 ID，用于采样决策
     * @param originalFn - 原始请求执行函数（已执行，传入结果即可）
     * @param shadowFn - shadow 请求执行函数
     * @returns ShadowResult 或 null（未采样时）
     */
    async runShadow(
        requestId: string,
        originalFn: () => Promise<RequestResult>,
        shadowFn: () => Promise<RequestResult>,
    ): Promise<ShadowResult | null> {
        this.stats.total++;

        if (!this.shouldSample(requestId)) {
            return null;
        }

        this.stats.sampled++;

        // 执行原始函数
        const t0 = Date.now();
        let originalResult: RequestResult;
        try {
            originalResult = await originalFn();
        } catch (err) {
            this.logger.warn(`[shadow] original fn failed for ${requestId}: ${err}`);
            return null;
        }

        // 执行 shadow 函数（带超时）
        let shadowResult: RequestResult | null = null;
        try {
            shadowResult = await Promise.race([
                shadowFn(),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('shadow timeout')), this.config.timeoutMs)
                ),
            ]);
        } catch (err) {
            this.logger.warn(`[shadow] shadow fn failed/timed out for ${requestId}: ${err}`);
        }

        // 计算差异
        const original: ShadowOriginalResult = {
            tools: originalResult.tools,
            answerLength: originalResult.answer.length,
            durationMs: originalResult.durationMs,
            tokens: originalResult.tokens,
        };

        const shadow: ShadowOriginalResult | null = shadowResult
            ? {
                  tools: shadowResult.tools,
                  answerLength: shadowResult.answer.length,
                  durationMs: shadowResult.durationMs,
                  tokens: shadowResult.tokens,
              }
            : null;

        const toolsDiff = shadow
            ? computeToolsDiff(original.tools, shadow.tools)
            : ['shadow unavailable'];

        const lengthDelta = shadow ? Math.abs(shadow.answerLength - original.answerLength) : 0;

        // diverged: 工具集不同，或答案长度偏差超过 50%
        const lengthRatio = original.answerLength > 0 ? lengthDelta / original.answerLength : 0;
        const diverged = toolsDiff.length > 0 || lengthRatio > 0.5;

        if (diverged) {
            this.stats.diverged++;
            this.logger.info(
                `[shadow] DIVERGED requestId=${requestId} toolsDiff=[${toolsDiff.join(',')}] lengthDelta=${lengthDelta}`,
            );
        }

        const result: ShadowResult = {
            requestId,
            timestamp: new Date().toISOString(),
            original,
            shadow,
            diff: { toolsDiff, lengthDelta, diverged },
        };

        void t0; // t0 logged implicitly via durationMs in results
        return result;
    }

    getStats(): { total: number; sampled: number; diverged: number } {
        return { ...this.stats };
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeToolsDiff(a: string[], b: string[]): string[] {
    const setA = new Set(a);
    const setB = new Set(b);
    const diff: string[] = [];
    for (const t of setA) {
        if (!setB.has(t)) diff.push(`-${t}`);
    }
    for (const t of setB) {
        if (!setA.has(t)) diff.push(`+${t}`);
    }
    return diff;
}
