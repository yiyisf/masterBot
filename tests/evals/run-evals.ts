/**
 * Eval Runner — Tier 1 评测套件运行器
 *
 * 读取 tests/evals/capability/*.yaml（排除 golden/ 子目录）以及
 * tests/evals/golden/golden-set.yaml，对每条 case 验证结构合法性，
 * 并在有真实响应文本时执行断言（expect_contains / expect_not_contains 等）。
 *
 * 在 CI 中，当没有真实 LLM 调用时，仅做结构合法性验证（suite level 统计）。
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPABILITY_DIR = join(__dirname, 'capability');
const GOLDEN_DIR = join(__dirname, 'golden');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SingleTurnCase {
    id: string;
    prompt: string;
    tags: string[];
    expect_not_empty?: boolean;
    expect_contains?: string[];
    expect_not_contains?: string[];
    expect_contains_any?: string[];
    expect_min_length?: number;
    expect_json?: boolean;
    expect_json_fields?: string[];
    expect_tool_called?: string;
    expect_tool_called_any?: string[];
}

export interface MultiTurnCase {
    id: string;
    turns: Array<{
        user: string;
        expect_not_empty?: boolean;
        expect_contains?: string[];
        expect_not_contains?: string[];
        expect_contains_any?: string[];
        expect_min_length?: number;
    }>;
    tags: string[];
}

export type EvalCase = SingleTurnCase | MultiTurnCase;

export interface EvalSuite {
    name: string;
    cases: EvalCase[];
}

export interface EvalStats {
    suite: string;
    total: number;
    passed: number;
    failed: number;
    errors: string[];
}

// ─── Assertion Engine ─────────────────────────────────────────────────────────

export interface AssertionContext {
    response: string;
    toolsCalled?: string[];
}

export function runAssertions(c: SingleTurnCase, ctx: AssertionContext): string[] {
    const errors: string[] = [];
    const { response, toolsCalled = [] } = ctx;

    if (c.expect_not_empty && response.trim().length === 0) {
        errors.push('expect_not_empty: response is empty');
    }

    if (c.expect_min_length && response.length < c.expect_min_length) {
        errors.push(`expect_min_length: ${response.length} < ${c.expect_min_length}`);
    }

    if (c.expect_contains) {
        for (const kw of c.expect_contains) {
            if (!response.includes(kw)) {
                errors.push(`expect_contains: missing "${kw}"`);
            }
        }
    }

    if (c.expect_not_contains) {
        for (const kw of c.expect_not_contains) {
            if (response.includes(kw)) {
                errors.push(`expect_not_contains: found forbidden "${kw}"`);
            }
        }
    }

    if (c.expect_contains_any) {
        const found = c.expect_contains_any.some(kw => response.includes(kw));
        if (!found) {
            errors.push(`expect_contains_any: none of [${c.expect_contains_any.join(', ')}] found`);
        }
    }

    if (c.expect_json) {
        try {
            const trimmed = response.trim();
            // extract JSON block if wrapped in markdown
            const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/) ??
                              trimmed.match(/([\[{][\s\S]*[\]}])/);
            const jsonStr = jsonMatch ? jsonMatch[1] : trimmed;
            const parsed = JSON.parse(jsonStr);

            if (c.expect_json_fields) {
                for (const field of c.expect_json_fields) {
                    if (Array.isArray(parsed)) {
                        // array of objects — check first element
                        if (parsed.length === 0 || !(field in parsed[0])) {
                            errors.push(`expect_json_fields: missing field "${field}" in first item`);
                        }
                    } else if (!(field in parsed)) {
                        errors.push(`expect_json_fields: missing field "${field}"`);
                    }
                }
            }
        } catch {
            errors.push('expect_json: response is not valid JSON');
        }
    }

    if (c.expect_tool_called) {
        if (!toolsCalled.includes(c.expect_tool_called)) {
            errors.push(`expect_tool_called: "${c.expect_tool_called}" was not called (called: [${toolsCalled.join(', ')}])`);
        }
    }

    if (c.expect_tool_called_any) {
        const found = c.expect_tool_called_any.some(t => toolsCalled.includes(t));
        if (!found) {
            errors.push(`expect_tool_called_any: none of [${c.expect_tool_called_any.join(', ')}] were called`);
        }
    }

    return errors;
}

// ─── Structure Validation ─────────────────────────────────────────────────────

export function validateCaseStructure(c: unknown, suiteName: string): string[] {
    const errors: string[] = [];
    const obj = c as Record<string, unknown>;

    if (!obj['id'] || typeof obj['id'] !== 'string') {
        errors.push(`[${suiteName}] case missing 'id' field`);
    }

    const hasPrompt = typeof obj['prompt'] === 'string';
    const hasTurns = Array.isArray(obj['turns']) && (obj['turns'] as unknown[]).length > 0;

    if (!hasPrompt && !hasTurns) {
        errors.push(`[${suiteName}] case "${obj['id']}" missing 'prompt' or 'turns'`);
    }

    if (!Array.isArray(obj['tags']) || (obj['tags'] as unknown[]).length === 0) {
        errors.push(`[${suiteName}] case "${obj['id']}" missing 'tags'`);
    }

    return errors;
}

// ─── Suite Loader ─────────────────────────────────────────────────────────────

export function loadSuite(filePath: string): EvalSuite {
    const content = readFileSync(filePath, 'utf-8');
    const data = parse(content) as { cases: EvalCase[] };
    const name = filePath.split('/').pop()?.replace('.yaml', '') ?? filePath;
    return { name, cases: data.cases ?? [] };
}

export function loadCapabilitySuites(): EvalSuite[] {
    const files = readdirSync(CAPABILITY_DIR)
        .filter(f => f.endsWith('.yaml'))
        .sort();
    return files.map(f => loadSuite(join(CAPABILITY_DIR, f)));
}

export function loadGoldenSuite(): EvalSuite {
    return loadSuite(join(GOLDEN_DIR, 'golden-set.yaml'));
}

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * 验证套件结构合法性（不需要 LLM 调用）。
 * 返回每个套件的统计信息。
 */
export function validateSuiteStructure(suite: EvalSuite): EvalStats {
    const errors: string[] = [];
    let passed = 0;
    let failed = 0;

    for (const c of suite.cases) {
        const cErrors = validateCaseStructure(c, suite.name);
        if (cErrors.length === 0) {
            passed++;
        } else {
            failed++;
            errors.push(...cErrors);
        }
    }

    return {
        suite: suite.name,
        total: suite.cases.length,
        passed,
        failed,
        errors,
    };
}

/**
 * 运行所有套件的结构验证并打印摘要。
 */
export async function runAll(): Promise<{ suites: EvalStats[]; total: number; passed: number; failed: number }> {
    const suites = [...loadCapabilitySuites(), loadGoldenSuite()];
    const results: EvalStats[] = [];

    for (const suite of suites) {
        const stats = validateSuiteStructure(suite);
        results.push(stats);

        const status = stats.failed === 0 ? 'PASS' : 'FAIL';
        console.log(`[${status}] ${stats.suite}: ${stats.passed}/${stats.total} valid`);
        for (const err of stats.errors) {
            console.error(`  ERROR: ${err}`);
        }
    }

    const total = results.reduce((s, r) => s + r.total, 0);
    const passed = results.reduce((s, r) => s + r.passed, 0);
    const failed = results.reduce((s, r) => s + r.failed, 0);

    console.log(`\nTotal: ${total} cases | Passed: ${passed} | Failed: ${failed}`);

    return { suites: results, total, passed, failed };
}
