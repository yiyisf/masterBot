/**
 * 确定性验证器执行引擎（U15）
 *
 * Loop Engineering 的核心原则：验证优先用确定性手段（测试/编译/API 状态比对），
 * LLM 评分仅兜底。本模块对 ToolResult 应用 assert DSL，给出可机判的通过/失败。
 */

import type { ToolResult, Logger } from '../../types.js';
import type { VerifierSpec } from './loop-spec.js';

export interface VerifierResult {
    name: string;
    passed: boolean;
    detail: string;
}

export interface VerifierReport {
    allPassed: boolean;
    results: VerifierResult[];
    /** 失败签名（失败验证器名称排序拼接）——用于停滞检测 */
    failureSignature: string;
}

/**
 * 对单个工具结果应用断言
 */
export function evaluateAssert(assert: string | undefined, result: ToolResult): { passed: boolean; detail: string } {
    const spec = (assert ?? 'ok').trim();
    const value = result.kind === 'ok' ? result.value : '';

    // ok / exit_code == 0：工具执行成功即通过（shell 类工具非零退出会返回 error）
    if (spec === 'ok' || /^exit_code\s*==\s*0$/.test(spec)) {
        return result.kind === 'ok'
            ? { passed: true, detail: 'tool succeeded' }
            : { passed: false, detail: `tool failed: ${result.message}` };
    }

    // 内容类断言：工具失败一律不通过
    if (result.kind === 'error') {
        return { passed: false, detail: `tool failed: ${result.message}` };
    }

    if (spec.startsWith('contains:')) {
        const needle = spec.slice('contains:'.length).trim();
        return value.includes(needle)
            ? { passed: true, detail: `output contains "${needle}"` }
            : { passed: false, detail: `output does not contain "${needle}"` };
    }

    if (spec.startsWith('not_contains:')) {
        const needle = spec.slice('not_contains:'.length).trim();
        return !value.includes(needle)
            ? { passed: true, detail: `output does not contain "${needle}"` }
            : { passed: false, detail: `output unexpectedly contains "${needle}"` };
    }

    if (spec.startsWith('matches:')) {
        const pattern = spec.slice('matches:'.length).trim();
        try {
            const re = new RegExp(pattern, 'm');
            return re.test(value)
                ? { passed: true, detail: `output matches /${pattern}/` }
                : { passed: false, detail: `output does not match /${pattern}/` };
        } catch {
            return { passed: false, detail: `invalid regex: ${pattern}` };
        }
    }

    if (spec.startsWith('equals:')) {
        const expected = spec.slice('equals:'.length).trim();
        return value.trim() === expected
            ? { passed: true, detail: 'output equals expected value' }
            : { passed: false, detail: `output (${value.trim().slice(0, 80)}) != expected (${expected.slice(0, 80)})` };
    }

    return { passed: false, detail: `unknown assert DSL: ${spec}` };
}

/**
 * 顺序执行全部验证器（确定性验证应快速且无副作用，顺序执行便于诊断）
 */
export async function runVerifiers(
    verifiers: VerifierSpec[],
    executeTool: (tool: string, params: Record<string, unknown>) => Promise<ToolResult>,
    logger?: Logger
): Promise<VerifierReport> {
    const results: VerifierResult[] = [];

    for (const v of verifiers) {
        const name = v.name ?? `${v.tool} [${v.assert ?? 'ok'}]`;
        let result: ToolResult;
        try {
            result = await executeTool(v.tool, v.params ?? {});
        } catch (err) {
            result = { kind: 'error', message: (err as Error).message, retryable: false };
        }

        const { passed, detail } = evaluateAssert(v.assert, result);
        results.push({ name, passed, detail });
        logger?.debug?.(`[verifier] ${name}: ${passed ? 'PASS' : 'FAIL'} — ${detail}`);
    }

    const failed = results.filter(r => !r.passed);
    return {
        allPassed: failed.length === 0,
        results,
        failureSignature: failed.map(r => r.name).sort().join('|'),
    };
}
