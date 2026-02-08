import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { TaskRepository } from '../src/core/task-repository.js';

function createTestDb(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            title TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_pinned BOOLEAN DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            dependencies TEXT DEFAULT '[]',
            result TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
    `);
    db.exec(`INSERT INTO sessions (id, title) VALUES ('s1', 'Test Session')`);
    return db;
}

describe('TaskRepository', () => {
    let repo: TaskRepository;

    beforeEach(() => {
        const db = createTestDb();
        repo = new TaskRepository(db as any);
    });

    it('creates and retrieves a task', () => {
        const id = repo.createTask('s1', 'Do something');
        const task = repo.getTask(id);
        expect(task).not.toBeNull();
        expect(task!.description).toBe('Do something');
        expect(task!.status).toBe('pending');
        expect(task!.dependencies).toEqual([]);
    });

    it('creates task with dependencies', () => {
        const id1 = repo.createTask('s1', 'Step 1');
        const id2 = repo.createTask('s1', 'Step 2', [id1]);
        const task2 = repo.getTask(id2);
        expect(task2!.dependencies).toEqual([id1]);
    });

    it('lists tasks for a session', () => {
        repo.createTask('s1', 'A');
        repo.createTask('s1', 'B');
        const tasks = repo.getTasks('s1');
        expect(tasks).toHaveLength(2);
    });

    it('updates task status', () => {
        const id = repo.createTask('s1', 'Do it');
        repo.updateStatus(id, 'running');
        expect(repo.getTask(id)!.status).toBe('running');

        repo.updateStatus(id, 'completed', 'done!');
        const task = repo.getTask(id)!;
        expect(task.status).toBe('completed');
        expect(task.result).toBe('done!');
    });

    it('getReadyTasks returns pending tasks with all deps completed', () => {
        const a = repo.createTask('s1', 'A');
        const b = repo.createTask('s1', 'B');
        const c = repo.createTask('s1', 'C', [a, b]);

        // Initially only A and B are ready (no deps)
        let ready = repo.getReadyTasks('s1');
        expect(ready.map(t => t.id).sort()).toEqual([a, b].sort());

        // Complete A — C still blocked on B
        repo.updateStatus(a, 'completed');
        ready = repo.getReadyTasks('s1');
        expect(ready.map(t => t.id)).toEqual([b]);

        // Complete B — C becomes ready
        repo.updateStatus(b, 'completed');
        ready = repo.getReadyTasks('s1');
        expect(ready.map(t => t.id)).toEqual([c]);
    });

    it('handles diamond dependency (A→B, A→C, B→D, C→D)', () => {
        const a = repo.createTask('s1', 'A');
        const b = repo.createTask('s1', 'B', [a]);
        const c = repo.createTask('s1', 'C', [a]);
        const d = repo.createTask('s1', 'D', [b, c]);

        // Only A is ready initially
        let ready = repo.getReadyTasks('s1');
        expect(ready.map(t => t.id)).toEqual([a]);

        // Complete A → B and C become ready
        repo.updateStatus(a, 'completed');
        ready = repo.getReadyTasks('s1');
        expect(ready.map(t => t.id).sort()).toEqual([b, c].sort());

        // Complete B → D still blocked on C
        repo.updateStatus(b, 'completed');
        ready = repo.getReadyTasks('s1');
        expect(ready.map(t => t.id)).toEqual([c]);

        // Complete C → D becomes ready
        repo.updateStatus(c, 'completed');
        ready = repo.getReadyTasks('s1');
        expect(ready.map(t => t.id)).toEqual([d]);
    });

    it('empty DAG returns no ready tasks', () => {
        const ready = repo.getReadyTasks('s1');
        expect(ready).toEqual([]);
    });

    it('all completed returns no ready tasks', () => {
        const a = repo.createTask('s1', 'A');
        repo.updateStatus(a, 'completed');
        const ready = repo.getReadyTasks('s1');
        expect(ready).toEqual([]);
    });

    it('getDAG returns tasks and edges', () => {
        const a = repo.createTask('s1', 'A');
        const b = repo.createTask('s1', 'B', [a]);
        const c = repo.createTask('s1', 'C', [a]);

        const dag = repo.getDAG('s1');
        expect(dag.tasks).toHaveLength(3);
        expect(dag.edges).toEqual(expect.arrayContaining([
            { from: a, to: b },
            { from: a, to: c },
        ]));
    });

    it('returns null for non-existent task', () => {
        expect(repo.getTask('nonexistent')).toBeNull();
    });
});
