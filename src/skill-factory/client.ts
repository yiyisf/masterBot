import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import type { LLMAdapter, Logger } from '../types.js';
import type { SkillFactoryJob, SkillSpec, ValidationResult, SecurityScanResult, SandboxTestResult, LLMJudgeResult } from './types.js';
import { SpecBuilder, type ConversationContext } from './spec-builder.js';
import { SkillSynthesizer } from './synthesizer.js';
import { StaticValidator } from './validators/static.js';
import { SecurityScanner } from './validators/security.js';
import { LocalSandboxTester } from './sandbox/local-tester.js';
import { LLMJudge } from './validators/llm-judge.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SKILLS_LOCAL_DIR = join(__dirname, '../../skills/local');

function jobFromRow(row: any): SkillFactoryJob {
    return {
        id: row.id,
        skillName: row.skill_name ?? '',
        state: row.state,
        spec: row.spec_json ? JSON.parse(row.spec_json) : undefined,
        generatedFiles: row.generated_files_json ? JSON.parse(row.generated_files_json) : undefined,
        validationResult: row.validation_json ? JSON.parse(row.validation_json) : undefined,
        securityResult: row.security_json ? JSON.parse(row.security_json) : undefined,
        sandboxResult: row.sandbox_json ? JSON.parse(row.sandbox_json) : undefined,
        judgeResult: row.judge_json ? JSON.parse(row.judge_json) : undefined,
        installPath: row.install_path ?? undefined,
        reviewId: row.review_id ?? undefined,
        createdBy: row.created_by ?? undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        error: row.error ?? undefined,
    };
}

export class LocalSkillFactory {
    private specBuilder: SpecBuilder;
    private synthesizer: SkillSynthesizer;
    private staticValidator: StaticValidator;
    private securityScanner: SecurityScanner;
    private sandboxTester: LocalSandboxTester;
    private llmJudge: LLMJudge;

    constructor(
        private llm: LLMAdapter,
        private logger: Logger,
        private db: DatabaseSync
    ) {
        this.specBuilder = new SpecBuilder(llm, logger);
        this.synthesizer = new SkillSynthesizer(llm, logger);
        this.staticValidator = new StaticValidator();
        this.securityScanner = new SecurityScanner();
        this.sandboxTester = new LocalSandboxTester();
        this.llmJudge = new LLMJudge(llm, logger);
    }

    async createJob(intent: string, createdBy?: string): Promise<SkillFactoryJob> {
        const id = randomUUID();
        const now = new Date().toISOString();
        this.db.prepare(
            `INSERT INTO skill_factory_jobs (id, skill_name, state, created_by, created_at, updated_at)
             VALUES (?, ?, 'drafting', ?, ?, ?)`
        ).run(id, intent.substring(0, 100), createdBy ?? null, now, now);

        const row = this.db.prepare('SELECT * FROM skill_factory_jobs WHERE id = ?').get(id);
        return jobFromRow(row);
    }

    async runStage1(jobId: string, context?: ConversationContext): Promise<SkillSpec> {
        this.updateState(jobId, 'drafting');
        try {
            const job = this.requireJob(jobId);
            const intent = job.skillName;
            const spec = await this.specBuilder.build(intent, context);
            this.db.prepare(
                `UPDATE skill_factory_jobs SET spec_json = ?, skill_name = ?, updated_at = ? WHERE id = ?`
            ).run(JSON.stringify(spec), spec.name, new Date().toISOString(), jobId);
            return spec;
        } catch (err) {
            this.setError(jobId, err);
            throw err;
        }
    }

    async runStage2(jobId: string): Promise<{ skillMd: string; indexTs: string; testTs: string }> {
        this.updateState(jobId, 'synthesizing');
        try {
            const job = this.requireJob(jobId);
            if (!job.spec) throw new Error('Stage 1 must complete before Stage 2');
            const files = await this.synthesizer.synthesize(job.spec);
            this.db.prepare(
                `UPDATE skill_factory_jobs SET generated_files_json = ?, updated_at = ? WHERE id = ?`
            ).run(JSON.stringify(files), new Date().toISOString(), jobId);
            return files;
        } catch (err) {
            this.setError(jobId, err);
            throw err;
        }
    }

    async runStage3(jobId: string): Promise<{ static: ValidationResult; security: SecurityScanResult }> {
        try {
            const job = this.requireJob(jobId);
            if (!job.generatedFiles || !job.spec) throw new Error('Stage 2 must complete before Stage 3');

            const staticResult = this.staticValidator.validate(job.generatedFiles, job.spec);
            const securityResult = await this.securityScanner.scan(job.generatedFiles.indexTs);

            this.db.prepare(
                `UPDATE skill_factory_jobs SET validation_json = ?, security_json = ?, updated_at = ? WHERE id = ?`
            ).run(JSON.stringify(staticResult), JSON.stringify(securityResult), new Date().toISOString(), jobId);

            return { static: staticResult, security: securityResult };
        } catch (err) {
            this.setError(jobId, err);
            throw err;
        }
    }

    async runStage4(jobId: string): Promise<{ sandbox: SandboxTestResult; judge: LLMJudgeResult }> {
        try {
            const job = this.requireJob(jobId);
            if (!job.generatedFiles || !job.spec) throw new Error('Stage 2 must complete before Stage 4');

            const sandboxResult = await this.sandboxTester.runTests(
                job.generatedFiles.indexTs,
                job.spec.testCases,
                job.spec
            );

            const judgeResult = await this.llmJudge.evaluate(
                job.spec,
                { skillMd: job.generatedFiles.skillMd, indexTs: job.generatedFiles.indexTs },
                sandboxResult
            );

            this.db.prepare(
                `UPDATE skill_factory_jobs SET sandbox_json = ?, judge_json = ?, state = ?, updated_at = ? WHERE id = ?`
            ).run(JSON.stringify(sandboxResult), JSON.stringify(judgeResult), 'local-tested', new Date().toISOString(), jobId);

            return { sandbox: sandboxResult, judge: judgeResult };
        } catch (err) {
            this.setError(jobId, err);
            throw err;
        }
    }

    async installAsDraft(jobId: string): Promise<string> {
        const job = this.requireJob(jobId);
        if (!job.generatedFiles || !job.spec) throw new Error('Must complete Stages 1-4 before installing');

        const skillDir = join(SKILLS_LOCAL_DIR, job.spec.name);
        if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });

        writeFileSync(join(skillDir, 'SKILL.md'), job.generatedFiles.skillMd, 'utf-8');
        writeFileSync(join(skillDir, 'index.ts'), job.generatedFiles.indexTs, 'utf-8');
        if (job.generatedFiles.testTs) {
            writeFileSync(join(skillDir, 'unit.test.ts'), job.generatedFiles.testTs, 'utf-8');
        }

        this.db.prepare(
            `UPDATE skill_factory_jobs SET install_path = ?, updated_at = ? WHERE id = ?`
        ).run(skillDir, new Date().toISOString(), jobId);

        this.logger.info(`[skill-factory:client] Installed draft at ${skillDir}`);
        return skillDir;
    }

    async submitForReview(jobId: string): Promise<string> {
        const job = this.requireJob(jobId);
        if (!job.spec || !job.generatedFiles) throw new Error('Must complete Stages 1-4 before submitting');

        const installPath = job.installPath ?? join(SKILLS_LOCAL_DIR, job.spec.name);
        const reviewId = randomUUID();
        const now = new Date().toISOString();

        // Write to skill_reviews for enterprise review queue
        this.db.prepare(
            `INSERT OR REPLACE INTO skill_reviews (id, skill_name, skill_path, status, created_at, updated_at)
             VALUES (?, ?, ?, 'pending', ?, ?)`
        ).run(reviewId, job.spec.name, installPath, now, now);

        this.db.prepare(
            `UPDATE skill_factory_jobs SET state = 'pending-review', review_id = ?, updated_at = ? WHERE id = ?`
        ).run(reviewId, now, jobId);

        this.logger.info(`[skill-factory:client] Submitted job ${jobId} for review, reviewId=${reviewId}`);
        return reviewId;
    }

    getJob(jobId: string): SkillFactoryJob | null {
        const row = this.db.prepare('SELECT * FROM skill_factory_jobs WHERE id = ?').get(jobId);
        return row ? jobFromRow(row) : null;
    }

    listJobs(createdBy?: string): SkillFactoryJob[] {
        let rows: unknown[];
        if (createdBy) {
            rows = this.db.prepare('SELECT * FROM skill_factory_jobs WHERE created_by = ? ORDER BY created_at DESC').all(createdBy) as unknown[];
        } else {
            rows = this.db.prepare('SELECT * FROM skill_factory_jobs ORDER BY created_at DESC').all() as unknown[];
        }
        return (rows as any[]).map(jobFromRow);
    }

    private requireJob(jobId: string): SkillFactoryJob {
        const job = this.getJob(jobId);
        if (!job) throw new Error(`Job not found: ${jobId}`);
        return job;
    }

    private updateState(jobId: string, state: string): void {
        this.db.prepare(
            `UPDATE skill_factory_jobs SET state = ?, error = NULL, updated_at = ? WHERE id = ?`
        ).run(state, new Date().toISOString(), jobId);
    }

    private setError(jobId: string, err: unknown): void {
        const msg = err instanceof Error ? err.message : String(err);
        this.db.prepare(
            `UPDATE skill_factory_jobs SET error = ?, updated_at = ? WHERE id = ?`
        ).run(msg, new Date().toISOString(), jobId);
    }
}
