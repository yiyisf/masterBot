import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { RequirementRunRepository } from '../src/core/requirement-run-repository.js';

function createTestDb(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    db.exec(`
        CREATE TABLE IF NOT EXISTS requirement_runs (
            id              TEXT PRIMARY KEY,
            requirement_id  TEXT NOT NULL,
            project_id      TEXT NOT NULL,
            engine          TEXT NOT NULL,
            worktree_path   TEXT,
            branch          TEXT,
            session_id      TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'running',
            retry_no        INTEGER NOT NULL DEFAULT 0,
            pr_url          TEXT,
            error_message   TEXT,
            token_cost      TEXT,
            started_at      TEXT NOT NULL,
            finished_at     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_req_runs_requirement ON requirement_runs(requirement_id, started_at);
        CREATE INDEX IF NOT EXISTS idx_req_runs_project     ON requirement_runs(project_id, started_at);
    `);
    return db;
}

describe('RequirementRunRepository', () => {
    let repo: RequirementRunRepository;

    beforeEach(() => {
        repo = new RequirementRunRepository(createTestDb() as any);
    });

    it('creates a run defaulting to running / retry_no 0', () => {
        const run = repo.create({
            requirementId: 'r1', projectId: 'p1', engine: 'claude-code', sessionId: 's1',
            worktreePath: '/repo/.cmaster/worktrees/cmasterBot-42', branch: 'req/cmasterBot-42',
        });
        expect(run.status).toBe('running');
        expect(run.retryNo).toBe(0);
        expect(run.finishedAt).toBeNull();
    });

    it('looks up a run by session id', () => {
        const run = repo.create({ requirementId: 'r1', projectId: 'p1', engine: 'claude-code', sessionId: 's1' });
        expect(repo.getBySessionId('s1')!.id).toBe(run.id);
        expect(repo.getBySessionId('nonexistent')).toBeNull();
    });

    it('lists runs by requirement, most recent first', () => {
        const a = repo.create({ requirementId: 'r1', projectId: 'p1', engine: 'claude-code', sessionId: 's1' });
        const b = repo.create({ requirementId: 'r1', projectId: 'p1', engine: 'claude-code', sessionId: 's2' });
        const runs = repo.listByRequirement('r1');
        expect(runs.map(r => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));
        expect(runs).toHaveLength(2);
    });

    it('lists runs by project respecting the limit', () => {
        repo.create({ requirementId: 'r1', projectId: 'p1', engine: 'claude-code', sessionId: 's1' });
        repo.create({ requirementId: 'r2', projectId: 'p1', engine: 'claude-code', sessionId: 's2' });
        expect(repo.listByProject('p1', 1)).toHaveLength(1);
        expect(repo.listByProject('p1')).toHaveLength(2);
    });

    it('updateStatus without finished leaves finished_at untouched', () => {
        const run = repo.create({ requirementId: 'r1', projectId: 'p1', engine: 'claude-code', sessionId: 's1' });
        repo.updateStatus(run.id, 'waiting_input');
        const fetched = repo.getById(run.id)!;
        expect(fetched.status).toBe('waiting_input');
        expect(fetched.finishedAt).toBeNull();
    });

    it('updateStatus with finished=true sets finished_at and error_message', () => {
        const run = repo.create({ requirementId: 'r1', projectId: 'p1', engine: 'claude-code', sessionId: 's1' });
        repo.updateStatus(run.id, 'failed', { errorMessage: 'boom', finished: true });
        const fetched = repo.getById(run.id)!;
        expect(fetched.status).toBe('failed');
        expect(fetched.errorMessage).toBe('boom');
        expect(fetched.finishedAt).not.toBeNull();
    });

    it('setPrUrl and setTokenCost update the respective fields', () => {
        const run = repo.create({ requirementId: 'r1', projectId: 'p1', engine: 'claude-code', sessionId: 's1' });
        repo.setPrUrl(run.id, 'https://github.com/x/y/pull/1');
        repo.setTokenCost(run.id, { promptTokens: 100, completionTokens: 50 });
        const fetched = repo.getById(run.id)!;
        expect(fetched.prUrl).toBe('https://github.com/x/y/pull/1');
        expect(fetched.tokenCost).toEqual({ promptTokens: 100, completionTokens: 50 });
    });

    it('incrementRetryFrom creates a new run carrying forward worktree/branch and bumped retry_no', () => {
        const first = repo.create({
            requirementId: 'r1', projectId: 'p1', engine: 'claude-code', sessionId: 's1',
            worktreePath: '/wt', branch: 'req/x-1',
        });
        repo.updateStatus(first.id, 'failed', { finished: true });

        const retry = repo.incrementRetryFrom(first, 's2');
        expect(retry.retryNo).toBe(1);
        expect(retry.worktreePath).toBe('/wt');
        expect(retry.branch).toBe('req/x-1');
        expect(retry.status).toBe('running');
        expect(repo.listByRequirement('r1')).toHaveLength(2);
    });
});
