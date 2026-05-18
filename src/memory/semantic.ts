/**
 * Phase 6: L3 Semantic Memory
 * 知识图谱增强版 — 写入需通过 HitL 审批，查询即时可用 approved 事实。
 */

import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { Logger } from '../types.js';
import type { SemanticFact } from './types.js';

export class SemanticMemoryStore {
    constructor(
        private db: Database.Database,
        private logger: Logger,
    ) {}

    initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS semantic_facts (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                subject TEXT NOT NULL,
                predicate TEXT NOT NULL,
                object TEXT NOT NULL,
                confidence REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                reviewed_by TEXT,
                reviewed_at INTEGER,
                source_session_id TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sf_tenant ON semantic_facts(tenant_id);
            CREATE INDEX IF NOT EXISTS idx_sf_status ON semantic_facts(status);
            CREATE INDEX IF NOT EXISTS idx_sf_subject ON semantic_facts(subject, tenant_id);
        `);
        this.logger.debug('[semantic] SemanticMemoryStore initialized');
    }

    /**
     * 提交候选事实（confidence >= 0.85 方可进入 pending）。
     * 同一 tenant 下 subject+predicate 已存在 approved 事实时跳过。
     */
    async upsert(fact: Omit<SemanticFact, 'id' | 'createdAt' | 'status'>): Promise<void> {
        if (fact.confidence < 0.85) {
            this.logger.debug(`[semantic] confidence ${fact.confidence} < 0.85, skip`);
            return;
        }
        // Skip if already approved OR pending (prevent duplicate pending for same subject+predicate)
        const existing = this.db.prepare(`
            SELECT id FROM semantic_facts
            WHERE tenant_id = ? AND subject = ? AND predicate = ? AND status IN ('approved', 'pending')
        `).get(fact.tenantId, fact.subject, fact.predicate);
        if (existing) return;

        const id = nanoid();
        this.db.prepare(`
            INSERT INTO semantic_facts
                (id, tenant_id, subject, predicate, object, confidence, status, source_session_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `).run(id, fact.tenantId, fact.subject, fact.predicate, fact.object, fact.confidence, fact.sourceSessionId ?? null, Date.now());
        this.logger.info(`[semantic] New pending fact: ${fact.subject} ${fact.predicate} ${fact.object} (${fact.tenantId})`);
    }

    /**
     * 搜索已 approved 的事实（按 subject 模糊匹配）。
     */
    async search(entity: string, tenantId: string): Promise<SemanticFact[]> {
        const rows = this.db.prepare(`
            SELECT * FROM semantic_facts
            WHERE tenant_id = ?
              AND status = 'approved'
              AND (subject LIKE ? OR object LIKE ?)
            ORDER BY confidence DESC
            LIMIT 20
        `).all(tenantId, `%${entity}%`, `%${entity}%`) as any[];
        return rows.map(r => this.rowToFact(r));
    }

    /** 列出待审批事实 */
    async pendingFacts(tenantId: string): Promise<SemanticFact[]> {
        const rows = this.db.prepare(`
            SELECT * FROM semantic_facts
            WHERE tenant_id = ? AND status = 'pending'
            ORDER BY confidence DESC, created_at ASC
        `).all(tenantId) as any[];
        return rows.map(r => this.rowToFact(r));
    }

    /** 审批事实（approve / reject）— 强制 tenant_id 隔离 */
    async review(factId: string, decision: 'approve' | 'reject', reviewer: string, tenantId: string): Promise<boolean> {
        const status = decision === 'approve' ? 'approved' : 'rejected';
        const result = this.db.prepare(`
            UPDATE semantic_facts
            SET status = ?, reviewed_by = ?, reviewed_at = ?
            WHERE id = ? AND tenant_id = ? AND status = 'pending'
        `).run(status, reviewer, Date.now(), factId, tenantId);
        if (Number(result.changes) === 0) {
            this.logger.warn(`[semantic] review: fact ${factId} not found or not pending for tenant ${tenantId}`);
            return false;
        }
        this.logger.info(`[semantic] Fact ${factId} ${status} by ${reviewer} (tenant: ${tenantId})`);
        return true;
    }

    /** 所有 tenant facts（管理员视角） */
    allByTenant(tenantId: string): SemanticFact[] {
        const rows = this.db.prepare(
            'SELECT * FROM semantic_facts WHERE tenant_id = ? ORDER BY created_at DESC'
        ).all(tenantId) as any[];
        return rows.map(r => this.rowToFact(r));
    }

    private rowToFact(r: any): SemanticFact {
        return {
            id: r.id,
            tenantId: r.tenant_id,
            subject: r.subject,
            predicate: r.predicate,
            object: r.object,
            confidence: r.confidence,
            status: r.status,
            reviewedBy: r.reviewed_by ?? undefined,
            reviewedAt: r.reviewed_at ?? undefined,
            sourceSessionId: r.source_session_id ?? undefined,
            createdAt: r.created_at,
        };
    }
}
