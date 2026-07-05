import type { LongTermMemory } from './long-term.js';
import type { KnowledgeGraph } from './knowledge-graph.js';

export interface UnifiedMemoryResult {
    source: 'long-term' | 'knowledge-graph';
    content: string;
    score: number;
    metadata?: Record<string, unknown>;
}

/**
 * 统一内存路由器 — Phase 21
 * 并行查询 LongTermMemory + KnowledgeGraph，归并排序取 top N
 *
 * P1-6 (M8): 移除了从未使用的 shortTermManager 依赖（"short-term" source 从未被填充过，
 * 短期会话记忆本身不支持语义检索——ShortTermMemory.search() 恒返回空数组）。
 */
export class MemoryRouter {
    constructor(
        private longTerm: LongTermMemory,
        private knowledgeGraph: KnowledgeGraph,
    ) {}

    async query(
        query: string,
        opts: { sessionId: string; limit?: number }
    ): Promise<UnifiedMemoryResult[]> {
        const limit = opts.limit ?? 8;
        const TIMEOUT_MS = 800;

        const withTimeout = <T>(p: Promise<T>): Promise<T | null> =>
            Promise.race([
                p.then(v => v).catch(() => null),
                new Promise<null>(resolve => {
                    const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
                    timer.unref?.();
                    p.finally(() => clearTimeout(timer));
                }),
            ]);

        // 并行查询两个主要来源
        const [ltResults, kgResult] = await Promise.all([
            withTimeout(this.longTerm.search(query, limit)),
            withTimeout(this.knowledgeGraph.search(query, { depth: 1, limit: 5 })),
        ]);

        const results: UnifiedMemoryResult[] = [];

        // 长期记忆结果（U1: 若向量搜索启用则使用真实相似度分数，否则按排名估算）
        if (ltResults) {
            ltResults.forEach((m, idx) => {
                results.push({
                    source: 'long-term',
                    content: m.content,
                    score: m.score ?? Math.max(0.5, 0.85 - idx * 0.05),
                    metadata: m.metadata,
                });
            });
        }

        // 知识图谱结果
        if (kgResult && kgResult.nodes.length > 0) {
            for (const node of kgResult.nodes) {
                const score = kgResult.relevanceScores[node.id] ?? 0.5;
                results.push({
                    source: 'knowledge-graph',
                    content: `**${node.title}**: ${node.content.substring(0, 200)}`,
                    score,
                    metadata: { type: node.type, nodeId: node.id },
                });
            }
        }

        // 按 score 降序，取 top limit
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    }
}

// 单例，在 src/index.ts 中初始化
export let memoryRouter: MemoryRouter | undefined;

export function initMemoryRouter(
    longTerm: LongTermMemory,
    knowledgeGraph: KnowledgeGraph
): void {
    memoryRouter = new MemoryRouter(longTerm, knowledgeGraph);
}
