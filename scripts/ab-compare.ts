#!/usr/bin/env tsx
/**
 * Task 9: A/B 对比脚本
 * 同一测试集分别跑 ClaudeManagedAgent 和 LegacySelfHostedAgent，输出对比报告。
 *
 * 使用方式:
 *   ANTHROPIC_API_KEY=xxx npx tsx scripts/ab-compare.ts
 *   ANTHROPIC_API_KEY=xxx npx tsx scripts/ab-compare.ts --cases 5 --output report.json
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

interface TestCase {
    id: string;
    prompt: string;
    tags?: string[];
}

interface RunResult {
    caseId: string;
    prompt: string;
    response: string;
    durationMs: number;
    success: boolean;
    error?: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
}

interface ComparisonReport {
    generatedAt: string;
    totalCases: number;
    legacyResults: RunResult[];
    sdkResults: RunResult[];
    summary: {
        legacy: { passRate: number; avgDurationMs: number; avgOutputLen: number };
        sdk: { passRate: number; avgDurationMs: number; avgOutputLen: number };
    };
}

// 内置测试用例（从 eval YAML 摘取的代表性问题）
const DEFAULT_CASES: TestCase[] = [
    { id: 'math-1', prompt: '2+2 等于多少？只回答数字。', tags: ['math'] },
    { id: 'greeting', prompt: '你好！用一句话介绍你自己。', tags: ['basic'] },
    { id: 'code-q', prompt: '用一句话解释 TypeScript 的 interface 和 class 的区别。', tags: ['code'] },
    { id: 'list', prompt: '列出 3 种常见的编程语言，用列表格式。', tags: ['list'] },
    { id: 'reasoning', prompt: '如果 A > B，B > C，那么 A 和 C 的大小关系是什么？', tags: ['reasoning'] },
];

async function callAgentApi(
    prompt: string,
    forceLegacy: boolean,
    serverUrl = 'http://localhost:3000',
): Promise<{ response: string; durationMs: number; success: boolean; error?: string }> {
    const start = Date.now();
    try {
        const res = await fetch(`${serverUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: prompt,
                sessionId: `ab-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                userId: 'ab-compare-script',
                // forceLegacy 通过 header 传递（Phase 3 新增）
                ...(forceLegacy ? { forceLegacy: true } : {}),
            }),
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }

        const data = await res.json() as { answer?: string; error?: string };
        return {
            response: data.answer ?? '',
            durationMs: Date.now() - start,
            success: !data.error,
            error: data.error,
        };
    } catch (err) {
        return {
            response: '',
            durationMs: Date.now() - start,
            success: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

async function runBatch(
    cases: TestCase[],
    forceLegacy: boolean,
    serverUrl: string,
): Promise<RunResult[]> {
    const results: RunResult[] = [];
    for (const tc of cases) {
        console.log(`  Running [${forceLegacy ? 'Legacy' : 'SDK  '}] ${tc.id}...`);
        const r = await callAgentApi(tc.prompt, forceLegacy, serverUrl);
        results.push({
            caseId: tc.id,
            prompt: tc.prompt,
            response: r.response,
            durationMs: r.durationMs,
            success: r.success,
            error: r.error,
        });
        // 避免 rate limit
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return results;
}

function calcSummary(results: RunResult[]) {
    const passed = results.filter(r => r.success && r.response.length > 0);
    return {
        passRate: passed.length / results.length,
        avgDurationMs: results.reduce((s, r) => s + r.durationMs, 0) / results.length,
        avgOutputLen: passed.reduce((s, r) => s + r.response.length, 0) / (passed.length || 1),
    };
}

async function main() {
    const args = process.argv.slice(2);
    const outputFile = args.find(a => a.startsWith('--output='))?.slice(9) ?? 'ab-report.json';
    const maxCases = parseInt(args.find(a => a.startsWith('--cases='))?.slice(8) ?? '5', 10);
    const serverUrl = args.find(a => a.startsWith('--server='))?.slice(9) ?? 'http://localhost:3000';

    const cases = DEFAULT_CASES.slice(0, maxCases);

    console.log(`\n🔬 masterBot A/B 对比测试`);
    console.log(`   Server: ${serverUrl}`);
    console.log(`   Cases: ${cases.length}`);
    console.log(`\n--- Legacy Agent ---`);
    const legacyResults = await runBatch(cases, true, serverUrl);

    console.log(`\n--- Claude Managed Agent (SDK) ---`);
    const sdkResults = await runBatch(cases, false, serverUrl);

    const report: ComparisonReport = {
        generatedAt: new Date().toISOString(),
        totalCases: cases.length,
        legacyResults,
        sdkResults,
        summary: {
            legacy: calcSummary(legacyResults),
            sdk: calcSummary(sdkResults),
        },
    };

    writeFileSync(outputFile, JSON.stringify(report, null, 2));

    console.log(`\n📊 结果对比`);
    console.log(`${'指标'.padEnd(25)} ${'Legacy'.padEnd(15)} ${'SDK'}`);
    console.log(`${'-'.repeat(55)}`);
    console.log(`${'通过率'.padEnd(25)} ${(report.summary.legacy.passRate * 100).toFixed(0).padEnd(14)}% ${(report.summary.sdk.passRate * 100).toFixed(0)}%`);
    console.log(`${'平均响应时间(ms)'.padEnd(25)} ${report.summary.legacy.avgDurationMs.toFixed(0).padEnd(15)} ${report.summary.sdk.avgDurationMs.toFixed(0)}`);
    console.log(`${'平均输出长度(字)'.padEnd(25)} ${report.summary.legacy.avgOutputLen.toFixed(0).padEnd(15)} ${report.summary.sdk.avgOutputLen.toFixed(0)}`);
    console.log(`\n✅ 详细报告已写入: ${outputFile}`);
}

main().catch(err => {
    console.error('❌ A/B 测试失败:', err);
    process.exit(1);
});
