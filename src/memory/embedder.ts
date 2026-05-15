/**
 * Phase 6.5: 文本 Embedder
 *
 * 将文本转换为浮点向量，用于 DuckDB VSS 相似度搜索。
 * 默认使用 OpenAI text-embedding-3-small (dim=1536)。
 *
 * 如果 API Key 未配置或调用失败，返回 null——调用方应降级到 FTS/LIKE。
 */

import type { Logger } from '../types.js';

export interface EmbedderConfig {
    apiKey: string;
    baseUrl?: string;
    model?: string;
    dim?: number;
}

export class Embedder {
    readonly dim: number;
    private readonly model: string;
    private readonly apiKey: string;
    private readonly baseUrl: string;

    constructor(
        private readonly config: EmbedderConfig,
        private readonly logger: Logger,
    ) {
        this.dim = config.dim ?? 1536;
        this.model = config.model ?? 'text-embedding-3-small';
        this.apiKey = config.apiKey;
        this.baseUrl = (config.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '');
    }

    /**
     * 文本 → 向量。失败时返回 null（调用方降级）。
     */
    async embed(text: string): Promise<number[] | null> {
        if (!this.apiKey) return null;
        try {
            const resp = await fetch(`${this.baseUrl}/v1/embeddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({ model: this.model, input: text.slice(0, 8000) }),
                signal: AbortSignal.timeout(10_000),
            });

            if (!resp.ok) {
                this.logger.warn(`[embedder] API error ${resp.status}: ${await resp.text().catch(() => '')}`);
                return null;
            }

            const json = await resp.json() as { data: Array<{ embedding: number[] }> };
            return json.data[0]?.embedding ?? null;
        } catch (err: any) {
            this.logger.warn(`[embedder] embed failed: ${err.message}`);
            return null;
        }
    }

    /**
     * 批量 embed（顺序调用，避免并发超限）。
     */
    async embedBatch(texts: string[]): Promise<Array<number[] | null>> {
        const results: Array<number[] | null> = [];
        for (const t of texts) {
            results.push(await this.embed(t));
        }
        return results;
    }
}

/** 从环境变量构建 Embedder（如未配置则返回 undefined） */
export function createEmbedderFromEnv(logger: Logger): Embedder | undefined {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
        logger.debug('[embedder] OPENAI_API_KEY not set, vector search disabled');
        return undefined;
    }
    return new Embedder(
        {
            apiKey,
            baseUrl: process.env['OPENAI_BASE_URL'],
            model: process.env['EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
        },
        logger,
    );
}
