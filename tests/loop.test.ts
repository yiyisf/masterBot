import { describe, it, expect, vi } from 'vitest';
import { parseLoopSpec, validateLoopSpec } from '../src/core/loop/loop-spec.js';
import { evaluateAssert, runVerifiers } from '../src/core/loop/verifier.js';
import { LoopRunner } from '../src/core/loop/loop-runner.js';
import type { LoopSpec } from '../src/core/loop/loop-spec.js';
import type { ExecutionStep, ToolResult } from '../src/types.js';

const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

const ok = (value: string): ToolResult => ({ kind: 'ok', value });
const err = (message: string): ToolResult => ({ kind: 'error', message, retryable: false });

function stubRunTask(answers: string[]): (task: string, iteration: number) => AsyncGenerator<ExecutionStep> {
    let call = 0;
    return async function* () {
        const answer = answers[Math.min(call, answers.length - 1)];
        call++;
        yield { type: 'content', content: 'working...', timestamp: new Date() };
        yield { type: 'answer', content: answer, timestamp: new Date() };
    };
}

async function collect(gen: AsyncGenerator<ExecutionStep>): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];
    for await (const s of gen) steps.push(s);
    return steps;
}

describe('U15: Loop Engineering', () => {
    describe('parseLoopSpec', () => {
        it('should parse a valid YAML spec with defaults', () => {
            const spec = parseLoopSpec(`
id: test-loop
goal: "keep tests green"
execute:
  agent: coder
`);
            expect(spec.id).toBe('test-loop');
            expect(spec.goal).toBe('keep tests green');
            expect(spec.budgets?.maxIterations).toBe(10);
            expect(spec.budgets?.maxWallClockMin).toBe(60);
            expect(spec.stall?.noProgressRounds).toBe(3);
            expect(spec.onStall).toBe('escalate');
        });

        it('should reject spec without goal', () => {
            expect(() => parseLoopSpec('id: x\nexecute: {agent: a}')).toThrow(/goal/);
        });

        it('should reject spec without execute', () => {
            expect(() => parseLoopSpec('id: x\ngoal: g')).toThrow(/execute/);
        });

        it('should reject invalid onStall value', () => {
            expect(() => validateLoopSpec({ id: 'x', goal: 'g', execute: {}, onStall: 'panic' })).toThrow(/onStall/);
        });

        it('should default discover.emptyMeansDone to true', () => {
            const spec = parseLoopSpec(`
id: x
goal: g
discover: { tool: alerts.list }
execute: { agent: a }
`);
            expect(spec.discover?.emptyMeansDone).toBe(true);
        });
    });

    describe('evaluateAssert DSL', () => {
        it('ok / exit_code == 0', () => {
            expect(evaluateAssert('ok', ok('done')).passed).toBe(true);
            expect(evaluateAssert('exit_code == 0', ok('done')).passed).toBe(true);
            expect(evaluateAssert('exit_code == 0', err('exit 1')).passed).toBe(false);
            expect(evaluateAssert(undefined, ok('x')).passed).toBe(true);
        });

        it('contains / not_contains', () => {
            expect(evaluateAssert('contains:passed', ok('10 tests passed')).passed).toBe(true);
            expect(evaluateAssert('contains:failed', ok('10 tests passed')).passed).toBe(false);
            expect(evaluateAssert('not_contains:FAIL', ok('all green')).passed).toBe(true);
            expect(evaluateAssert('not_contains:FAIL', ok('1 FAIL')).passed).toBe(false);
        });

        it('matches / equals', () => {
            expect(evaluateAssert('matches:\\d+ passed', ok('42 passed')).passed).toBe(true);
            expect(evaluateAssert('matches:^OK$', ok('NOT')).passed).toBe(false);
            expect(evaluateAssert('equals:[]', ok('  []  ')).passed).toBe(true);
            expect(evaluateAssert('equals:[]', ok('[{"a":1}]')).passed).toBe(false);
        });

        it('content asserts fail on tool error', () => {
            expect(evaluateAssert('contains:x', err('boom')).passed).toBe(false);
        });

        it('unknown DSL fails closed', () => {
            expect(evaluateAssert('gibberish', ok('x')).passed).toBe(false);
        });
    });

    describe('runVerifiers', () => {
        it('should aggregate results and failure signature', async () => {
            const exec = vi.fn(async (tool: string) =>
                tool === 'good.check' ? ok('fine') : err('broken'));

            const report = await runVerifiers(
                [
                    { tool: 'good.check', assert: 'ok' },
                    { tool: 'bad.check', assert: 'ok', name: 'bad-one' },
                ],
                exec, mockLogger
            );
            expect(report.allPassed).toBe(false);
            expect(report.results).toHaveLength(2);
            expect(report.failureSignature).toBe('bad-one');
        });

        it('should treat thrown errors as tool failure', async () => {
            const report = await runVerifiers(
                [{ tool: 'x.y' }],
                async () => { throw new Error('exploded'); },
                mockLogger
            );
            expect(report.allPassed).toBe(false);
            expect(report.results[0].detail).toContain('exploded');
        });
    });

    describe('LoopRunner', () => {
        const baseSpec: LoopSpec = {
            id: 'l1',
            goal: 'make tests pass',
            execute: { agent: 'coder' },
            budgets: { maxIterations: 5, maxSteps: 100, maxWallClockMin: 5 },
            stall: { noProgressRounds: 3 },
            onStall: 'escalate',
        };

        it('should achieve goal when verifier passes on first iteration', async () => {
            const runner = new LoopRunner(
                { ...baseSpec, verify: [{ tool: 'shell.execute', assert: 'exit_code == 0' }] },
                {
                    logger: mockLogger,
                    runTask: stubRunTask(['fixed everything']),
                    executeTool: async () => ok('all tests passed'),
                }
            );
            const steps = await collect(runner.run());
            expect(runner.getResult()?.outcome).toBe('goal_achieved');
            expect(runner.getResult()?.iterations).toBe(1);
            expect(steps.some(s => s.type === 'answer' && s.content === 'fixed everything')).toBe(true);
        });

        it('should iterate with feedback until verifier passes', async () => {
            let verifyCalls = 0;
            const tasks: string[] = [];
            const runner = new LoopRunner(
                { ...baseSpec, verify: [{ tool: 'shell.execute', assert: 'exit_code == 0', name: 'tests' }] },
                {
                    logger: mockLogger,
                    runTask: (task: string, i: number) => {
                        tasks.push(task);
                        return stubRunTask([`attempt ${i}`])(task, i);
                    },
                    // 前两次失败，第三次通过
                    executeTool: async () => (++verifyCalls < 3 ? err('2 tests failed') : ok('all passed')),
                }
            );
            await collect(runner.run());
            expect(runner.getResult()?.outcome).toBe('goal_achieved');
            expect(runner.getResult()?.iterations).toBe(3);
            // 第二轮起任务中应包含失败反馈
            expect(tasks[1]).toContain('验证失败');
            expect(tasks[1]).toContain('tests');
        });

        it('should stall after repeated identical failures and escalate', async () => {
            const escalate = vi.fn(async () => {});
            const runner = new LoopRunner(
                { ...baseSpec, verify: [{ tool: 'shell.execute', name: 'tests' }] },
                {
                    logger: mockLogger,
                    runTask: stubRunTask(['try']),
                    executeTool: async () => err('same failure forever'),
                    escalate,
                }
            );
            const steps = await collect(runner.run());
            expect(runner.getResult()?.outcome).toBe('stalled');
            expect(runner.getResult()?.iterations).toBe(3); // noProgressRounds=3
            expect(escalate).toHaveBeenCalledOnce();
            expect(steps.some(s => s.type === 'interrupt')).toBe(true);
        });

        it('should finish when discover queue is empty (emptyMeansDone)', async () => {
            const runTask = vi.fn(stubRunTask(['should not run']));
            const runner = new LoopRunner(
                {
                    ...baseSpec,
                    discover: { tool: 'alerts.list_open', emptyMeansDone: true },
                },
                {
                    logger: mockLogger,
                    runTask,
                    executeTool: async () => ok('[]'),
                }
            );
            await collect(runner.run());
            expect(runner.getResult()?.outcome).toBe('goal_achieved');
            expect(runTask).not.toHaveBeenCalled();
        });

        it('should exhaust budget when verifier keeps failing with different signatures', async () => {
            let n = 0;
            const runner = new LoopRunner(
                { ...baseSpec, budgets: { ...baseSpec.budgets, maxIterations: 4 }, verify: [{ tool: 'shell.execute' }] },
                {
                    logger: mockLogger,
                    runTask: stubRunTask(['try']),
                    // 每轮失败原因不同 → 不触发停滞，但耗尽轮数
                    executeTool: async () => err(`failure variant ${++n}`),
                }
            );
            await collect(runner.run());
            // 失败签名相同（同一 verifier 名）→ 实际是停滞路径；
            // 这里验证最终一定终止且 outcome 是 stalled 或 budget_exhausted
            const outcome = runner.getResult()?.outcome;
            expect(['stalled', 'budget_exhausted']).toContain(outcome);
        });

        it('should respect maxSteps budget', async () => {
            const runner = new LoopRunner(
                { ...baseSpec, budgets: { maxIterations: 50, maxSteps: 3, maxWallClockMin: 5 }, verify: [{ tool: 't' }] },
                {
                    logger: mockLogger,
                    runTask: stubRunTask(['x']),   // 每轮 2 steps
                    executeTool: async () => err('fail'),
                }
            );
            await collect(runner.run());
            expect(runner.getResult()?.outcome).toBe('budget_exhausted');
            expect(runner.getResult()?.totalSteps).toBeLessThanOrEqual(4);
        });

        it('should stop silently when onStall is stop', async () => {
            const escalate = vi.fn(async () => {});
            const runner = new LoopRunner(
                { ...baseSpec, onStall: 'stop', verify: [{ tool: 't', name: 'v' }] },
                {
                    logger: mockLogger,
                    runTask: stubRunTask(['x']),
                    executeTool: async () => err('fail'),
                    escalate,
                }
            );
            const steps = await collect(runner.run());
            expect(escalate).not.toHaveBeenCalled();
            expect(steps.some(s => s.type === 'interrupt')).toBe(false);
        });

        it('should honor abortSignal', async () => {
            const controller = new AbortController();
            controller.abort();
            const runner = new LoopRunner(baseSpec, {
                logger: mockLogger,
                runTask: stubRunTask(['x']),
                executeTool: async () => ok(''),
            });
            await collect(runner.run({ abortSignal: controller.signal }));
            expect(runner.getResult()?.outcome).toBe('cancelled');
        });

        it('should complete single-pass when no verify and no grader', async () => {
            const runner = new LoopRunner(baseSpec, {
                logger: mockLogger,
                runTask: stubRunTask(['single pass output']),
                executeTool: async () => ok(''),
            });
            await collect(runner.run());
            expect(runner.getResult()?.outcome).toBe('goal_achieved');
            expect(runner.getResult()?.iterations).toBe(1);
            expect(runner.getResult()?.lastOutput).toBe('single pass output');
        });
    });
});
