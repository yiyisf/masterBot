/**
 * MemoryGovernor — 记忆治理引擎（U5）
 *
 * 对冲「记忆幻觉」的三道防线：
 * 1. 写入时治理：governedRemember() 用 LLM 对新记忆做查重/冲突检测
 *    - duplicate → 跳过写入，对既有条目 markVerified（提升置信度）
 *    - conflict  → 新记忆写入并 supersede 旧记忆
 *    - new       → 正常写入
 *    LLM 不可用或判断失败时一律降级为直接写入，绝不阻塞。
 * 2. 周期性反思：reflect() 衰减长期未验证记忆的置信度、清理低置信度条目。
 * 3. 召回加权：LongTermMemory.search() 按 置信度 × 时近性 加权（已在 LTM 内实现）。
 */

import type { LLMAdapter, Logger } from '../types.js';
import type { LongTermMemory } from './long-term.js';

export type GovernanceVerdict =
    | { action: 'insert' }
    | { action: 'skip_duplicate'; existingId: string }
    | { action: 'supersede'; oldId: string };

export interface GovernedRememberResult {
    id: string;
    verdict: GovernanceVerdict['action'];
}

export interface ReflectionResult {
    decayed: number;
    pruned: number;
    ranAt: string;
}

const JUDGE_SYSTEM_PROMPT = `你是记忆库治理员。判断"新记忆"与"既有记忆"的关系，只输出纯 JSON，不加任何说明：
- 新记忆与某条既有记忆表达相同事实 → {"verdict":"duplicate","targetId":"<既有记忆id>"}
- 新记忆与某条既有记忆矛盾（新信息应取代旧信息）→ {"verdict":"conflict","targetId":"<被取代的旧记忆id>"}
- 新记忆是新增信息，与既有记忆不重复不矛盾 → {"verdict":"new"}
判断原则：仅当事实内容实质相同/矛盾才算，主题相近但信息不同算 new。`;

export class MemoryGovernor {
    private _lastReflection?: ReflectionResult;

    constructor(
        private longTerm: LongTermMemory,
        private getLLM: () => LLMAdapter,
        private logger: Logger,
    ) {}

    /**
     * 治理式写入：查重/冲突检测后再决定 insert / skip / supersede。
     * 任何治理环节失败都降级为直接写入。
     */
    async governedRemember(
        content: string,
        metadata?: Record<string, unknown>,
        sessionId?: string
    ): Promise<GovernedRememberResult> {
        let verdict: GovernanceVerdict = { action: 'insert' };

        try {
            // 候选集 = 词法/向量检索结果 ∪ 最近同类记忆
            // （FTS 对 CJK「相似但不相同」句子召回有限，需补充时间维度候选）
            const searched = await this.longTerm.search(content, 5);
            const recent = this.longTerm.listRecent(10, metadata?.category as string | undefined);
            const seen = new Set<string>();
            const candidates = [...searched, ...recent]
                .filter(m => !seen.has(m.id) && seen.add(m.id))
                .slice(0, 8);

            if (candidates.length > 0) {
                verdict = await this._judge(content, candidates);
            }
        } catch (err) {
            this.logger.warn(`[memory-gov] Governance check failed, falling back to plain insert: ${(err as Error).message}`);
            verdict = { action: 'insert' };
        }

        if (verdict.action === 'skip_duplicate') {
            // 重复记忆视为「再次确认」：提升既有条目置信度，不重复写入
            this.longTerm.markVerified(verdict.existingId);
            this.logger.debug(`[memory-gov] Duplicate detected, verified existing memory ${verdict.existingId}`);
            return { id: verdict.existingId, verdict: 'skip_duplicate' };
        }

        if (verdict.action === 'supersede') {
            const id = await this.longTerm.remember(
                content,
                { ...metadata, supersedes: verdict.oldId },
                sessionId
            );
            this.logger.info(`[memory-gov] Conflict resolved: new memory ${id} supersedes ${verdict.oldId}`);
            return { id, verdict: 'supersede' };
        }

        const id = await this.longTerm.remember(content, metadata, sessionId);
        return { id, verdict: 'insert' };
    }

    /**
     * 周期性反思：衰减过期记忆置信度 + 清理低置信度条目。
     * 建议每 24h 调用一次（由 index.ts 定时器驱动）。
     */
    async reflect(opts?: Parameters<LongTermMemory['decayAndPrune']>[0]): Promise<ReflectionResult> {
        const { decayed, pruned } = this.longTerm.decayAndPrune(opts);
        this._lastReflection = { decayed, pruned, ranAt: new Date().toISOString() };
        if (decayed > 0 || pruned > 0) {
            this.logger.info(`[memory-gov] Reflection complete: ${decayed} decayed, ${pruned} pruned`);
        }
        return this._lastReflection;
    }

    getLastReflection(): ReflectionResult | undefined {
        return this._lastReflection;
    }

    // ─────────────────────────────── private ───────────────────────────────

    private async _judge(
        content: string,
        similar: Array<{ id: string; content: string }>
    ): Promise<GovernanceVerdict> {
        const candidates = similar
            .map(m => `- id: ${m.id}\n  content: ${m.content.slice(0, 300)}`)
            .join('\n');

        const response = await this.getLLM().chat(
            [
                { role: 'system', content: JUDGE_SYSTEM_PROMPT },
                { role: 'user', content: `## 新记忆\n${content.slice(0, 500)}\n\n## 既有记忆\n${candidates}` },
            ],
            { maxTokens: 200 }
        );

        const raw = typeof response.content === 'string' ? response.content : '';
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { action: 'insert' };

        const parsed = JSON.parse(jsonMatch[0]) as { verdict?: string; targetId?: string };
        const validIds = new Set(similar.map(m => m.id));

        if (parsed.verdict === 'duplicate' && parsed.targetId && validIds.has(parsed.targetId)) {
            return { action: 'skip_duplicate', existingId: parsed.targetId };
        }
        if (parsed.verdict === 'conflict' && parsed.targetId && validIds.has(parsed.targetId)) {
            return { action: 'supersede', oldId: parsed.targetId };
        }
        return { action: 'insert' };
    }
}
