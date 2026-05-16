import type { DatabaseSync } from 'node:sqlite';
import type { Logger } from '../types.js';

export class AutoCurator {
    constructor(private db: DatabaseSync, private logger: Logger) {}

    async runDailyCuration(): Promise<{
        featured: string[];
        needsImprovement: string[];
        archived: string[];
    }> {
        this.logger.info('[skill-factory:auto-curator] Running daily curation');

        const featured: string[] = [];
        const needsImprovement: string[] = [];
        const archived: string[] = [];

        const skills = this.db.prepare(
            `SELECT sc.skill_name, sc.curation_status, sc.created_at,
                    COALESCE(usage.cnt, 0) as usage_30d
             FROM skill_catalog sc
             LEFT JOIN (
                 SELECT tool_name, COUNT(*) as cnt
                 FROM (
                     SELECT json_extract(detail, '$.skill') as tool_name
                     FROM admin_audit_log
                     WHERE created_at >= datetime('now', '-30 days')
                       AND action = 'skill_call'
                 ) t
                 WHERE tool_name IS NOT NULL
                 GROUP BY tool_name
             ) usage ON usage.tool_name = sc.skill_name
             WHERE sc.state = 'active'`
        ).all() as unknown[] as Array<{
            skill_name: string;
            curation_status: string;
            created_at: string;
            usage_30d: number;
        }>;

        const now = new Date().toISOString();

        for (const skill of skills) {
            const ageMs = Date.now() - new Date(skill.created_at).getTime();
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            const usage = skill.usage_30d;

            let newStatus = skill.curation_status;

            if (usage > 100) {
                newStatus = 'featured';
                featured.push(skill.skill_name);
            } else if (usage < 5 && ageDays > 30) {
                if (skill.curation_status === 'needs_improvement' && ageDays > 37) {
                    // Already marked needs_improvement for >7 days → archive
                    newStatus = 'archived';
                    archived.push(skill.skill_name);
                    this.db.prepare(
                        `UPDATE skill_catalog SET state = 'deprecated', curation_status = 'archived', updated_at = ? WHERE skill_name = ?`
                    ).run(now, skill.skill_name);
                } else if (skill.curation_status !== 'needs_improvement') {
                    newStatus = 'needs_improvement';
                    needsImprovement.push(skill.skill_name);
                } else {
                    needsImprovement.push(skill.skill_name);
                }
            }

            if (newStatus !== skill.curation_status) {
                this.db.prepare(
                    `UPDATE skill_catalog SET curation_status = ?, usage_30d = ?, updated_at = ? WHERE skill_name = ?`
                ).run(newStatus, usage, now, skill.skill_name);
            } else {
                this.db.prepare(
                    `UPDATE skill_catalog SET usage_30d = ?, updated_at = ? WHERE skill_name = ?`
                ).run(usage, now, skill.skill_name);
            }
        }

        this.logger.info(
            `[skill-factory:auto-curator] Curation complete: featured=${featured.length}, needs_improvement=${needsImprovement.length}, archived=${archived.length}`
        );

        return { featured, needsImprovement, archived };
    }
}
