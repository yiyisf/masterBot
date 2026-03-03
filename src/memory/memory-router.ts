import type { LongTermMemory } from './long-term.js';
import type { KnowledgeGraph } from './knowledge-graph.js';
import type { SessionMemoryManager } from './short-term.js';

export interface UnifiedMemoryResult {
    source: 'long-term' | 'knowledge-graph' | 'short-term';
    content: string;
    score: number;
    metadata?: Record<string, unknown>;
}

/**
 * 统一内存路由器 — Phase 21
 * 并行查询 LongTermMemory + KnowledgeGraph，归并排序取 top N
 */
export class MemoryRouter {
    constructor(
        private longTerm: LongTermMemory,
        private knowledgeGraph: KnowledgeGraph,
        private shortTermManager: SessionMemoryManager,
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
                new Promise<null>(resolve => setTimeout(() => resolve(null), TIMEOUT_MS)),
            ]);

        // 并行查询两个主要来源
        const [ltResults, kgResult] = await Promise.all([
            withTimeout(this.longTerm.search(query, limit)),
            withTimeout(this.knowledgeGraph.search(query, { depth: 1, limit: 5 })),
        ]);

        const results: UnifiedMemoryResult[] = [];

        // 长期记忆结果
        if (ltResults) {
            for (const m of ltResults) {
                results.push({
                    source: 'long-term',
                    content: m.content,
                    score: 0.8,
                    metadata: m.metadata,
                });
            }
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
    knowledgeGraph: KnowledgeGraph,
    shortTermManager: SessionMemoryManager
): void {
    memoryRouter = new MemoryRouter(longTerm, knowledgeGraph, shortTermManager);
}
