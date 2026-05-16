import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Logger } from '../types.js';
import type { SkillFactoryJob } from './types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SKILLS_INSTALLED_DIR = join(__dirname, '../../skills/installed');

export class SkillPublisher {
    constructor(
        private logger: Logger,
        private db: DatabaseSync,
        private skillsDir?: string
    ) {}

    async publish(job: SkillFactoryJob): Promise<{ publishPath: string; catalogEntry: object }> {
        if (!job.spec || !job.generatedFiles) {
            throw new Error('Cannot publish: missing spec or generated files');
        }

        const targetDir = this.skillsDir
            ? join(this.skillsDir, job.spec.name)
            : join(SKILLS_INSTALLED_DIR, job.spec.name);

        if (!existsSync(targetDir)) {
            mkdirSync(targetDir, { recursive: true });
        }

        writeFileSync(join(targetDir, 'SKILL.md'), job.generatedFiles.skillMd, 'utf-8');
        writeFileSync(join(targetDir, 'index.ts'), job.generatedFiles.indexTs, 'utf-8');
        if (job.generatedFiles.testTs) {
            writeFileSync(join(targetDir, 'unit.test.ts'), job.generatedFiles.testTs, 'utf-8');
        }

        // Update skill_reviews status
        if (job.reviewId) {
            this.db.prepare(
                `UPDATE skill_reviews SET status = 'approved', skill_path = ?, updated_at = ? WHERE id = ?`
            ).run(targetDir, new Date().toISOString(), job.reviewId);
        }

        // Upsert skill_catalog
        const catalogId = randomUUID();
        const now = new Date().toISOString();
        const versionMatch = job.generatedFiles.skillMd.match(/^version:\s*(.+)$/m);
        const version = versionMatch ? versionMatch[1].trim() : '1.0.0';
        const authorMatch = job.generatedFiles.skillMd.match(/^author:\s*(.+)$/m);
        const author = authorMatch ? authorMatch[1].trim() : 'SkillFactory-2.0';

        this.db.prepare(
            `INSERT OR REPLACE INTO skill_catalog
             (id, skill_name, skill_path, description, category, author, version, state, curation_status, created_at, updated_at)
             VALUES (
               COALESCE((SELECT id FROM skill_catalog WHERE skill_name = ?), ?),
               ?, ?, ?, ?, ?, ?, 'active', 'normal', ?, ?
             )`
        ).run(
            job.spec.name,
            catalogId,
            job.spec.name,
            targetDir,
            job.spec.description,
            job.spec.category,
            author,
            version,
            now,
            now
        );

        // Record in admin_audit_log
        this.db.prepare(
            `INSERT INTO admin_audit_log (id, admin_id, action, target, detail, created_at)
             VALUES (?, 'skill-factory', 'skill_publish', ?, ?, ?)`
        ).run(randomUUID(), job.spec.name, `Published from job ${job.id}`, now);

        const catalogEntry = {
            skillName: job.spec.name,
            skillPath: targetDir,
            description: job.spec.description,
            category: job.spec.category,
            version,
        };

        this.logger.info(`[skill-factory:publisher] Published skill "${job.spec.name}" to ${targetDir}`);
        return { publishPath: targetDir, catalogEntry };
    }
}
