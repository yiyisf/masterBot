import { nanoid } from 'nanoid';
import { db } from './database.js';
import type { RequirementPhase } from './requirement-repository.js';

/** 一道待回答问题的结构，claude-code ask_user 与非交互引擎标记块解析出的问题共用同一形状 */
export interface PendingQuestion {
    id: string;
    question: string;
    context?: string;
    options?: Array<{ label: string; description?: string }>;
    recommended?: number;
    multiSelect?: boolean;
}

export type PendingQuestionSetStatus = 'pending' | 'answered' | 'cancelled';

export interface PendingQuestionSet {
    id: string;
    requirementId: string;
    runId: string;
    sessionId: string;
    phase: RequirementPhase;
    questions: PendingQuestion[];
    status: PendingQuestionSetStatus;
    answers: string[] | null;
    createdAt: string;
    answeredAt: string | null;
}

interface PendingQuestionSetRow {
    id: string;
    requirement_id: string;
    run_id: string;
    session_id: string;
    phase: string;
    questions: string;
    status: string;
    answers: string | null;
    created_at: string;
    answered_at: string | null;
}

function rowToSet(row: PendingQuestionSetRow): PendingQuestionSet {
    return {
        id: row.id,
        requirementId: row.requirement_id,
        runId: row.run_id,
        sessionId: row.session_id,
        phase: row.phase as RequirementPhase,
        questions: JSON.parse(row.questions),
        status: row.status as PendingQuestionSetStatus,
        answers: row.answers ? JSON.parse(row.answers) : null,
        createdAt: row.created_at,
        answeredAt: row.answered_at,
    };
}

export interface CreatePendingQuestionSetInput {
    requirementId: string;
    runId: string;
    sessionId: string;
    phase: RequirementPhase;
    questions: PendingQuestion[];
}

/**
 * pending_questions 唯一真源（spec: 统一「待回答问题」协议）：无论底层引擎是否支持
 * 编程式中断，问题都落这张表；页面与回答 API 只读写这张表，不读 session_events。
 */
export class PendingQuestionsRepository {
    private db: typeof db;

    constructor(database?: typeof db) {
        this.db = database ?? db;
    }

    create(input: CreatePendingQuestionSetInput): PendingQuestionSet {
        const id = nanoid();
        const now = new Date().toISOString();
        this.db.prepare(
            `INSERT INTO pending_questions (id, requirement_id, run_id, session_id, phase, questions, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
        ).run(
            id,
            input.requirementId,
            input.runId,
            input.sessionId,
            input.phase,
            JSON.stringify(input.questions),
            now
        );
        return this.getById(id)!;
    }

    getById(id: string): PendingQuestionSet | null {
        const row = this.db.prepare('SELECT * FROM pending_questions WHERE id = ?').get(id) as PendingQuestionSetRow | undefined;
        return row ? rowToSet(row) : null;
    }

    /** 一个需求当前（最新）的待回答问题集，供页面/回答 API 定位 */
    getLatestByRequirement(requirementId: string): PendingQuestionSet | null {
        // created_at（ISO 字符串）在同一毫秒内建多组问题时会打平，rowid 兜底保证取到最新一条
        const row = this.db.prepare(
            'SELECT * FROM pending_questions WHERE requirement_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
        ).get(requirementId) as PendingQuestionSetRow | undefined;
        return row ? rowToSet(row) : null;
    }

    /** 跨需求查询处于 pending 的问题集（如启动扫描、看板未答题角标） */
    listPending(): PendingQuestionSet[] {
        const rows = this.db.prepare("SELECT * FROM pending_questions WHERE status = 'pending' ORDER BY created_at")
            .all() as unknown as PendingQuestionSetRow[];
        return rows.map(rowToSet);
    }

    markAnswered(id: string, answers: string[]): PendingQuestionSet | null {
        const now = new Date().toISOString();
        this.db.prepare(
            "UPDATE pending_questions SET status = 'answered', answers = ?, answered_at = ? WHERE id = ?"
        ).run(JSON.stringify(answers), now, id);
        return this.getById(id);
    }

    markCancelled(id: string): void {
        const now = new Date().toISOString();
        this.db.prepare(
            "UPDATE pending_questions SET status = 'cancelled', answered_at = ? WHERE id = ?"
        ).run(now, id);
    }
}

export const pendingQuestionsRepository = new PendingQuestionsRepository();
