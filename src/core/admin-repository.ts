import { randomUUID } from 'crypto';
import type { DatabaseSync } from 'node:sqlite';

export type SkillReviewStatus = 'pending' | 'approved' | 'rejected';
export type RbacEffect = 'allow' | 'deny';

export interface SkillReview {
    id: string;
    skill_name: string;
    skill_path: string;
    status: SkillReviewStatus;
    review_notes: string | null;
    reviewer: string | null;
    created_at: string;
    updated_at: string;
}

export interface RbacRule {
    id: string;
    subject: string;
    scope: string;
    effect: RbacEffect;
    created_by: string | null;
    created_at: string;
}

export interface AdminAuditEntry {
    id: string;
    admin_id: string;
    action: string;
    target: string | null;
    detail: string | null;
    created_at: string;
}

export class AdminRepository {
    constructor(private db: DatabaseSync) {}

    // ─── Skill Reviews ────────────────────────────────────────────────────────

    upsertSkillReview(skillName: string, skillPath: string): SkillReview {
        const existing = this.db.prepare(
            'SELECT * FROM skill_reviews WHERE skill_name = ?'
        ).get(skillName) as unknown as SkillReview | undefined;

        if (existing) return existing;

        const id = randomUUID();
        this.db.prepare(
            'INSERT INTO skill_reviews (id, skill_name, skill_path) VALUES (?, ?, ?)'
        ).run(id, skillName, skillPath);

        return this.db.prepare('SELECT * FROM skill_reviews WHERE id = ?').get(id) as unknown as SkillReview;
    }

    listSkillReviews(status?: SkillReviewStatus): SkillReview[] {
        if (status) {
            return this.db.prepare(
                'SELECT * FROM skill_reviews WHERE status = ? ORDER BY created_at DESC'
            ).all(status) as unknown as SkillReview[];
        }
        return this.db.prepare(
            'SELECT * FROM skill_reviews ORDER BY status ASC, created_at DESC'
        ).all() as unknown as SkillReview[];
    }

    updateSkillReview(
        skillName: string,
        status: SkillReviewStatus,
        reviewer: string,
        notes?: string,
    ): SkillReview | null {
        this.db.prepare(`
            UPDATE skill_reviews
            SET status = ?, reviewer = ?, review_notes = ?, updated_at = datetime('now')
            WHERE skill_name = ?
        `).run(status, reviewer, notes ?? null, skillName);

        return (this.db.prepare(
            'SELECT * FROM skill_reviews WHERE skill_name = ?'
        ).get(skillName) as unknown as SkillReview | undefined) ?? null;
    }

    // ─── RBAC Rules ───────────────────────────────────────────────────────────

    listRbacRules(): RbacRule[] {
        return this.db.prepare(
            'SELECT * FROM rbac_rules ORDER BY subject ASC, scope ASC'
        ).all() as unknown as RbacRule[];
    }

    createRbacRule(subject: string, scope: string, effect: RbacEffect, createdBy: string): RbacRule {
        const id = randomUUID();
        this.db.prepare(
            'INSERT INTO rbac_rules (id, subject, scope, effect, created_by) VALUES (?, ?, ?, ?, ?)'
        ).run(id, subject, scope, effect, createdBy);

        return this.db.prepare('SELECT * FROM rbac_rules WHERE id = ?').get(id) as unknown as RbacRule;
    }

    deleteRbacRule(id: string): boolean {
        const result = this.db.prepare('DELETE FROM rbac_rules WHERE id = ?').run(id);
        return (result as any).changes > 0;
    }

    // ─── Overview Stats ───────────────────────────────────────────────────────

    getOverviewStats() {
        const agentCallsToday = (() => {
            try {
                return (this.db.prepare(
                    "SELECT COUNT(*) as c FROM execution_records WHERE date(started_at) = date('now')"
                ).get() as any)?.c ?? 0;
            } catch { return 0; }
        })();

        const pendingSkillReviews = (this.db.prepare(
            "SELECT COUNT(*) as c FROM skill_reviews WHERE status = 'pending'"
        ).get() as any)?.c ?? 0;

        const pendingApprovals = (() => {
            try {
                return (this.db.prepare(
                    "SELECT COUNT(*) as c FROM audit_approvals WHERE decision IS NULL"
                ).get() as any)?.c ?? 0;
            } catch { return 0; }
        })();

        const totalTokensToday = (() => {
            try {
                return (this.db.prepare(
                    "SELECT SUM(total_tokens) as t FROM token_usage WHERE date(created_at) = date('now')"
                ).get() as any)?.t ?? 0;
            } catch { return 0; }
        })();

        const recentAdminActions = this.db.prepare(
            'SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 5'
        ).all() as unknown as AdminAuditEntry[];

        return {
            agentCallsToday,
            pendingSkillReviews,
            pendingApprovals,
            totalTokensToday,
            recentAdminActions,
        };
    }

    // ─── Admin Audit Log ──────────────────────────────────────────────────────

    logAdminAction(adminId: string, action: string, target?: string, detail?: string): void {
        this.db.prepare(
            'INSERT INTO admin_audit_log (id, admin_id, action, target, detail) VALUES (?, ?, ?, ?, ?)'
        ).run(randomUUID(), adminId, action, target ?? null, detail ?? null);
    }

    listAdminAuditLog(limit = 50): AdminAuditEntry[] {
        return this.db.prepare(
            'SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT ?'
        ).all(limit) as unknown as AdminAuditEntry[];
    }

    // ─── Cost data ────────────────────────────────────────────────────────────

    getCostDaily(days: number) {
        try {
            return this.db.prepare(`
                SELECT date(created_at) as date,
                       SUM(prompt_tokens) as prompt_tokens,
                       SUM(completion_tokens) as completion_tokens,
                       SUM(total_tokens) as total_tokens,
                       COUNT(*) as calls
                FROM token_usage
                WHERE created_at >= date('now', '-' || ? || ' days')
                GROUP BY date(created_at)
                ORDER BY date ASC
            `).all(days);
        } catch { return []; }
    }

    getCostByModel(days: number) {
        try {
            return this.db.prepare(`
                SELECT model,
                       SUM(total_tokens) as total_tokens,
                       COUNT(*) as calls
                FROM token_usage
                WHERE created_at >= date('now', '-' || ? || ' days')
                GROUP BY model
                ORDER BY total_tokens DESC
                LIMIT 10
            `).all(days);
        } catch { return []; }
    }

    getCostTopUsers(days: number) {
        try {
            return this.db.prepare(`
                SELECT session_id,
                       SUM(total_tokens) as total_tokens,
                       COUNT(*) as calls
                FROM token_usage
                WHERE created_at >= date('now', '-' || ? || ' days')
                GROUP BY session_id
                ORDER BY total_tokens DESC
                LIMIT 10
            `).all(days);
        } catch { return []; }
    }
}
