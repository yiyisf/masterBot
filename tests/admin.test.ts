import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDatabase } from '../src/core/database.js';
import { AdminRepository } from '../src/core/admin-repository.js';
import { createAdminHook } from '../src/gateway/auth.js';
import { vi } from 'vitest';
import type { Logger } from '../src/types.js';

const mockLogger: Logger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
};

// ─── AdminRepository Tests ────────────────────────────────────────────────────

describe('AdminRepository', () => {
    let db: Database.Database;
    let repo: AdminRepository;

    beforeEach(() => {
        db = initDatabase(':memory:');
        repo = new AdminRepository(db);
        // 清空 admin 表，防止跨测试数据污染（node:sqlite :memory: 复用同一连接时）
        db.prepare('DELETE FROM skill_reviews').run();
        db.prepare('DELETE FROM rbac_rules').run();
        db.prepare('DELETE FROM admin_audit_log').run();
    });

    it('upsertSkillReview: 新建后 status 为 pending', () => {
        const r = repo.upsertSkillReview('test-skill', '/skills/test');
        expect(r.skill_name).toBe('test-skill');
        expect(r.status).toBe('pending');
    });

    it('upsertSkillReview: 重复调用返回同一记录', () => {
        const r1 = repo.upsertSkillReview('dup-skill', '/skills/dup');
        const r2 = repo.upsertSkillReview('dup-skill', '/skills/dup');
        expect(r1.id).toBe(r2.id);
    });

    it('listSkillReviews: 无过滤器返回所有', () => {
        repo.upsertSkillReview('s1', '/p1');
        repo.upsertSkillReview('s2', '/p2');
        expect(repo.listSkillReviews().length).toBe(2);
    });

    it('listSkillReviews: 按 status 过滤', () => {
        repo.upsertSkillReview('sa', '/pa');
        repo.updateSkillReview('sa', 'approved', 'admin1');
        repo.upsertSkillReview('sb', '/pb');
        const pending = repo.listSkillReviews('pending');
        expect(pending.length).toBe(1);
        expect(pending[0].skill_name).toBe('sb');
    });

    it('updateSkillReview: status 和 reviewer 正确更新', () => {
        repo.upsertSkillReview('upd-skill', '/upd');
        const updated = repo.updateSkillReview('upd-skill', 'rejected', 'admin2', '太危险');
        expect(updated?.status).toBe('rejected');
        expect(updated?.reviewer).toBe('admin2');
        expect(updated?.review_notes).toBe('太危险');
    });

    it('updateSkillReview: 不存在的技能返回 null', () => {
        const result = repo.updateSkillReview('ghost', 'approved', 'admin');
        expect(result).toBeNull();
    });

    it('listRbacRules: 初始为空', () => {
        expect(repo.listRbacRules()).toHaveLength(0);
    });

    it('createRbacRule: 创建后可查询', () => {
        const rule = repo.createRbacRule('user:alice', 'shell', 'deny', 'admin1');
        expect(rule.subject).toBe('user:alice');
        expect(rule.effect).toBe('deny');
        const rules = repo.listRbacRules();
        expect(rules.length).toBe(1);
    });

    it('deleteRbacRule: 删除存在的规则返回 true', () => {
        const rule = repo.createRbacRule('role:dev', '*', 'allow', 'admin1');
        expect(repo.deleteRbacRule(rule.id)).toBe(true);
        expect(repo.listRbacRules()).toHaveLength(0);
    });

    it('deleteRbacRule: 删除不存在的规则返回 false', () => {
        expect(repo.deleteRbacRule('nonexistent-id')).toBe(false);
    });

    it('logAdminAction: 可记录并查询', () => {
        repo.logAdminAction('admin1', 'skill_review_approved', 'my-skill', '通过审核');
        const logs = repo.listAdminAuditLog();
        expect(logs.length).toBe(1);
        expect(logs[0].action).toBe('skill_review_approved');
        expect(logs[0].target).toBe('my-skill');
    });

    it('getOverviewStats: 返回数字类型字段', () => {
        const stats = repo.getOverviewStats();
        expect(typeof stats.agentCallsToday).toBe('number');
        expect(typeof stats.pendingSkillReviews).toBe('number');
        expect(typeof stats.pendingApprovals).toBe('number');
        expect(typeof stats.totalTokensToday).toBe('number');
        expect(Array.isArray(stats.recentAdminActions)).toBe(true);
    });

    it('getCostDaily: 无数据时返回空数组', () => {
        expect(repo.getCostDaily(30)).toEqual([]);
    });

    it('getCostByModel: 无数据时返回空数组', () => {
        expect(repo.getCostByModel(30)).toEqual([]);
    });
});

// ─── createAdminHook Tests ────────────────────────────────────────────────────

describe('createAdminHook', () => {
    const VALID_KEY = 'valid-admin-key-123';
    const hook = createAdminHook([VALID_KEY], mockLogger);

    function makeCtx(key?: string) {
        const reply = {
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        };
        const request = {
            headers: key ? { 'x-admin-key': key } : {},
            ip: '127.0.0.1',
            url: '/api/admin/stats',
        } as any;
        return { request, reply };
    }

    it('正确的 key → 调用 done()', () => {
        const { request, reply } = makeCtx(VALID_KEY);
        const done = vi.fn();
        hook(request, reply as any, done);
        expect(done).toHaveBeenCalled();
        expect(reply.status).not.toHaveBeenCalled();
    });

    it('错误的 key → 返回 403', () => {
        const { request, reply } = makeCtx('wrong-key');
        const done = vi.fn();
        hook(request, reply as any, done);
        expect(reply.status).toHaveBeenCalledWith(403);
        expect(done).not.toHaveBeenCalled();
    });

    it('缺少 key → 返回 403', () => {
        const { request, reply } = makeCtx(undefined);
        const done = vi.fn();
        hook(request, reply as any, done);
        expect(reply.status).toHaveBeenCalledWith(403);
        expect(done).not.toHaveBeenCalled();
    });
});
