/**
 * Phase 6: 统一 MemoryRouter — 实现 IMemoryRouter
 * 查询顺序：L4 Procedural → L3 Semantic → L2 Episodic → L1 (short-term, in-context)
 */

import type { LongTermMemory } from './long-term.js';
import type { KnowledgeGraph } from './knowledge-graph.js';
import type { SessionMemoryManager } from './short-term.js';
import type { EpisodicMemoryStore } from './episodic.js';
import type { SemanticMemoryStore } from './semantic.js';
import type { ProceduralMemory } from './procedural.js';
import type {
    IMemoryRouter,
    EpisodicMemory,
    SemanticFact,
    UnifiedMemoryResult,
} from './types.js';

// 保留旧类型以向后兼容
export type { UnifiedMemoryResult };

export class MemoryRouter implements IMemoryRouter {
    constructor(
        /** Legacy long-term (kept for backward compat) */
        private longTerm: LongTermMemory,
        /** Legacy knowledge graph */
        private knowledgeGraph: KnowledgeGraph,
        private shortTermManager: SessionMemoryManager,
        /** Phase 6 new stores (optional for gradual migration) */
        private episodic?: EpisodicMemoryStore,
        private semantic?: SemanticMemoryStore,
        private procedural?: ProceduralMemory,
    ) {}

    // ── L2 Episodic ──────────────────────────────────────────────────────────

    async searchEpisodic(query: string, k: number, tenantId: string): Promise<EpisodicMemory[]> {
        return this.episodic?.search(query, k, tenantId) ?? [];
    }

    async insertEpisodic(item: Omit<EpisodicMemory, 'id' | 'createdAt' | 'expiresAt'>): Promise<void> {
        await this.episodic?.insert(item);
    }

    // ── L3 Semantic ──────────────────────────────────────────────────────────

    async searchSemantic(entity: string, tenantId: string): Promise<SemanticFact[]> {
        return this.semantic?.search(entity, tenantId) ?? [];
    }

    async upsertSemanticFact(fact: Omit<SemanticFact, 'id' | 'createdAt' | 'status'>): Promise<void> {
        await this.semantic?.upsert(fact);
    }

    async pendingFacts(tenantId: string): Promise<SemanticFact[]> {
        return this.semantic?.pendingFacts(tenantId) ?? [];
    }

    async reviewFact(factId: string, decision: 'approve' | 'reject', reviewer: string): Promise<void> {
        await this.semantic?.review(factId, decision, reviewer);
    }

    // ── L4 Procedural ────────────────────────────────────────────────────────

    async loadAgentRules(scope: string, tenantId: string): Promise<string> {
        return this.procedural?.getRules(scope, tenantId) ?? '';
    }

    // ── Unified query ─────────────────────────────────────────────────────────

    async query(
        query: string,
        opts: { sessionId: string; tenantId: string; limit?: number }
    ): Promise<UnifiedMemoryResult[]> {
        const limit = opts.limit ?? 8;
        const TIMEOUT_MS = 800;

        const withTimeout = <T>(p: Promise<T>): Promise<T | null> =>
            Promise.race([
                p.then(v => v).catch(() => null),
                new Promise<null>(resolve => setTimeout(() => resolve(null), TIMEOUT_MS)),
            ]);

        const [episodicResults, ltResults, kgResult] = await Promise.all([
            this.episodic
                ? withTimeout(this.episodic.search(query, 4, opts.tenantId))
                : Promise.resolve(null),
            withTimeout(this.longTerm.search(query, limit)),
            withTimeout(this.knowledgeGraph.search(query, { depth: 1, limit: 5 })),
        ]);

        const results: UnifiedMemoryResult[] = [];

        // L2 Episodic (phase 6 store)
        if (episodicResults) {
            for (const m of episodicResults) {
                results.push({ layer: 'episodic', content: m.content, score: 0.85, metadata: m.metadata });
            }
        }

        // L2 Legacy long-term (fallback, deduplication welcome in a later phase)
        if (ltResults) {
            for (const m of ltResults) {
                results.push({ layer: 'episodic', content: m.content, score: 0.8, metadata: m.metadata });
            }
        }

        // L3 Knowledge graph
        if (kgResult?.nodes.length) {
            for (const node of kgResult.nodes) {
                results.push({
                    layer: 'semantic',
                    content: `**${node.title}**: ${node.content.substring(0, 200)}`,
                    score: kgResult.relevanceScores[node.id] ?? 0.5,
                    metadata: { type: node.type, nodeId: node.id },
                });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    }
}

// ── 单例 ─────────────────────────────────────────────────────────────────────

export let memoryRouter: MemoryRouter | undefined;

export function initMemoryRouter(
    longTerm: LongTermMemory,
    knowledgeGraph: KnowledgeGraph,
    shortTermManager: SessionMemoryManager,
    episodic?: EpisodicMemoryStore,
    semantic?: SemanticMemoryStore,
    procedural?: ProceduralMemory,
): void {
    memoryRouter = new MemoryRouter(longTerm, knowledgeGraph, shortTermManager, episodic, semantic, procedural);
}
