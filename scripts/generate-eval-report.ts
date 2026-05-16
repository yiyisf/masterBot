/**
 * Eval Report Generator
 *
 * 读取 tests/evals/capability/*.yaml 和 tests/evals/golden/golden-set.yaml，
 * 统计总用例数、各套件用例数，输出文本摘要到 stdout，
 * 并生成 eval-results/report.json。
 *
 * 运行: npx tsx scripts/generate-eval-report.ts
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CAPABILITY_DIR = join(ROOT, 'tests', 'evals', 'capability');
const GOLDEN_DIR = join(ROOT, 'tests', 'evals', 'golden');
const OUTPUT_DIR = join(ROOT, 'eval-results');

// ─── Types ────────────────────────────────────────────────────────────────────

interface EvalCase {
    id: string;
    prompt?: string;
    turns?: unknown[];
    tags?: string[];
}

interface SuiteReport {
    name: string;
    file: string;
    total: number;
    tagDistribution: Record<string, number>;
    multiTurnCount: number;
    hasGoldenTag?: boolean;
}

interface Report {
    generatedAt: string;
    suites: SuiteReport[];
    total: number;
    totalCapability: number;
    totalGolden: number;
    allIds: string[];
    uniqueIds: number;
    duplicateIds: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadYaml(filePath: string): { cases: EvalCase[] } {
    const content = readFileSync(filePath, 'utf-8');
    return parse(content) as { cases: EvalCase[] };
}

function countTags(cases: EvalCase[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const c of cases) {
        for (const tag of (c.tags ?? [])) {
            counts[tag] = (counts[tag] ?? 0) + 1;
        }
    }
    return counts;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
    // Load capability suites
    const capabilityFiles = readdirSync(CAPABILITY_DIR)
        .filter(f => f.endsWith('.yaml'))
        .sort();

    const suitesReports: SuiteReport[] = [];
    let totalCapability = 0;
    const allIds: string[] = [];

    for (const file of capabilityFiles) {
        const filePath = join(CAPABILITY_DIR, file);
        const data = loadYaml(filePath);
        const cases = data.cases ?? [];
        const name = file.replace('.yaml', '');

        for (const c of cases) allIds.push(c.id);

        const report: SuiteReport = {
            name,
            file,
            total: cases.length,
            tagDistribution: countTags(cases),
            multiTurnCount: cases.filter(c => Array.isArray(c.turns)).length,
        };
        suitesReports.push(report);
        totalCapability += cases.length;
    }

    // Load golden suite
    const goldenPath = join(GOLDEN_DIR, 'golden-set.yaml');
    const goldenData = loadYaml(goldenPath);
    const goldenCases = goldenData.cases ?? [];
    for (const c of goldenCases) allIds.push(c.id);

    const goldenReport: SuiteReport = {
        name: 'golden-set',
        file: 'golden/golden-set.yaml',
        total: goldenCases.length,
        tagDistribution: countTags(goldenCases),
        multiTurnCount: goldenCases.filter(c => Array.isArray(c.turns)).length,
        hasGoldenTag: goldenCases.every(c => c.tags?.includes('golden')),
    };
    suitesReports.push(goldenReport);
    const totalGolden = goldenCases.length;

    // Detect duplicate IDs
    const seen = new Set<string>();
    const duplicateIds: string[] = [];
    for (const id of allIds) {
        if (seen.has(id)) duplicateIds.push(id);
        seen.add(id);
    }

    const total = totalCapability + totalGolden;
    const now = new Date().toISOString();

    // ─── Console Output ───────────────────────────────────────────────────────

    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║          CMaster Eval Report — Phase 9              ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`Generated at: ${now}`);
    console.log('');
    console.log('── Capability Suites ──────────────────────────────────');
    console.log('');

    for (const r of suitesReports.filter(s => s.name !== 'golden-set')) {
        const status = r.total >= 30 ? '✓' : '✗';
        console.log(`  ${status} ${r.name.padEnd(30)} ${String(r.total).padStart(3)} cases  (multi-turn: ${r.multiTurnCount})`);
        if (r.total < 30) {
            console.log(`    WARNING: expected ≥ 30, got ${r.total}`);
        }
    }

    console.log('');
    console.log('── Golden Set ─────────────────────────────────────────');
    console.log('');
    const goldenR = suitesReports.find(s => s.name === 'golden-set')!;
    const goldenStatus = goldenR.total >= 50 ? '✓' : '✗';
    console.log(`  ${goldenStatus} golden-set                         ${String(goldenR.total).padStart(3)} cases`);
    if (goldenR.total < 50) {
        console.log(`    WARNING: expected ≥ 50, got ${goldenR.total}`);
    }
    if (goldenR.hasGoldenTag === false) {
        console.log('    WARNING: some golden cases are missing the "golden" tag');
    }

    console.log('');
    console.log('── Summary ────────────────────────────────────────────');
    console.log('');
    console.log(`  Total cases:       ${total}`);
    console.log(`  Capability cases:  ${totalCapability}`);
    console.log(`  Golden cases:      ${totalGolden}`);
    console.log(`  Unique IDs:        ${seen.size}`);
    if (duplicateIds.length > 0) {
        console.log(`  DUPLICATE IDs:     ${duplicateIds.join(', ')}`);
    } else {
        console.log('  Duplicate IDs:     none');
    }
    console.log('');

    // ─── Write JSON Report ────────────────────────────────────────────────────

    const report: Report = {
        generatedAt: now,
        suites: suitesReports,
        total,
        totalCapability,
        totalGolden,
        allIds,
        uniqueIds: seen.size,
        duplicateIds,
    };

    mkdirSync(OUTPUT_DIR, { recursive: true });
    const reportPath = join(OUTPUT_DIR, 'report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`Report saved: ${reportPath}`);
    console.log('');

    // Exit with error code if critical issues found
    const hasErrors =
        suitesReports.filter(s => s.name !== 'golden-set').some(s => s.total < 30) ||
        goldenR.total < 50 ||
        duplicateIds.length > 0;

    if (hasErrors) {
        console.error('ERROR: eval report has issues, see above.');
        process.exit(1);
    }
}

main();
