import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { PendingQuestionsRepository, type PendingQuestion } from '../src/core/pending-questions-repository.js';

function createTestDb(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    db.exec(`
        CREATE TABLE IF NOT EXISTS pending_questions (
            id              TEXT PRIMARY KEY,
            requirement_id  TEXT NOT NULL,
            run_id          TEXT NOT NULL,
            session_id      TEXT NOT NULL,
            phase           TEXT NOT NULL,
            questions       TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending',
            answers         TEXT,
            created_at      TEXT NOT NULL,
            answered_at     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_pending_q_requirement ON pending_questions(requirement_id);
        CREATE INDEX IF NOT EXISTS idx_pending_q_status      ON pending_questions(status);
    `);
    return db;
}

const oneQuestion: PendingQuestion[] = [{
    id: 'q1',
    question: 'PDF 的版式基准是什么？',
    context: '周报目前是网页自适应布局',
    options: [
        { label: 'A4 纵向，跟随现有打印样式', description: '复用 print.css' },
        { label: 'A4 横向，表格优先' },
    ],
    recommended: 0,
}];

describe('PendingQuestionsRepository', () => {
    let repo: PendingQuestionsRepository;

    beforeEach(() => {
        repo = new PendingQuestionsRepository(createTestDb() as any);
    });

    it('creates a question set defaulting to pending / answers null', () => {
        const set = repo.create({ requirementId: 'req1', runId: 'run1', sessionId: 's1', phase: 'analysis', questions: oneQuestion });
        expect(set.status).toBe('pending');
        expect(set.answers).toBeNull();
        expect(set.answeredAt).toBeNull();
        expect(set.questions).toEqual(oneQuestion);
    });

    it('getLatestByRequirement 返回该需求最新的一组问题（逐题作答场景下每轮各建一组）', () => {
        repo.create({ requirementId: 'req1', runId: 'run1', sessionId: 's1', phase: 'analysis', questions: oneQuestion });
        const second = repo.create({ requirementId: 'req1', runId: 'run1', sessionId: 's1', phase: 'analysis', questions: [{ id: 'q2', question: '导出入口放在哪里？' }] });

        const latest = repo.getLatestByRequirement('req1');
        expect(latest!.id).toBe(second.id);
    });

    it('markAnswered 落库答案并转 answered', () => {
        const set = repo.create({ requirementId: 'req1', runId: 'run1', sessionId: 's1', phase: 'analysis', questions: oneQuestion });
        const updated = repo.markAnswered(set.id, ['A4 纵向，跟随现有打印样式']);
        expect(updated!.status).toBe('answered');
        expect(updated!.answers).toEqual(['A4 纵向，跟随现有打印样式']);
        expect(updated!.answeredAt).not.toBeNull();
    });

    it('markCancelled 转 cancelled（SSE 断连场景）', () => {
        const set = repo.create({ requirementId: 'req1', runId: 'run1', sessionId: 's1', phase: 'implementation', questions: oneQuestion });
        repo.markCancelled(set.id);
        expect(repo.getById(set.id)!.status).toBe('cancelled');
    });

    it('listPending 只返回 pending 状态的问题集，跨需求', () => {
        const a = repo.create({ requirementId: 'req1', runId: 'run1', sessionId: 's1', phase: 'analysis', questions: oneQuestion });
        const b = repo.create({ requirementId: 'req2', runId: 'run2', sessionId: 's2', phase: 'analysis', questions: oneQuestion });
        repo.markAnswered(a.id, ['x']);

        const pending = repo.listPending();
        expect(pending.map(p => p.id)).toEqual([b.id]);
    });
});
