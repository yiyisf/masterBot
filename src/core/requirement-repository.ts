import { nanoid } from 'nanoid';
import { db } from './database.js';

export type RequirementStatus =
    | 'synced'
    | 'queued'
    | 'in_progress'
    | 'waiting_input'
    | 'implemented'
    | 'merged'
    | 'failed'
    | 'cancelled';

export interface Requirement {
    id: string;
    projectId: string;
    reqKey: string;
    source: string;
    sourceKey: string;
    title: string;
    description: string | null;
    labels: string[];
    status: RequirementStatus;
    sourceUrl: string | null;
    sourceClosed: boolean;
    createdAt: string;
    updatedAt: string;
}

interface RequirementRow {
    id: string;
    project_id: string;
    req_key: string;
    source: string;
    source_key: string;
    title: string;
    description: string | null;
    labels: string | null;
    status: string;
    source_url: string | null;
    source_closed: number;
    created_at: string;
    updated_at: string;
}

function rowToRequirement(row: RequirementRow): Requirement {
    return {
        id: row.id,
        projectId: row.project_id,
        reqKey: row.req_key,
        source: row.source,
        sourceKey: row.source_key,
        title: row.title,
        description: row.description,
        labels: row.labels ? JSON.parse(row.labels) : [],
        status: row.status as RequirementStatus,
        sourceUrl: row.source_url,
        sourceClosed: Boolean(row.source_closed),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export interface CreateRequirementInput {
    projectId: string;
    reqKey: string;
    source: string;
    sourceKey: string;
    title: string;
    description?: string;
    labels?: string[];
    sourceUrl?: string;
}

export interface UpdateRequirementMetadataInput {
    title?: string;
    description?: string;
    labels?: string[];
    sourceUrl?: string;
}

/**
 * 手动需求 req_key 的数字段前缀，用于与同步渠道（如 GitHub issue number）的数字编号区分，
 * 避免撞车（spec §2.2）。
 */
const MANUAL_REQ_KEY_PREFIX = 'M';
const MANUAL_SEQUENCE_START = 10000;

export class RequirementRepository {
    private db: typeof db;

    constructor(database?: typeof db) {
        this.db = database ?? db;
    }

    create(input: CreateRequirementInput): Requirement {
        const id = nanoid();
        const now = new Date().toISOString();
        this.db.prepare(
            `INSERT INTO requirements (id, project_id, req_key, source, source_key, title, description, labels, status, source_url, source_closed, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, 0, ?, ?)`
        ).run(
            id,
            input.projectId,
            input.reqKey,
            input.source,
            input.sourceKey,
            input.title,
            input.description ?? null,
            input.labels ? JSON.stringify(input.labels) : null,
            input.sourceUrl ?? null,
            now,
            now
        );
        return this.getById(id)!;
    }

    getById(id: string): Requirement | null {
        const row = this.db.prepare('SELECT * FROM requirements WHERE id = ?').get(id) as RequirementRow | undefined;
        return row ? rowToRequirement(row) : null;
    }

    getByReqKey(reqKey: string): Requirement | null {
        const row = this.db.prepare('SELECT * FROM requirements WHERE req_key = ?').get(reqKey) as RequirementRow | undefined;
        return row ? rowToRequirement(row) : null;
    }

    /** 同步去重键查找（spec §2.2：(project_id, source, source_key) 唯一索引） */
    findByDedupKey(projectId: string, source: string, sourceKey: string): Requirement | null {
        const row = this.db.prepare(
            'SELECT * FROM requirements WHERE project_id = ? AND source = ? AND source_key = ?'
        ).get(projectId, source, sourceKey) as RequirementRow | undefined;
        return row ? rowToRequirement(row) : null;
    }

    listByProject(projectId: string, opts?: { status?: RequirementStatus }): Requirement[] {
        const rows = opts?.status
            ? this.db.prepare('SELECT * FROM requirements WHERE project_id = ? AND status = ? ORDER BY created_at DESC')
                .all(projectId, opts.status) as unknown as RequirementRow[]
            : this.db.prepare('SELECT * FROM requirements WHERE project_id = ? ORDER BY created_at DESC')
                .all(projectId) as unknown as RequirementRow[];
        return rows.map(rowToRequirement);
    }

    /**
     * 再次同步命中去重键时只更新元数据，绝不回退状态机（spec §2.2）。
     */
    updateMetadata(id: string, input: UpdateRequirementMetadataInput): Requirement | null {
        const existing = this.getById(id);
        if (!existing) return null;

        const now = new Date().toISOString();
        this.db.prepare(
            `UPDATE requirements
             SET title = ?, description = ?, labels = ?, source_url = ?, updated_at = ?
             WHERE id = ?`
        ).run(
            input.title ?? existing.title,
            input.description !== undefined ? input.description : existing.description,
            input.labels !== undefined ? JSON.stringify(input.labels) : (existing.labels.length ? JSON.stringify(existing.labels) : null),
            input.sourceUrl !== undefined ? input.sourceUrl : existing.sourceUrl,
            now,
            id
        );
        return this.getById(id);
    }

    updateStatus(id: string, status: RequirementStatus): void {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE requirements SET status = ?, updated_at = ? WHERE id = ?')
            .run(status, now, id);
    }

    markSourceClosed(id: string, closed: boolean = true): void {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE requirements SET source_closed = ?, updated_at = ? WHERE id = ?')
            .run(closed ? 1 : 0, now, id);
    }

    delete(id: string): boolean {
        const result = this.db.prepare('DELETE FROM requirements WHERE id = ?').run(id);
        return result.changes > 0;
    }

    /** 跨项目按状态查询（如启动扫描 in_progress/waiting_input，spec §5.6） */
    listByStatuses(statuses: RequirementStatus[]): Requirement[] {
        if (statuses.length === 0) return [];
        const placeholders = statuses.map(() => '?').join(',');
        const rows = this.db.prepare(`SELECT * FROM requirements WHERE status IN (${placeholders}) ORDER BY updated_at`)
            .all(...(statuses as unknown as import('node:sqlite').SQLInputValue[])) as unknown as RequirementRow[];
        return rows.map(rowToRequirement);
    }

    /**
     * 服务启动时扫描 in_progress/waiting_input 的需求 → 统一标 failed（spec §5.6）。
     * 返回被标记的需求列表，供调用方进一步处理（如同步标记对应 run 并写 error_message）。
     */
    markStuckAsFailed(): Requirement[] {
        const stuck = this.listByStatuses(['in_progress', 'waiting_input']);
        for (const req of stuck) {
            this.updateStatus(req.id, 'failed');
        }
        return stuck;
    }

    /**
     * 手动需求的项目内自增序列（spec §2.2：高位段/前缀避免与 issue 号撞车，如 M10001）。
     * 返回完整的数字段（含前缀），调用方拼接为 req_key = `{project_name}#{数字段}`。
     */
    nextManualSequence(projectId: string): string {
        const rows = this.db.prepare(
            `SELECT source_key FROM requirements WHERE project_id = ? AND source = 'manual'`
        ).all(projectId) as unknown as Array<{ source_key: string }>;

        let maxSeq = MANUAL_SEQUENCE_START - 1;
        for (const row of rows) {
            const match = row.source_key.match(new RegExp(`^${MANUAL_REQ_KEY_PREFIX}(\\d+)$`));
            if (match) {
                const seq = parseInt(match[1], 10);
                if (seq > maxSeq) maxSeq = seq;
            }
        }
        return `${MANUAL_REQ_KEY_PREFIX}${maxSeq + 1}`;
    }
}

export const requirementRepository = new RequirementRepository();
