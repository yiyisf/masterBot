import { nanoid } from 'nanoid';
import { db } from './database.js';

export type RequirementRunStatus = 'running' | 'waiting_input' | 'succeeded' | 'failed' | 'cancelled';

export interface RequirementRun {
    id: string;
    requirementId: string;
    projectId: string;
    engine: string;
    worktreePath: string | null;
    branch: string | null;
    sessionId: string;
    status: RequirementRunStatus;
    retryNo: number;
    prUrl: string | null;
    errorMessage: string | null;
    tokenCost: Record<string, unknown> | null;
    /** 引擎侧会话续接凭据（codex=rollout uuid / opencode/pi=首行 session id），供问答后原生续接 */
    resumeToken: string | null;
    startedAt: string;
    finishedAt: string | null;
}

interface RequirementRunRow {
    id: string;
    requirement_id: string;
    project_id: string;
    engine: string;
    worktree_path: string | null;
    branch: string | null;
    session_id: string;
    status: string;
    retry_no: number;
    pr_url: string | null;
    error_message: string | null;
    token_cost: string | null;
    resume_token: string | null;
    started_at: string;
    finished_at: string | null;
}

function rowToRun(row: RequirementRunRow): RequirementRun {
    return {
        id: row.id,
        requirementId: row.requirement_id,
        projectId: row.project_id,
        engine: row.engine,
        worktreePath: row.worktree_path,
        branch: row.branch,
        sessionId: row.session_id,
        status: row.status as RequirementRunStatus,
        retryNo: row.retry_no,
        prUrl: row.pr_url,
        errorMessage: row.error_message,
        tokenCost: row.token_cost ? JSON.parse(row.token_cost) : null,
        resumeToken: row.resume_token,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
    };
}

export interface CreateRequirementRunInput {
    requirementId: string;
    projectId: string;
    engine: string;
    sessionId: string;
    worktreePath?: string;
    branch?: string;
    retryNo?: number;
}

export class RequirementRunRepository {
    private db: typeof db;

    constructor(database?: typeof db) {
        this.db = database ?? db;
    }

    create(input: CreateRequirementRunInput): RequirementRun {
        const id = nanoid();
        const now = new Date().toISOString();
        this.db.prepare(
            `INSERT INTO requirement_runs (id, requirement_id, project_id, engine, worktree_path, branch, session_id, status, retry_no, started_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`
        ).run(
            id,
            input.requirementId,
            input.projectId,
            input.engine,
            input.worktreePath ?? null,
            input.branch ?? null,
            input.sessionId,
            input.retryNo ?? 0,
            now
        );
        return this.getById(id)!;
    }

    getById(id: string): RequirementRun | null {
        const row = this.db.prepare('SELECT * FROM requirement_runs WHERE id = ?').get(id) as RequirementRunRow | undefined;
        return row ? rowToRun(row) : null;
    }

    getBySessionId(sessionId: string): RequirementRun | null {
        const row = this.db.prepare('SELECT * FROM requirement_runs WHERE session_id = ?').get(sessionId) as RequirementRunRow | undefined;
        return row ? rowToRun(row) : null;
    }

    listByRequirement(requirementId: string): RequirementRun[] {
        const rows = this.db.prepare('SELECT * FROM requirement_runs WHERE requirement_id = ? ORDER BY started_at DESC')
            .all(requirementId) as unknown as RequirementRunRow[];
        return rows.map(rowToRun);
    }

    listByProject(projectId: string, limit = 50): RequirementRun[] {
        const rows = this.db.prepare('SELECT * FROM requirement_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?')
            .all(projectId, limit) as unknown as RequirementRunRow[];
        return rows.map(rowToRun);
    }

    updateStatus(id: string, status: RequirementRunStatus, opts?: { errorMessage?: string; finished?: boolean }): void {
        const finishedAt = opts?.finished ? new Date().toISOString() : undefined;
        if (finishedAt !== undefined) {
            this.db.prepare('UPDATE requirement_runs SET status = ?, error_message = ?, finished_at = ? WHERE id = ?')
                .run(status, opts?.errorMessage ?? null, finishedAt, id);
        } else {
            this.db.prepare('UPDATE requirement_runs SET status = ?, error_message = ? WHERE id = ?')
                .run(status, opts?.errorMessage ?? null, id);
        }
    }

    setPrUrl(id: string, prUrl: string): void {
        this.db.prepare('UPDATE requirement_runs SET pr_url = ? WHERE id = ?').run(prUrl, id);
    }

    setTokenCost(id: string, tokenCost: Record<string, unknown>): void {
        this.db.prepare('UPDATE requirement_runs SET token_cost = ? WHERE id = ?').run(JSON.stringify(tokenCost), id);
    }

    /** 引擎 run() 结束后捕获的会话续接凭据，供回答分派时判断走 resume 续接 */
    setResumeToken(id: string, resumeToken: string): void {
        this.db.prepare('UPDATE requirement_runs SET resume_token = ? WHERE id = ?').run(resumeToken, id);
    }

    incrementRetryFrom(previousRun: RequirementRun, sessionId: string): RequirementRun {
        return this.create({
            requirementId: previousRun.requirementId,
            projectId: previousRun.projectId,
            engine: previousRun.engine,
            sessionId,
            worktreePath: previousRun.worktreePath ?? undefined,
            branch: previousRun.branch ?? undefined,
            retryNo: previousRun.retryNo + 1,
        });
    }

    /** 跨项目按状态查询（如启动扫描 running/waiting_input，spec §5.6） */
    listByStatuses(statuses: RequirementRunStatus[]): RequirementRun[] {
        if (statuses.length === 0) return [];
        const placeholders = statuses.map(() => '?').join(',');
        const rows = this.db.prepare(`SELECT * FROM requirement_runs WHERE status IN (${placeholders}) ORDER BY started_at`)
            .all(...(statuses as unknown as import('node:sqlite').SQLInputValue[])) as unknown as RequirementRunRow[];
        return rows.map(rowToRun);
    }

    /**
     * 服务启动时扫描 running/waiting_input 的 run → 统一标 failed（spec §5.6）。
     * 返回被标记的 run 列表。
     */
    markStuckAsFailed(errorMessage: string): RequirementRun[] {
        const stuck = this.listByStatuses(['running', 'waiting_input']);
        for (const run of stuck) {
            this.updateStatus(run.id, 'failed', { errorMessage, finished: true });
        }
        return stuck;
    }
}

export const requirementRunRepository = new RequirementRunRepository();
