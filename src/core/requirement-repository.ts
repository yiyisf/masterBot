import { nanoid } from 'nanoid';
import { db } from './database.js';

export type RequirementStatus =
    | 'synced'
    | 'queued'
    | 'in_progress'
    | 'waiting_input'
    | 'analyzed'
    | 'implemented'
    | 'merged'
    | 'failed'
    | 'cancelled';

/** 两阶段自动化：需求当前处于哪个阶段（NULL = 旧单阶段直通路径） */
export type RequirementPhase = 'analysis' | 'implementation';

/** 分析产出的结构化规格（目标/范围/验收），由 grilling+to-spec skill 产出后落库 */
export interface AnalysisSpec {
    goal?: string;
    scope?: string;
    acceptance?: string;
    [key: string]: unknown;
}

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
    /** 当前阶段，NULL = 旧单阶段直通路径 */
    phase: RequirementPhase | null;
    /** 分析规格 JSON，NULL = 尚未分析完成或走的旧路径 */
    analysisSpec: AnalysisSpec | null;
    /** 父需求 id，NULL = 非卡片（普通需求） */
    parentId: string | null;
    /** 卡片在父需求下的串行执行序号，NULL = 非卡片 */
    cardNo: number | null;
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
    phase: string | null;
    analysis_spec: string | null;
    parent_id: string | null;
    card_no: number | null;
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
        phase: (row.phase as RequirementPhase | null) ?? null,
        analysisSpec: row.analysis_spec ? JSON.parse(row.analysis_spec) : null,
        parentId: row.parent_id,
        cardNo: row.card_no,
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

    /** 两阶段自动化：进入/切换阶段（analysis/implementation），不改动状态 */
    updatePhase(id: string, phase: RequirementPhase): void {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE requirements SET phase = ?, updated_at = ? WHERE id = ?')
            .run(phase, now, id);
    }

    /** 分析阶段完成后落库结构化规格；analyzed 状态下页面可再次调用本方法保存核验中的编辑 */
    updateAnalysisSpec(id: string, spec: AnalysisSpec): void {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE requirements SET analysis_spec = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(spec), now, id);
    }

    /**
     * 拆卡：把一张实现卡片建成父需求的子 requirement（spec: 卡 = 子 requirement，
     * parentId + cardNo 串行顺序，无依赖图）。cardNo 由调用方按 to-tickets 的输出顺序传入。
     */
    createCard(input: { parentId: string; projectId: string; reqKey: string; source: string; sourceKey: string; title: string; cardNo: number }): Requirement {
        const id = nanoid();
        const now = new Date().toISOString();
        this.db.prepare(
            `INSERT INTO requirements (id, project_id, req_key, source, source_key, title, status, source_closed, parent_id, card_no, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)`
        ).run(
            id,
            input.projectId,
            input.reqKey,
            input.source,
            input.sourceKey,
            input.title,
            input.parentId,
            input.cardNo,
            now,
            now
        );
        return this.getById(id)!;
    }

    /** 一张父需求下的全部卡片，按执行顺序（card_no 升序）返回 */
    listCardsByParent(parentId: string): Requirement[] {
        const rows = this.db.prepare('SELECT * FROM requirements WHERE parent_id = ? ORDER BY card_no ASC')
            .all(parentId) as unknown as RequirementRow[];
        return rows.map(rowToRequirement);
    }

    /** 核验阶段编辑卡片标题 */
    updateCardTitle(id: string, title: string): void {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE requirements SET title = ?, updated_at = ? WHERE id = ?')
            .run(title, now, id);
    }

    /** 核验阶段调整卡片执行顺序 */
    updateCardOrder(id: string, cardNo: number): void {
        const now = new Date().toISOString();
        this.db.prepare('UPDATE requirements SET card_no = ?, updated_at = ? WHERE id = ?')
            .run(cardNo, now, id);
    }

    /** 核验阶段删除一张尚未执行的卡片 */
    deleteCard(id: string): boolean {
        return this.delete(id);
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
