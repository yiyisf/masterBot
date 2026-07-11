import { nanoid } from 'nanoid';
import { db } from './database.js';

export interface Project {
    id: string;
    name: string;
    dir: string;
    description: string | null;
    syncSource: string;
    syncConfig: Record<string, unknown> | null;
    lastSyncedAt: string | null;
    maxConcurrentRuns: number;
    skillsInstalledAt: string | null;
    createdAt: string;
    updatedAt: string;
}

interface ProjectRow {
    id: string;
    name: string;
    dir: string;
    description: string | null;
    sync_source: string;
    sync_config: string | null;
    last_synced_at: string | null;
    max_concurrent_runs: number;
    skills_installed_at: string | null;
    created_at: string;
    updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
    return {
        id: row.id,
        name: row.name,
        dir: row.dir,
        description: row.description,
        syncSource: row.sync_source,
        syncConfig: row.sync_config ? JSON.parse(row.sync_config) : null,
        lastSyncedAt: row.last_synced_at,
        maxConcurrentRuns: row.max_concurrent_runs,
        skillsInstalledAt: row.skills_installed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export interface CreateProjectInput {
    name: string;
    dir: string;
    description?: string;
    syncSource?: string;
    syncConfig?: Record<string, unknown>;
    maxConcurrentRuns?: number;
}

export interface UpdateProjectInput {
    dir?: string;
    description?: string;
    syncSource?: string;
    syncConfig?: Record<string, unknown>;
    maxConcurrentRuns?: number;
}

export class ProjectRepository {
    private db: typeof db;

    constructor(database?: typeof db) {
        this.db = database ?? db;
    }

    create(input: CreateProjectInput): Project {
        const id = nanoid();
        const now = new Date().toISOString();
        this.db.prepare(
            `INSERT INTO projects (id, name, dir, description, sync_source, sync_config, max_concurrent_runs, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            id,
            input.name,
            input.dir,
            input.description ?? null,
            input.syncSource ?? 'github',
            input.syncConfig ? JSON.stringify(input.syncConfig) : null,
            input.maxConcurrentRuns ?? 2,
            now,
            now
        );
        return this.getById(id)!;
    }

    getById(id: string): Project | null {
        const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
        return row ? rowToProject(row) : null;
    }

    getByName(name: string): Project | null {
        const row = this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as ProjectRow | undefined;
        return row ? rowToProject(row) : null;
    }

    list(): Project[] {
        const rows = this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as unknown as ProjectRow[];
        return rows.map(rowToProject);
    }

    update(id: string, input: UpdateProjectInput): Project | null {
        const existing = this.getById(id);
        if (!existing) return null;

        const now = new Date().toISOString();
        this.db.prepare(
            `UPDATE projects
             SET dir = ?, description = ?, sync_source = ?, sync_config = ?, max_concurrent_runs = ?, updated_at = ?
             WHERE id = ?`
        ).run(
            input.dir ?? existing.dir,
            input.description !== undefined ? input.description : existing.description,
            input.syncSource ?? existing.syncSource,
            input.syncConfig !== undefined ? JSON.stringify(input.syncConfig) : (existing.syncConfig ? JSON.stringify(existing.syncConfig) : null),
            input.maxConcurrentRuns ?? existing.maxConcurrentRuns,
            now,
            id
        );
        return this.getById(id);
    }

    touchSynced(id: string, syncedAt: string = new Date().toISOString()): void {
        this.db.prepare('UPDATE projects SET last_synced_at = ?, updated_at = ? WHERE id = ?')
            .run(syncedAt, new Date().toISOString(), id);
    }

    markSkillsInstalled(id: string, installedAt: string = new Date().toISOString()): void {
        this.db.prepare('UPDATE projects SET skills_installed_at = ?, updated_at = ? WHERE id = ?')
            .run(installedAt, new Date().toISOString(), id);
    }

    delete(id: string): boolean {
        const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
        return result.changes > 0;
    }
}

export const projectRepository = new ProjectRepository();
