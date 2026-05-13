#!/usr/bin/env tsx
/**
 * Phase 6.5 数据迁移：将旧 memories 表和 knowledge_nodes 表迁移到 Phase 6 四层记忆架构。
 *
 * 迁移规则：
 *   旧 memories → L2 episodic_memories（tenant_id 从 metadata 读取，默认 'default'）
 *   旧 knowledge_nodes → L3 semantic_facts（status = 'approved'，保留原始语义）
 *
 * 用法：
 *   npx tsx scripts/migrate-memory-to-phase6.ts [--dry-run] [--default-tenant <id>]
 *
 * 选项：
 *   --dry-run            只打印将会执行的操作，不写入数据库
 *   --default-tenant     未携带 tenant_id 的记录使用的租户（默认 'default'）
 *   --db-path            SQLite 数据库路径（默认 data/cmaster.db）
 */

import { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import { join } from 'path';
import { existsSync } from 'fs';

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DEFAULT_TENANT = (() => {
    const idx = args.indexOf('--default-tenant');
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : 'default';
})();
const DB_PATH = (() => {
    const idx = args.indexOf('--db-path');
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : join(process.cwd(), 'data', 'cmaster.db');
})();

const TTL_90D = 90 * 24 * 60 * 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toUnixMs(val: string | number | null | undefined): number {
    if (!val) return Date.now();
    if (typeof val === 'number') return val > 1e12 ? val : val * 1000;
    const n = Date.parse(val);
    return isNaN(n) ? Date.now() : n;
}

function log(msg: string) { console.log(msg); }
function warn(msg: string) { console.warn(`[WARN] ${msg}`); }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    if (!existsSync(DB_PATH)) {
        console.error(`Database not found: ${DB_PATH}`);
        process.exit(1);
    }

    log(`\n${'─'.repeat(60)}`);
    log(`Phase 6.5 Memory Migration${DRY_RUN ? ' [DRY RUN]' : ''}`);
    log(`DB: ${DB_PATH}`);
    log(`Default tenant: ${DEFAULT_TENANT}`);
    log('─'.repeat(60) + '\n');

    const db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");

    // Ensure target tables exist (Phase 6 migration should have created them)
    const hasEpisodic = (db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='episodic_memories'"
    ).get() as any)?.name === 'episodic_memories';

    const hasSemantic = (db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='semantic_facts'"
    ).get() as any)?.name === 'semantic_facts';

    if (!hasEpisodic || !hasSemantic) {
        console.error('Target tables episodic_memories / semantic_facts not found.');
        console.error('Run the server once to trigger Phase 6 DB migration, then re-run this script.');
        process.exit(1);
    }

    // ── Part 1: memories → episodic_memories ────────────────────────────────

    const hasMemories = (db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'"
    ).get() as any)?.name === 'memories';

    let migratedEpisodic = 0;
    let skippedEpisodic = 0;

    if (!hasMemories) {
        log('[Part 1] Table "memories" not found — skipping.');
    } else {
        log('[Part 1] Migrating memories → episodic_memories...');

        const rows = db.prepare(
            'SELECT id, category, topic, content, metadata, session_id, created_at FROM memories ORDER BY created_at ASC'
        ).all() as Array<{
            id: string;
            category: string;
            topic: string;
            content: string;
            metadata: string | null;
            session_id: string | null;
            created_at: string | number;
        }>;

        log(`  Found ${rows.length} records in memories table.`);

        for (const row of rows) {
            // Parse metadata to extract tenantId
            let meta: Record<string, any> = {};
            try { meta = JSON.parse(row.metadata ?? '{}'); } catch { /* ignore */ }

            const tenantId: string = meta.tenantId ?? DEFAULT_TENANT;
            const sessionId: string = row.session_id ?? 'migrated';
            const createdAt = toUnixMs(row.created_at);
            const expiresAt = createdAt + TTL_90D;

            // Check if already migrated (idempotent: match on original content + tenantId)
            const existing = db.prepare(
                'SELECT id FROM episodic_memories WHERE tenant_id = ? AND content = ? AND session_id = ?'
            ).get(tenantId, row.content, sessionId);

            if (existing) {
                skippedEpisodic++;
                continue;
            }

            if (!DRY_RUN) {
                db.prepare(`
                    INSERT INTO episodic_memories
                        (id, tenant_id, session_id, content, category, topic, expires_at, created_at, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    nanoid(),
                    tenantId,
                    sessionId,
                    row.content,
                    row.category ?? 'user',
                    row.topic ?? '',
                    expiresAt,
                    createdAt,
                    JSON.stringify(meta),
                );

                // Sync to FTS if available
                try {
                    const lastId = db.prepare(
                        'SELECT id FROM episodic_memories WHERE tenant_id = ? AND content = ? ORDER BY created_at DESC LIMIT 1'
                    ).get(tenantId, row.content) as { id: string } | undefined;
                    if (lastId) {
                        db.prepare('INSERT OR IGNORE INTO episodic_fts(id, tenant_id, content) VALUES (?, ?, ?)')
                            .run(lastId.id, tenantId, row.content);
                    }
                } catch { /* FTS unavailable */ }
            }

            migratedEpisodic++;

            if (migratedEpisodic <= 5) {
                log(`  [+] "${row.content.slice(0, 60)}…" → tenant:${tenantId}`);
            } else if (migratedEpisodic === 6) {
                log(`  ... (remaining rows omitted from log)`);
            }
        }

        log(`  Done. Migrated: ${migratedEpisodic}, Skipped (already exist): ${skippedEpisodic}\n`);
    }

    // ── Part 2: knowledge_nodes → semantic_facts ──────────────────────────────

    const hasKnowledge = (db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_nodes'"
    ).get() as any)?.name === 'knowledge_nodes';

    let migratedSemantic = 0;
    let skippedSemantic = 0;

    if (!hasKnowledge) {
        log('[Part 2] Table "knowledge_nodes" not found — skipping.');
    } else {
        log('[Part 2] Migrating knowledge_nodes → semantic_facts...');

        const nodes = db.prepare(
            'SELECT id, type, title, content, metadata, created_at FROM knowledge_nodes ORDER BY created_at ASC'
        ).all() as Array<{
            id: string;
            type: string;
            title: string;
            content: string;
            metadata: string | null;
            created_at: string | number;
        }>;

        log(`  Found ${nodes.length} records in knowledge_nodes table.`);

        for (const node of nodes) {
            let meta: Record<string, any> = {};
            try { meta = JSON.parse(node.metadata ?? '{}'); } catch { /* ignore */ }

            const tenantId: string = meta.tenantId ?? DEFAULT_TENANT;
            const subject = node.title;
            const predicate = `是一个 ${node.type}`;
            // Truncate long content to 1000 chars as object value
            const object = node.content.slice(0, 1000);
            const createdAt = toUnixMs(node.created_at);

            // Idempotent check: same tenant + subject + predicate
            const existing = db.prepare(
                "SELECT id FROM semantic_facts WHERE tenant_id = ? AND subject = ? AND predicate = ? AND status = 'approved'"
            ).get(tenantId, subject, predicate);

            if (existing) {
                skippedSemantic++;
                continue;
            }

            if (!DRY_RUN) {
                db.prepare(`
                    INSERT INTO semantic_facts
                        (id, tenant_id, subject, predicate, object, confidence, status, source_session_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)
                `).run(
                    nanoid(),
                    tenantId,
                    subject,
                    predicate,
                    object,
                    0.9,
                    'migrated',
                    createdAt,
                );
            }

            migratedSemantic++;

            if (migratedSemantic <= 5) {
                log(`  [+] "${subject}" ${predicate} → tenant:${tenantId}`);
            } else if (migratedSemantic === 6) {
                log(`  ... (remaining rows omitted from log)`);
            }
        }

        log(`  Done. Migrated: ${migratedSemantic}, Skipped (already exist): ${skippedSemantic}\n`);
    }

    // ── Summary ───────────────────────────────────────────────────────────────

    log('─'.repeat(60));
    log('Migration Summary');
    log('─'.repeat(60));
    log(`  memories → episodic_memories : ${migratedEpisodic} migrated, ${skippedEpisodic} skipped`);
    log(`  knowledge_nodes → semantic_facts : ${migratedSemantic} migrated, ${skippedSemantic} skipped`);
    if (DRY_RUN) {
        log('\n  [DRY RUN] No data was written. Re-run without --dry-run to apply.');
    }
    log('─'.repeat(60) + '\n');

    db.close();
}

main().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
