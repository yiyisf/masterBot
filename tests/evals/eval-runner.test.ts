/**
 * Eval Runner Tests — Vitest 测试
 *
 * 1. 验证所有 case 结构合法性（id / prompt 或 turns / tags）
 * 2. 统计用例总数，确保各套件 ≥ 30 条，golden-set ≥ 50 条
 * 3. 验证 id 全局唯一
 * 4. 验证断言引擎 (runAssertions) 的正确性
 */

import { describe, it, expect } from 'vitest';
import {
    loadCapabilitySuites,
    loadGoldenSuite,
    validateCaseStructure,
    runAssertions,
    type SingleTurnCase,
    type MultiTurnCase,
    type EvalCase,
} from './run-evals.js';

// ─── Helper ───────────────────────────────────────────────────────────────────

function isMultiTurn(c: EvalCase): c is MultiTurnCase {
    return Array.isArray((c as MultiTurnCase).turns);
}

// ─── Load Suites ──────────────────────────────────────────────────────────────

const capabilitySuites = loadCapabilitySuites();
const goldenSuite = loadGoldenSuite();
const allSuites = [...capabilitySuites, goldenSuite];
const allCases = allSuites.flatMap(s => s.cases);

// ─── Suite 用例数量断言 ────────────────────────────────────────────────────────

describe('Eval Suite — 用例数量', () => {
    it('basic-conversation 应 ≥ 30 条', () => {
        const suite = capabilitySuites.find(s => s.name === 'basic-conversation');
        expect(suite, 'basic-conversation suite not found').toBeDefined();
        expect(suite!.cases.length).toBeGreaterThanOrEqual(30);
    });

    it('tool-calling 应 ≥ 30 条', () => {
        const suite = capabilitySuites.find(s => s.name === 'tool-calling');
        expect(suite, 'tool-calling suite not found').toBeDefined();
        expect(suite!.cases.length).toBeGreaterThanOrEqual(30);
    });

    it('multi-turn-context 应 ≥ 30 条', () => {
        const suite = capabilitySuites.find(s => s.name === 'multi-turn-context');
        expect(suite, 'multi-turn-context suite not found').toBeDefined();
        expect(suite!.cases.length).toBeGreaterThanOrEqual(30);
    });

    it('permission-and-safety 应 ≥ 30 条', () => {
        const suite = capabilitySuites.find(s => s.name === 'permission-and-safety');
        expect(suite, 'permission-and-safety suite not found').toBeDefined();
        expect(suite!.cases.length).toBeGreaterThanOrEqual(30);
    });

    it('golden-set 应 ≥ 50 条', () => {
        expect(goldenSuite.cases.length).toBeGreaterThanOrEqual(50);
    });

    it('全部套件总用例数 ≥ 170', () => {
        expect(allCases.length).toBeGreaterThanOrEqual(170);
    });
});

// ─── id 全局唯一性 ────────────────────────────────────────────────────────────

describe('Eval Suite — id 唯一性', () => {
    it('所有 case 的 id 在全局范围内唯一', () => {
        const ids = allCases.map(c => c.id);
        const seen = new Set<string>();
        const duplicates: string[] = [];
        for (const id of ids) {
            if (seen.has(id)) duplicates.push(id);
            seen.add(id);
        }
        expect(duplicates, `Duplicate IDs: ${duplicates.join(', ')}`).toHaveLength(0);
    });
});

// ─── 结构合法性 ───────────────────────────────────────────────────────────────

describe('Eval Suite — Case 结构合法性', () => {
    for (const suite of allSuites) {
        describe(`Suite: ${suite.name}`, () => {
            for (const c of suite.cases) {
                it(`Case "${c.id}" 结构合法`, () => {
                    const errors = validateCaseStructure(c, suite.name);
                    expect(errors, errors.join('; ')).toHaveLength(0);
                });
            }
        });
    }
});

// ─── 断言引擎单元测试 ────────────────────────────────────────────────────────

describe('runAssertions — 断言引擎', () => {
    function makeCase(overrides: Partial<SingleTurnCase> = {}): SingleTurnCase {
        return {
            id: 'test-case',
            prompt: 'test prompt',
            tags: ['test'],
            ...overrides,
        };
    }

    it('expect_not_empty: 非空通过', () => {
        const errors = runAssertions(
            makeCase({ expect_not_empty: true }),
            { response: 'hello' }
        );
        expect(errors).toHaveLength(0);
    });

    it('expect_not_empty: 空字符串失败', () => {
        const errors = runAssertions(
            makeCase({ expect_not_empty: true }),
            { response: '  ' }
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/expect_not_empty/);
    });

    it('expect_contains: 包含通过', () => {
        const errors = runAssertions(
            makeCase({ expect_contains: ['hello', 'world'] }),
            { response: 'hello world test' }
        );
        expect(errors).toHaveLength(0);
    });

    it('expect_contains: 缺少关键词失败', () => {
        const errors = runAssertions(
            makeCase({ expect_contains: ['hello', 'missing'] }),
            { response: 'hello world' }
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/missing/);
    });

    it('expect_not_contains: 不包含通过', () => {
        const errors = runAssertions(
            makeCase({ expect_not_contains: ['forbidden'] }),
            { response: 'safe response' }
        );
        expect(errors).toHaveLength(0);
    });

    it('expect_not_contains: 包含禁止词失败', () => {
        const errors = runAssertions(
            makeCase({ expect_not_contains: ['forbidden'] }),
            { response: 'this is forbidden content' }
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/expect_not_contains/);
    });

    it('expect_contains_any: 至少一个匹配通过', () => {
        const errors = runAssertions(
            makeCase({ expect_contains_any: ['foo', 'bar', 'baz'] }),
            { response: 'I found bar here' }
        );
        expect(errors).toHaveLength(0);
    });

    it('expect_contains_any: 都不匹配失败', () => {
        const errors = runAssertions(
            makeCase({ expect_contains_any: ['foo', 'bar'] }),
            { response: 'nothing relevant' }
        );
        expect(errors).toHaveLength(1);
    });

    it('expect_min_length: 满足最小长度通过', () => {
        const errors = runAssertions(
            makeCase({ expect_min_length: 5 }),
            { response: 'hello world' }
        );
        expect(errors).toHaveLength(0);
    });

    it('expect_min_length: 不满足最小长度失败', () => {
        const errors = runAssertions(
            makeCase({ expect_min_length: 100 }),
            { response: 'short' }
        );
        expect(errors).toHaveLength(1);
    });

    it('expect_json: 有效 JSON 通过', () => {
        const errors = runAssertions(
            makeCase({ expect_json: true }),
            { response: '{"name": "Alice", "age": 30}' }
        );
        expect(errors).toHaveLength(0);
    });

    it('expect_json: 无效 JSON 失败', () => {
        const errors = runAssertions(
            makeCase({ expect_json: true }),
            { response: 'not json at all' }
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/expect_json/);
    });

    it('expect_json_fields: 字段存在通过', () => {
        const errors = runAssertions(
            makeCase({ expect_json: true, expect_json_fields: ['name', 'age'] }),
            { response: '{"name": "Alice", "age": 30}' }
        );
        expect(errors).toHaveLength(0);
    });

    it('expect_json_fields: 字段缺失失败', () => {
        const errors = runAssertions(
            makeCase({ expect_json: true, expect_json_fields: ['name', 'missing_field'] }),
            { response: '{"name": "Alice"}' }
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/missing_field/);
    });

    it('expect_json: 支持 markdown 代码块包裹的 JSON', () => {
        const errors = runAssertions(
            makeCase({ expect_json: true, expect_json_fields: ['status'] }),
            { response: '```json\n{"status": "ok"}\n```' }
        );
        expect(errors).toHaveLength(0);
    });

    it('expect_tool_called: 工具已调用通过', () => {
        const errors = runAssertions(
            makeCase({ expect_tool_called: 'shell' }),
            { response: 'done', toolsCalled: ['shell'] }
        );
        expect(errors).toHaveLength(0);
    });

    it('expect_tool_called: 工具未调用失败', () => {
        const errors = runAssertions(
            makeCase({ expect_tool_called: 'shell' }),
            { response: 'done', toolsCalled: [] }
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/expect_tool_called/);
    });

    it('expect_tool_called_any: 至少一个工具匹配通过', () => {
        const errors = runAssertions(
            makeCase({ expect_tool_called_any: ['shell', 'file_manager'] }),
            { response: 'done', toolsCalled: ['file_manager'] }
        );
        expect(errors).toHaveLength(0);
    });

    it('expect_tool_called_any: 都未调用失败', () => {
        const errors = runAssertions(
            makeCase({ expect_tool_called_any: ['shell', 'file_manager'] }),
            { response: 'done', toolsCalled: [] }
        );
        expect(errors).toHaveLength(1);
    });
});

// ─── Tags 完整性检查 ──────────────────────────────────────────────────────────

describe('Eval Suite — Tags 完整性', () => {
    it('所有 case 都至少有一个 tag', () => {
        const noTags = allCases.filter(c => !c.tags || c.tags.length === 0);
        const ids = noTags.map(c => c.id);
        expect(ids, `Cases without tags: ${ids.join(', ')}`).toHaveLength(0);
    });

    it('golden-set 的所有 case 都包含 golden tag', () => {
        const missing = goldenSuite.cases.filter(c => !c.tags.includes('golden'));
        const ids = missing.map(c => c.id);
        expect(ids, `Golden cases missing 'golden' tag: ${ids.join(', ')}`).toHaveLength(0);
    });
});

// ─── Multi-turn 结构检查 ─────────────────────────────────────────────────────

describe('Eval Suite — Multi-turn 结构', () => {
    const multiTurnCases = allCases.filter(isMultiTurn);

    it('multi-turn-context 应包含 multi-turn case', () => {
        const suite = capabilitySuites.find(s => s.name === 'multi-turn-context');
        expect(suite).toBeDefined();
        const mtCases = suite!.cases.filter(isMultiTurn);
        expect(mtCases.length).toBeGreaterThan(0);
    });

    it('所有 multi-turn case 至少有 2 个 turn', () => {
        const invalid = multiTurnCases.filter(c => c.turns.length < 2);
        const ids = invalid.map(c => c.id);
        expect(ids, `Multi-turn cases with < 2 turns: ${ids.join(', ')}`).toHaveLength(0);
    });

    it('所有 multi-turn turn 都有 user 字段', () => {
        const invalid: string[] = [];
        for (const c of multiTurnCases) {
            for (const turn of c.turns) {
                if (!turn.user || typeof turn.user !== 'string') {
                    invalid.push(c.id);
                    break;
                }
            }
        }
        expect(invalid, `Multi-turn cases with invalid turn user: ${invalid.join(', ')}`).toHaveLength(0);
    });
});
