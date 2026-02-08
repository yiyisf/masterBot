import { nanoid } from 'nanoid';
import { db } from './database.js';

export interface Task {
    id: string;
    session_id: string;
    description: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    dependencies: string[];
    result: string | null;
    created_at: string;
    updated_at: string;
}

interface TaskRow {
    id: string;
    session_id: string;
    description: string;
    status: string;
    dependencies: string;
    result: string | null;
    created_at: string;
    updated_at: string;
}

function rowToTask(row: TaskRow): Task {
    return {
        ...row,
        status: row.status as Task['status'],
        dependencies: JSON.parse(row.dependencies || '[]'),
    };
}

export class TaskRepository {
    private db: typeof db;

    constructor(database?: typeof db) {
        this.db = database ?? db;
    }

    createTask(sessionId: string, description: string, dependencies: string[] = []): string {
        const id = nanoid();
        const now = new Date().toISOString();
        this.db.prepare(
            `INSERT INTO tasks (id, session_id, description, status, dependencies, created_at, updated_at)
             VALUES (?, ?, ?, 'pending', ?, ?, ?)`
        ).run(id, sessionId, description, JSON.stringify(dependencies), now, now);
        return id;
    }

    getTask(id: string): Task | null {
        const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
        return row ? rowToTask(row) : null;
    }

    getTasks(sessionId: string): Task[] {
        const rows = this.db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at').all(sessionId) as unknown as TaskRow[];
        return rows.map(rowToTask);
    }

    updateStatus(id: string, status: Task['status'], result?: string): void {
        const now = new Date().toISOString();
        if (result !== undefined) {
            this.db.prepare(
                'UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?'
            ).run(status, result, now, id);
        } else {
            this.db.prepare(
                'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?'
            ).run(status, now, id);
        }
    }

    getReadyTasks(sessionId: string): Task[] {
        const tasks = this.getTasks(sessionId);
        const completedIds = new Set(
            tasks.filter(t => t.status === 'completed').map(t => t.id)
        );

        return tasks.filter(t => {
            if (t.status !== 'pending') return false;
            return t.dependencies.every(dep => completedIds.has(dep));
        });
    }

    getDAG(sessionId: string): { tasks: Task[]; edges: Array<{ from: string; to: string }> } {
        const tasks = this.getTasks(sessionId);
        const edges: Array<{ from: string; to: string }> = [];

        for (const task of tasks) {
            for (const dep of task.dependencies) {
                edges.push({ from: dep, to: task.id });
            }
        }

        return { tasks, edges };
    }
}

export const taskRepository = new TaskRepository();
