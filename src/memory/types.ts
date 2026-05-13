/**
 * Phase 6: Memory 四层统一接口
 *
 * L1 Working    — in-context，SDK 自动管理，无需接口
 * L2 Episodic   — 情景记忆（SQLite FTS5）
 * L3 Semantic   — 语义/知识图谱（HitL 写入门）
 * L4 Procedural — 程序规则（SOUL.md / AGENTS.md / SKILL.md）
 */

// ─── L2 Episodic ──────────────────────────────────────────────────────────────

export interface EpisodicMemory {
    id: string;
    tenantId: string;
    sessionId: string;
    content: string;
    category: string;
    topic: string;
    /** Unix ms，90 天后过期 */
    expiresAt: number;
    createdAt: number;
    metadata?: Record<string, unknown>;
}

// ─── L3 Semantic ──────────────────────────────────────────────────────────────

export type SemanticFactStatus = 'pending' | 'approved' | 'rejected';

export interface SemanticFact {
    id: string;
    tenantId: string;
    subject: string;
    predicate: string;
    object: string;
    /** 0–1，LLM 提取时给出，≥ 0.85 才进入 pending */
    confidence: number;
    status: SemanticFactStatus;
    reviewedBy?: string;
    reviewedAt?: number;
    createdAt: number;
    sourceSessionId?: string;
}

// ─── L4 Procedural ────────────────────────────────────────────────────────────

export interface ProceduralRule {
    scope: string;    // agent id 或 '*'（全局）
    tenantId: string;
    content: string;  // 注入到 system prompt 的纯文本
    source: string;   // 来源文件路径
    loadedAt: number;
}

// ─── Unified query result ──────────────────────────────────────────────────────

export type MemoryLayer = 'episodic' | 'semantic' | 'procedural' | 'short-term';

export interface UnifiedMemoryResult {
    layer: MemoryLayer;
    content: string;
    score: number;
    metadata?: Record<string, unknown>;
}

// ─── IMemoryRouter ────────────────────────────────────────────────────────────

export interface IMemoryRouter {
    // L2 Episodic
    searchEpisodic(query: string, k: number, tenantId: string): Promise<EpisodicMemory[]>;
    insertEpisodic(item: Omit<EpisodicMemory, 'id' | 'createdAt' | 'expiresAt'>): Promise<void>;

    // L3 Semantic
    searchSemantic(entity: string, tenantId: string): Promise<SemanticFact[]>;
    upsertSemanticFact(fact: Omit<SemanticFact, 'id' | 'createdAt' | 'status'>): Promise<void>;
    pendingFacts(tenantId: string): Promise<SemanticFact[]>;
    reviewFact(factId: string, decision: 'approve' | 'reject', reviewer: string): Promise<void>;

    // L4 Procedural
    loadAgentRules(scope: string, tenantId: string): Promise<string>;

    // Unified
    query(query: string, opts: { sessionId: string; tenantId: string; limit?: number }): Promise<UnifiedMemoryResult[]>;
}
