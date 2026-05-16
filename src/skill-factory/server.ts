import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { LLMAdapter, Logger } from '../types.js';
import type { SkillFactoryJob } from './types.js';
import { SecurityScanner } from './validators/security.js';
import { LocalSandboxTester } from './sandbox/local-tester.js';
import { LLMJudge } from './validators/llm-judge.js';
import { SkillPublisher } from './publisher.js';

export class EnterpriseSkillFactory {
    private securityScanner: SecurityScanner;
    private sandboxTester: LocalSandboxTester;
    private llmJudge: LLMJudge;
    private publisher: SkillPublisher;

    constructor(
        private llm: LLMAdapter,
        private logger: Logger,
        private db: DatabaseSync
    ) {
        this.securityScanner = new SecurityScanner();
        this.sandboxTester = new LocalSandboxTester();
        this.llmJudge = new LLMJudge(llm, logger);
        this.publisher = new SkillPublisher(logger, db);
    }

    async receiveSubmission(jobId: string, jobData: SkillFactoryJob): Promise<string> {
        this.logger.info(`[skill-factory:server] Receiving submission jobId=${jobId}`);

        if (!jobData.generatedFiles || !jobData.spec) {
            throw new Error('Submission missing generatedFiles or spec');
        }

        // Re-run Stage 3b + 4a + 4b server-side
        const securityResult = await this.securityScanner.scan(jobData.generatedFiles.indexTs);
        const sandboxResult = await this.sandboxTester.runTests(
            jobData.generatedFiles.indexTs,
            jobData.spec.testCases,
            jobData.spec
        );
        const judgeResult = await this.llmJudge.evaluate(
            jobData.spec,
            { skillMd: jobData.generatedFiles.skillMd, indexTs: jobData.generatedFiles.indexTs },
            sandboxResult
        );

        const now = new Date().toISOString();
        this.db.prepare(
            `UPDATE skill_factory_jobs
             SET security_json = ?, sandbox_json = ?, judge_json = ?, state = 'pending-review', updated_at = ?
             WHERE id = ?`
        ).run(
            JSON.stringify(securityResult),
            JSON.stringify(sandboxResult),
            JSON.stringify(judgeResult),
            now,
            jobId
        );

        return this.queueForReview(jobId);
    }

    async queueForReview(jobId: string): Promise<string> {
        const row = this.db.prepare('SELECT * FROM skill_factory_jobs WHERE id = ?').get(jobId) as any;
        if (!row) throw new Error(`Job not found: ${jobId}`);

        const spec = row.spec_json ? JSON.parse(row.spec_json) : null;
        const skillName = spec?.name ?? row.skill_name ?? jobId;
        const skillPath = row.install_path ?? `skills/installed/${skillName}`;

        const reviewId = row.review_id ?? randomUUID();
        const now = new Date().toISOString();

        this.db.prepare(
            `INSERT OR REPLACE INTO skill_reviews (id, skill_name, skill_path, status, created_at, updated_at)
             VALUES (?, ?, ?, 'pending', ?, ?)`
        ).run(reviewId, skillName, skillPath, now, now);

        this.db.prepare(
            `UPDATE skill_factory_jobs SET review_id = ?, state = 'pending-review', updated_at = ? WHERE id = ?`
        ).run(reviewId, now, jobId);

        this.logger.info(`[skill-factory:server] Queued for review: reviewId=${reviewId}`);
        return reviewId;
    }

    async approveAndPublish(reviewId: string, reviewerNotes?: string): Promise<void> {
        this.logger.info(`[skill-factory:server] Approving review: ${reviewId}`);

        const now = new Date().toISOString();
        this.db.prepare(
            `UPDATE skill_reviews SET status = 'approved', review_notes = ?, updated_at = ? WHERE id = ?`
        ).run(reviewerNotes ?? null, now, reviewId);

        const jobRow = this.db.prepare('SELECT * FROM skill_factory_jobs WHERE review_id = ?').get(reviewId) as any;
        if (!jobRow) {
            this.logger.warn(`[skill-factory:server] No job found for reviewId=${reviewId}`);
            return;
        }

        this.db.prepare(
            `UPDATE skill_factory_jobs SET state = 'approved', updated_at = ? WHERE review_id = ?`
        ).run(now, reviewId);

        const generatedFiles = jobRow.generated_files_json ? JSON.parse(jobRow.generated_files_json) : null;
        const spec = jobRow.spec_json ? JSON.parse(jobRow.spec_json) : null;

        if (!generatedFiles || !spec) {
            this.logger.warn(`[skill-factory:server] Cannot publish: missing files or spec for review ${reviewId}`);
            return;
        }

        const job: SkillFactoryJob = {
            id: jobRow.id,
            skillName: jobRow.skill_name ?? spec.name,
            state: 'approved',
            spec,
            generatedFiles,
            reviewId,
            createdAt: new Date(jobRow.created_at),
            updatedAt: new Date(),
        };

        await this.publisher.publish(job);

        this.db.prepare(
            `UPDATE skill_factory_jobs SET state = 'active', updated_at = ? WHERE id = ?`
        ).run(now, jobRow.id);

        this.logger.info(`[skill-factory:server] Published skill: ${spec.name}`);
    }

    async reject(reviewId: string, reason: string): Promise<void> {
        const now = new Date().toISOString();
        this.db.prepare(
            `UPDATE skill_reviews SET status = 'rejected', review_notes = ?, updated_at = ? WHERE id = ?`
        ).run(reason, now, reviewId);

        this.db.prepare(
            `UPDATE skill_factory_jobs SET state = 'drafting', error = ?, updated_at = ? WHERE review_id = ?`
        ).run(`Rejected: ${reason}`, now, reviewId);

        this.logger.info(`[skill-factory:server] Rejected review: ${reviewId}, reason: ${reason}`);
    }
}
