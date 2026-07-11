import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { RequirementRepository } from '../src/core/requirement-repository.js';

function createTestDb(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            dir TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS requirements (
            id             TEXT PRIMARY KEY,
            project_id     TEXT NOT NULL,
            req_key        TEXT NOT NULL,
            source         TEXT NOT NULL,
            source_key     TEXT NOT NULL,
            title          TEXT NOT NULL,
            description    TEXT,
            labels         TEXT,
            status         TEXT NOT NULL DEFAULT 'synced',
            source_url     TEXT,
            source_closed  INTEGER NOT NULL DEFAULT 0,
            created_at     TEXT NOT NULL,
            updated_at     TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_req_key      ON requirements(req_key);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_req_dedup    ON requirements(project_id, source, source_key);
        CREATE INDEX IF NOT EXISTS idx_req_project_status ON requirements(project_id, status);
    `);
    db.exec(`INSERT INTO projects (id, name, dir, created_at, updated_at) VALUES ('p1', 'cmasterBot', '/repo', '2026-01-01', '2026-01-01')`);
    db.exec(`INSERT INTO projects (id, name, dir, created_at, updated_at) VALUES ('p2', 'otherRepo', '/repo2', '2026-01-01', '2026-01-01')`);
    return db;
}

describe('RequirementRepository', () => {
    let repo: RequirementRepository;

    beforeEach(() => {
        repo = new RequirementRepository(createTestDb() as any);
    });

    it('creates a synced requirement with status defaulting to synced', () => {
        const req = repo.create({
            projectId: 'p1',
            reqKey: 'cmasterBot#42',
            source: 'github',
            sourceKey: '42',
            title: 'Add feature X',
            labels: ['bug'],
            sourceUrl: 'https://github.com/x/y/issues/42',
        });
        expect(req.status).toBe('synced');
        expect(req.sourceClosed).toBe(false);
        expect(req.labels).toEqual(['bug']);
    });

    it('looks up by req_key and by dedup key', () => {
        const req = repo.create({
            projectId: 'p1', reqKey: 'cmasterBot#42', source: 'github', sourceKey: '42', title: 'X',
        });
        expect(repo.getByReqKey('cmasterBot#42')!.id).toBe(req.id);
        expect(repo.findByDedupKey('p1', 'github', '42')!.id).toBe(req.id);
        expect(repo.findByDedupKey('p1', 'github', '999')).toBeNull();
    });

    it('rejects duplicate req_key via unique index', () => {
        repo.create({ projectId: 'p1', reqKey: 'cmasterBot#42', source: 'github', sourceKey: '42', title: 'X' });
        expect(() =>
            repo.create({ projectId: 'p1', reqKey: 'cmasterBot#42', source: 'github', sourceKey: '999', title: 'Y' })
        ).toThrow();
    });

    it('lists requirements by project, optionally filtered by status', () => {
        const a = repo.create({ projectId: 'p1', reqKey: 'cmasterBot#1', source: 'github', sourceKey: '1', title: 'A' });
        repo.create({ projectId: 'p1', reqKey: 'cmasterBot#2', source: 'github', sourceKey: '2', title: 'B' });
        repo.updateStatus(a.id, 'queued');

        expect(repo.listByProject('p1')).toHaveLength(2);
        expect(repo.listByProject('p1', { status: 'queued' }).map(r => r.id)).toEqual([a.id]);
        expect(repo.listByProject('p1', { status: 'merged' })).toHaveLength(0);
    });

    it('updateMetadata updates fields but never touches status (spec §2.2)', () => {
        const req = repo.create({ projectId: 'p1', reqKey: 'cmasterBot#1', source: 'github', sourceKey: '1', title: 'Old title' });
        repo.updateStatus(req.id, 'implemented');

        const updated = repo.updateMetadata(req.id, { title: 'New title', labels: ['p0'] });
        expect(updated!.title).toBe('New title');
        expect(updated!.labels).toEqual(['p0']);
        expect(updated!.status).toBe('implemented');
    });

    it('updateStatus transitions the state machine field', () => {
        const req = repo.create({ projectId: 'p1', reqKey: 'cmasterBot#1', source: 'github', sourceKey: '1', title: 'A' });
        repo.updateStatus(req.id, 'in_progress');
        expect(repo.getById(req.id)!.status).toBe('in_progress');
    });

    it('markSourceClosed sets the flag without touching status', () => {
        const req = repo.create({ projectId: 'p1', reqKey: 'cmasterBot#1', source: 'github', sourceKey: '1', title: 'A' });
        repo.updateStatus(req.id, 'queued');
        repo.markSourceClosed(req.id);
        const fetched = repo.getById(req.id)!;
        expect(fetched.sourceClosed).toBe(true);
        expect(fetched.status).toBe('queued');
    });

    it('nextManualSequence starts at M10000 and increments per project', () => {
        expect(repo.nextManualSequence('p1')).toBe('M10000');
        repo.create({ projectId: 'p1', reqKey: 'cmasterBot#M10000', source: 'manual', sourceKey: 'M10000', title: 'Manual A' });
        expect(repo.nextManualSequence('p1')).toBe('M10001');
        repo.create({ projectId: 'p1', reqKey: 'cmasterBot#M10001', source: 'manual', sourceKey: 'M10001', title: 'Manual B' });
        expect(repo.nextManualSequence('p1')).toBe('M10002');
    });

    it('nextManualSequence is scoped per project', () => {
        repo.create({ projectId: 'p1', reqKey: 'cmasterBot#M10000', source: 'manual', sourceKey: 'M10000', title: 'Manual A' });
        expect(repo.nextManualSequence('p2')).toBe('M10000');
    });

    it('deletes a requirement', () => {
        const req = repo.create({ projectId: 'p1', reqKey: 'cmasterBot#1', source: 'github', sourceKey: '1', title: 'A' });
        expect(repo.delete(req.id)).toBe(true);
        expect(repo.getById(req.id)).toBeNull();
    });

    it('listByStatuses queries across projects (启动扫描用)', () => {
        const a = repo.create({ projectId: 'p1', reqKey: 'cmasterBot#1', source: 'github', sourceKey: '1', title: 'A' });
        const b = repo.create({ projectId: 'p2', reqKey: 'otherRepo#1', source: 'github', sourceKey: '1', title: 'B' });
        repo.create({ projectId: 'p1', reqKey: 'cmasterBot#2', source: 'github', sourceKey: '2', title: 'C' });
        repo.updateStatus(a.id, 'in_progress');
        repo.updateStatus(b.id, 'waiting_input');

        const stuck = repo.listByStatuses(['in_progress', 'waiting_input']);
        expect(stuck.map(r => r.id).sort()).toEqual([a.id, b.id].sort());
    });

    it('listByStatuses returns empty array for an empty statuses list', () => {
        expect(repo.listByStatuses([])).toEqual([]);
    });

    it('markStuckAsFailed 把 in_progress/waiting_input 的需求统一标 failed（spec §5.6）', () => {
        const stuck1 = repo.create({ projectId: 'p1', reqKey: 'cmasterBot#1', source: 'github', sourceKey: '1', title: 'A' });
        const stuck2 = repo.create({ projectId: 'p1', reqKey: 'cmasterBot#2', source: 'github', sourceKey: '2', title: 'B' });
        const untouched = repo.create({ projectId: 'p1', reqKey: 'cmasterBot#3', source: 'github', sourceKey: '3', title: 'C' });
        repo.updateStatus(stuck1.id, 'in_progress');
        repo.updateStatus(stuck2.id, 'waiting_input');

        const marked = repo.markStuckAsFailed();
        expect(marked.map(r => r.id).sort()).toEqual([stuck1.id, stuck2.id].sort());
        expect(repo.getById(stuck1.id)!.status).toBe('failed');
        expect(repo.getById(stuck2.id)!.status).toBe('failed');
        expect(repo.getById(untouched.id)!.status).toBe('synced');
    });
});
