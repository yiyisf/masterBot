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
    // Phase 21 new fields
    condition?: string;
    priority: number;
    retry_count: number;
    max_retries: number;
    trace_id?: string;
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
    condition: string | null;
    priority: number;
    retry_count: number;
    max_retries: number;
    trace_id: string | null;
}

function rowToTask(row: TaskRow): Task {
    return {
        ...row,
        status: row.status as Task['status'],
        dependencies: JSON.parse(row.dependencies || '[]'),
        condition: row.condition ?? undefined,
        priority: row.priority ?? 0,
        retry_count: row.retry_count ?? 0,
        max_retries: row.max_retries ?? 0,
        trace_id: row.trace_id ?? undefined,
    };
}

export interface CreateTaskOptions {
    priority?: number;
    maxRetries?: number;
    condition?: string;
    traceId?: string;
}

export class TaskRepository {
    private db: typeof db;

    constructor(database?: typeof db) {
        this.db = database ?? db;
    }

    createTask(
        sessionId: string,
        description: string,
        dependencies: string[] = [],
        opts?: CreateTaskOptions
    ): string {
        const id = nanoid();
        const now = new Date().toISOString();
        this.db.prepare(
            `INSERT INTO tasks (id, session_id, description, status, dependencies, priority, max_retries, condition, trace_id, created_at, updated_at)
             VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            id,
            sessionId,
            description,
            JSON.stringify(dependencies),
            opts?.priority ?? 0,
            opts?.maxRetries ?? 0,
            opts?.condition ?? null,
            opts?.traceId ?? null,
            now,
            now
        );
        return id;
    }

    getTask(id: string): Task | null {
        const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
        return row ? rowToTask(row) : null;
    }

    getTasks(sessionId: string): Task[] {
        const rows = this.db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY priority DESC, created_at').all(sessionId) as unknown as TaskRow[];
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

    incrementRetry(id: string): void {
        const now = new Date().toISOString();
        this.db.prepare(
            'UPDATE tasks SET retry_count = retry_count + 1, status = \'pending\', updated_at = ? WHERE id = ?'
        ).run(now, id);
    }

    /**
     * 使用 Kahn 算法检测 DAG 中是否存在循环依赖
     * 返回 true 表示有环
     */
    detectCycles(sessionId: string): boolean {
        const tasks = this.getTasks(sessionId);
        if (tasks.length === 0) return false;

        const taskIds = new Set(tasks.map(t => t.id));
        // 入度表
        const inDegree = new Map<string, number>();
        // 邻接表（从依赖 → 被依赖）
        const adj = new Map<string, string[]>();

        for (const task of tasks) {
            if (!inDegree.has(task.id)) inDegree.set(task.id, 0);
            if (!adj.has(task.id)) adj.set(task.id, []);
            for (const dep of task.dependencies) {
                if (!taskIds.has(dep)) continue; // 忽略跨会话或已删除依赖
                inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
                if (!adj.has(dep)) adj.set(dep, []);
                adj.get(dep)!.push(task.id);
            }
        }

        // BFS: 将入度为 0 的节点入队
        const queue: string[] = [];
        for (const [id, deg] of inDegree.entries()) {
            if (deg === 0) queue.push(id);
        }

        let processed = 0;
        while (queue.length > 0) {
            const curr = queue.shift()!;
            processed++;
            for (const neighbor of (adj.get(curr) ?? [])) {
                const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
                inDegree.set(neighbor, newDeg);
                if (newDeg === 0) queue.push(neighbor);
            }
        }

        // 若处理数 < 总节点数，说明有环
        return processed < tasks.length;
    }

    getReadyTasks(sessionId: string): Task[] {
        const tasks = this.getTasks(sessionId);
        const completedIds = new Set(
            tasks.filter(t => t.status === 'completed').map(t => t.id)
        );
        const failedIds = new Set(
            tasks.filter(t => t.status === 'failed').map(t => t.id)
        );

        return tasks.filter(t => {
            if (t.status !== 'pending') return false;

            // 检查条件表达式，格式: "depId:completed" 或 "depId:failed"
            if (t.condition) {
                const [depId, requiredStatus] = t.condition.split(':');
                if (requiredStatus === 'failed') {
                    // 仅当指定依赖失败时才就绪
                    return failedIds.has(depId) &&
                        t.dependencies.filter(d => d !== depId).every(dep => completedIds.has(dep));
                }
                // 默认按条件依赖状态判断
                return completedIds.has(depId) &&
                    t.dependencies.filter(d => d !== depId).every(dep => completedIds.has(dep));
            }

            // 默认：所有依赖都完成
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
