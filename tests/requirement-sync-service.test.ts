import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ProjectRepository } from '../src/core/project-repository.js';
import { RequirementRepository } from '../src/core/requirement-repository.js';
import { SyncSourceRegistry, type RequirementSyncSource, type RemoteRequirement } from '../src/core/requirement-sync.js';
import { RequirementSyncService } from '../src/core/requirement-sync-service.js';

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
    return db;
}

function fakeSource(items: RemoteRequirement[]): RequirementSyncSource {
    return {
        name: 'github',
        async fetchRequirements() { return items; },
    };
}

describe('RequirementSyncService', () => {
    let db: DatabaseSync;
    let projects: ProjectRepository;
    let requirements: RequirementRepository;
    let registry: SyncSourceRegistry;
    let service: RequirementSyncService;
    let projectId: string;

    beforeEach(() => {
        db = createTestDb();
        projects = new ProjectRepository(db as any);
        requirements = new RequirementRepository(db as any);
        registry = new SyncSourceRegistry();
        service = new RequirementSyncService({ projects, requirements, registry });
        projectId = projects.create({ name: 'cmasterBot', dir: '/repo/cmasterBot' }).id;
    });

    it('creates new requirements from remote items on first sync', async () => {
        registry.register(fakeSource([
            { sourceKey: '1', title: 'Bug A', labels: ['bug'], closed: false },
            { sourceKey: '2', title: 'Feature B', labels: [], closed: false },
        ]));

        const result = await service.syncProject(projectId);
        expect(result).toMatchObject({ source: 'github', created: 2, updated: 0, closed: 0 });

        const list = requirements.listByProject(projectId);
        expect(list).toHaveLength(2);
        expect(list.find(r => r.sourceKey === '1')!.reqKey).toBe('cmasterBot#1');
        expect(list.find(r => r.sourceKey === '1')!.status).toBe('synced');
    });

    it('touches project.lastSyncedAt after a sync', async () => {
        registry.register(fakeSource([]));
        expect(projects.getById(projectId)!.lastSyncedAt).toBeNull();
        await service.syncProject(projectId);
        expect(projects.getById(projectId)!.lastSyncedAt).not.toBeNull();
    });

    it('re-sync hitting the dedup key only updates metadata, never rolls back status (spec §2.2)', async () => {
        registry.register(fakeSource([{ sourceKey: '1', title: 'Old title', labels: [], closed: false }]));
        await service.syncProject(projectId);

        const created = requirements.findByDedupKey(projectId, 'github', '1')!;
        requirements.updateStatus(created.id, 'implemented');

        registry.register(fakeSource([{ sourceKey: '1', title: 'New title', labels: ['p0'], closed: false }]));
        const result = await service.syncProject(projectId);

        expect(result).toMatchObject({ created: 0, updated: 1 });
        const updated = requirements.getById(created.id)!;
        expect(updated.title).toBe('New title');
        expect(updated.labels).toEqual(['p0']);
        expect(updated.status).toBe('implemented');
    });

    it('marks source_closed when a remote item is closed, without double counting on repeat syncs', async () => {
        registry.register(fakeSource([{ sourceKey: '1', title: 'A', labels: [], closed: true }]));
        const first = await service.syncProject(projectId);
        expect(first).toMatchObject({ created: 1, closed: 1 });

        const req = requirements.findByDedupKey(projectId, 'github', '1')!;
        expect(req.sourceClosed).toBe(true);

        const second = await service.syncProject(projectId);
        expect(second).toMatchObject({ updated: 1, closed: 0 });
    });

    it('throws for an unknown project', async () => {
        registry.register(fakeSource([]));
        await expect(service.syncProject('nonexistent')).rejects.toThrow(/Project not found/);
    });

    it('throws for an unregistered sync source', async () => {
        await expect(service.syncProject(projectId)).rejects.toThrow(/Unknown sync source/);
    });

    it('createManualRequirement generates an M-prefixed req_key and source=manual', () => {
        const req = service.createManualRequirement(projectId, { title: 'Manual work' });
        expect(req.reqKey).toBe('cmasterBot#M10000');
        expect(req.source).toBe('manual');
        expect(req.sourceKey).toBe('M10000');
        expect(req.status).toBe('synced');

        const second = service.createManualRequirement(projectId, { title: 'More manual work' });
        expect(second.reqKey).toBe('cmasterBot#M10001');
    });

    it('createManualRequirement throws for an unknown project', () => {
        expect(() => service.createManualRequirement('nonexistent', { title: 'X' })).toThrow(/Project not found/);
    });
});
