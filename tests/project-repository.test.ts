import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ProjectRepository } from '../src/core/project-repository.js';

function createTestDb(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
            id                  TEXT PRIMARY KEY,
            name                TEXT NOT NULL UNIQUE,
            dir                 TEXT NOT NULL,
            description         TEXT,
            sync_source         TEXT NOT NULL DEFAULT 'github',
            sync_config         TEXT,
            last_synced_at      TEXT,
            max_concurrent_runs INTEGER NOT NULL DEFAULT 2,
            skills_installed_at TEXT,
            created_at          TEXT NOT NULL,
            updated_at          TEXT NOT NULL
        );
    `);
    return db;
}

describe('ProjectRepository', () => {
    let repo: ProjectRepository;

    beforeEach(() => {
        repo = new ProjectRepository(createTestDb() as any);
    });

    it('creates and retrieves a project with defaults', () => {
        const project = repo.create({ name: 'cmasterBot', dir: '/repo/cmasterBot' });
        expect(project.name).toBe('cmasterBot');
        expect(project.syncSource).toBe('github');
        expect(project.maxConcurrentRuns).toBe(2);
        expect(project.lastSyncedAt).toBeNull();
        expect(project.skillsInstalledAt).toBeNull();

        const fetched = repo.getById(project.id);
        expect(fetched).toEqual(project);
    });

    it('creates a project with custom syncConfig', () => {
        const project = repo.create({
            name: 'other-repo',
            dir: '/repo/other',
            syncConfig: { labelFilter: ['bug'] },
            maxConcurrentRuns: 5,
        });
        expect(project.syncConfig).toEqual({ labelFilter: ['bug'] });
        expect(project.maxConcurrentRuns).toBe(5);
    });

    it('looks up a project by name', () => {
        repo.create({ name: 'cmasterBot', dir: '/repo/cmasterBot' });
        expect(repo.getByName('cmasterBot')).not.toBeNull();
        expect(repo.getByName('nonexistent')).toBeNull();
    });

    it('lists all projects newest first', () => {
        const a = repo.create({ name: 'a', dir: '/a' });
        const b = repo.create({ name: 'b', dir: '/b' });
        const list = repo.list();
        expect(list.map(p => p.id)).toEqual(expect.arrayContaining([a.id, b.id]));
        expect(list).toHaveLength(2);
    });

    it('updates project fields', () => {
        const project = repo.create({ name: 'cmasterBot', dir: '/old' });
        const updated = repo.update(project.id, { dir: '/new', maxConcurrentRuns: 4 });
        expect(updated!.dir).toBe('/new');
        expect(updated!.maxConcurrentRuns).toBe(4);
    });

    it('update returns null for non-existent project', () => {
        expect(repo.update('nonexistent', { dir: '/x' })).toBeNull();
    });

    it('touchSynced sets last_synced_at', () => {
        const project = repo.create({ name: 'cmasterBot', dir: '/repo' });
        repo.touchSynced(project.id, '2026-07-11T00:00:00.000Z');
        expect(repo.getById(project.id)!.lastSyncedAt).toBe('2026-07-11T00:00:00.000Z');
    });

    it('markSkillsInstalled sets skills_installed_at', () => {
        const project = repo.create({ name: 'cmasterBot', dir: '/repo' });
        repo.markSkillsInstalled(project.id, '2026-07-11T00:00:00.000Z');
        expect(repo.getById(project.id)!.skillsInstalledAt).toBe('2026-07-11T00:00:00.000Z');
    });

    it('deletes a project', () => {
        const project = repo.create({ name: 'cmasterBot', dir: '/repo' });
        expect(repo.delete(project.id)).toBe(true);
        expect(repo.getById(project.id)).toBeNull();
        expect(repo.delete(project.id)).toBe(false);
    });
});
