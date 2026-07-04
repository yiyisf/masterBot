/**
 * 离线评测断言引擎（U3）
 *
 * 支持的断言类型：
 * - keyword:        输出包含至少一个给定关键词（values 任意匹配）
 * - no_keyword:     输出不包含任何给定关键词
 * - tool_called:    轨迹中至少调用过一次指定工具
 * - tool_not_called: 轨迹中未调用指定工具
 * - max_iterations: 完成任务的实际迭代次数 <= max
 * - format:         输出符合特定格式（contains_json / is_json）
 */

export interface AssertionSpec {
    type: 'keyword' | 'no_keyword' | 'tool_called' | 'tool_not_called' | 'max_iterations' | 'format';
    /** keyword / no_keyword 使用 */
    values?: string[];
    /** tool_called / tool_not_called 使用 */
    tool?: string;
    /** max_iterations 使用 */
    max?: number;
    /** format 使用 */
    format?: 'contains_json' | 'is_json';
}

export interface AssertionResult {
    type: string;
    passed: boolean;
    message: string;
}

export interface EvalTrajectory {
    /** 最终输出文本 */
    output: string;
    /** 每次迭代调用的工具名称列表 */
    toolsCalled: string[];
    /** 实际迭代次数 */
    iterations: number;
}

/**
 * 运行一组断言，返回每条的结果
 */
export function runAssertions(
    trajectory: EvalTrajectory,
    assertions: AssertionSpec[]
): AssertionResult[] {
    return assertions.map(spec => evaluate(trajectory, spec));
}

function evaluate(t: EvalTrajectory, spec: AssertionSpec): AssertionResult {
    const output = t.output.toLowerCase();

    switch (spec.type) {
        case 'keyword': {
            const values = spec.values ?? [];
            const hit = values.find(v => output.includes(v.toLowerCase()));
            return {
                type: spec.type,
                passed: !!hit,
                message: hit
                    ? `Found keyword "${hit}"`
                    : `None of [${values.join(', ')}] found in output`,
            };
        }

        case 'no_keyword': {
            const values = spec.values ?? [];
            const hit = values.find(v => output.includes(v.toLowerCase()));
            return {
                type: spec.type,
                passed: !hit,
                message: hit
                    ? `Forbidden keyword "${hit}" found in output`
                    : `No forbidden keywords found`,
            };
        }

        case 'tool_called': {
            const tool = spec.tool ?? '';
            const called = t.toolsCalled.some(
                tc => tc === tool || tc.startsWith(tool + '.') || tc.endsWith('.' + tool)
            );
            return {
                type: spec.type,
                passed: called,
                message: called
                    ? `Tool "${tool}" was called`
                    : `Tool "${tool}" was NOT called. Called: [${t.toolsCalled.join(', ')}]`,
            };
        }

        case 'tool_not_called': {
            const tool = spec.tool ?? '';
            const called = t.toolsCalled.some(
                tc => tc === tool || tc.startsWith(tool + '.') || tc.endsWith('.' + tool)
            );
            return {
                type: spec.type,
                passed: !called,
                message: called
                    ? `Tool "${tool}" was called but should not have been`
                    : `Tool "${tool}" correctly not called`,
            };
        }

        case 'max_iterations': {
            const max = spec.max ?? Infinity;
            const ok = t.iterations <= max;
            return {
                type: spec.type,
                passed: ok,
                message: ok
                    ? `Completed in ${t.iterations} iterations (≤ ${max})`
                    : `Too many iterations: ${t.iterations} > ${max}`,
            };
        }

        case 'format': {
            const fmt = spec.format;
            if (fmt === 'contains_json') {
                const jsonMatch = t.output.match(/\{[\s\S]*\}/);
                const passed = jsonMatch !== null;
                return {
                    type: spec.type,
                    passed,
                    message: passed ? 'Output contains JSON object' : 'No JSON object found in output',
                };
            }
            if (fmt === 'is_json') {
                let passed = false;
                try { JSON.parse(t.output.trim()); passed = true; } catch { /* noop */ }
                return {
                    type: spec.type,
                    passed,
                    message: passed ? 'Output is valid JSON' : 'Output is not valid JSON',
                };
            }
            return { type: spec.type, passed: false, message: `Unknown format: ${fmt}` };
        }

        default:
            return { type: (spec as AssertionSpec).type, passed: false, message: 'Unknown assertion type' };
    }
}
