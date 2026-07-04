import { describe, it, expect, vi } from 'vitest';
import { NativeAgentEngine } from '../src/core/harness/agent-engine.js';
import { ClaudeAgentSdkEngine } from '../src/core/harness/claude-sdk-engine.js';
import { defaultAgentSpec } from '../src/core/harness/agent-spec.js';
import type { IAgentEngine, EngineRunContext } from '../src/core/harness/agent-engine.js';
import type { ExecutionStep } from '../src/types.js';

const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

const mockMemory = {
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
    search: vi.fn(async () => []),
};

const baseContext: EngineRunContext = {
    sessionId: 'test-session',
    memory: mockMemory,
};

async function collect(gen: AsyncGenerator<ExecutionStep>): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];
    for await (const s of gen) steps.push(s);
    return steps;
}

describe('U16: IAgentEngine', () => {
    describe('NativeAgentEngine', () => {
        it('should delegate run() to the wrapped Agent', async () => {
            const fakeSteps: ExecutionStep[] = [
                { type: 'content', content: 'hello', timestamp: new Date() },
                { type: 'answer', content: 'done', timestamp: new Date() },
            ];
            const fakeAgent = {
                run: vi.fn(async function* () {
                    yield* fakeSteps;
                }),
            };
            const engine = new NativeAgentEngine(fakeAgent as any);
            expect(engine.kind).toBe('native');

            const steps = await collect(engine.run('task', baseContext));
            expect(steps).toHaveLength(2);
            expect(fakeAgent.run).toHaveBeenCalledWith('task', baseContext);
        });
    });

    describe('AgentSpec engine field', () => {
        it('should default to native engine', () => {
            const spec = defaultAgentSpec({ id: 't', name: 'T' });
            expect(spec.engine).toBe('native');
        });

        it('should accept claude-agent-sdk engine with options', () => {
            const spec = defaultAgentSpec({
                id: 'coder',
                name: 'Coder',
                engine: 'claude-agent-sdk',
                engineOptions: { allowedTools: ['Read', 'Bash'], model: 'claude-opus-4-8' },
            });
            expect(spec.engine).toBe('claude-agent-sdk');
            expect(spec.engineOptions?.allowedTools).toEqual(['Read', 'Bash']);
        });
    });

    describe('ClaudeAgentSdkEngine', () => {
        it('should fall back when ANTHROPIC_API_KEY is missing', async () => {
            const savedKey = process.env.ANTHROPIC_API_KEY;
            delete process.env.ANTHROPIC_API_KEY;
            try {
                const fallbackSteps: ExecutionStep[] = [
                    { type: 'answer', content: 'fallback answer', timestamp: new Date() },
                ];
                const fallback: IAgentEngine = {
                    kind: 'native',
                    run: vi.fn(async function* () {
                        yield* fallbackSteps;
                    }),
                };
                const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', engine: 'claude-agent-sdk' });
                const engine = new ClaudeAgentSdkEngine(spec, mockLogger, { fallback });

                const steps = await collect(engine.run('write code', baseContext));
                // 第一步应是降级提示 meta，随后是 fallback 引擎的输出
                expect(steps[0].type).toBe('meta');
                expect(steps[0].content).toContain('降级');
                expect(steps.some(s => s.type === 'answer' && s.content === 'fallback answer')).toBe(true);
                expect(fallback.run).toHaveBeenCalled();
            } finally {
                if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
            }
        });

        it('should throw when no fallback configured and key missing', async () => {
            const savedKey = process.env.ANTHROPIC_API_KEY;
            delete process.env.ANTHROPIC_API_KEY;
            try {
                const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', engine: 'claude-agent-sdk' });
                const engine = new ClaudeAgentSdkEngine(spec, mockLogger);
                await expect(collect(engine.run('task', baseContext))).rejects.toThrow();
            } finally {
                if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
            }
        });

        it('should translate SDK messages to ExecutionStep', () => {
            const spec = defaultAgentSpec({ id: 'coder', name: 'Coder' });
            const engine = new ClaudeAgentSdkEngine(spec, mockLogger);
            const translate = (m: unknown) => Array.from((engine as any)._translateMessage(m));

            // assistant text + tool_use
            const steps1 = translate({
                type: 'assistant',
                message: {
                    content: [
                        { type: 'text', text: '我来修复这个 bug' },
                        { type: 'tool_use', name: 'Edit', input: { file_path: '/a.ts' } },
                    ],
                },
            }) as ExecutionStep[];
            expect(steps1[0]).toMatchObject({ type: 'content', content: '我来修复这个 bug' });
            expect(steps1[1]).toMatchObject({ type: 'action', toolName: 'Edit' });

            // tool_result → observation
            const steps2 = translate({
                type: 'user',
                message: { content: [{ type: 'tool_result', content: 'file edited ok' }] },
            }) as ExecutionStep[];
            expect(steps2[0]).toMatchObject({ type: 'observation', content: 'file edited ok' });

            // result success → answer + meta
            const steps3 = translate({
                type: 'result',
                subtype: 'success',
                result: '修复完成',
                num_turns: 12,
                total_cost_usd: 0.05,
            }) as ExecutionStep[];
            expect(steps3[0]).toMatchObject({ type: 'answer', content: '修复完成' });
            expect(steps3[1].type).toBe('meta');

            // system init → meta
            const steps4 = translate({
                type: 'system',
                subtype: 'init',
                model: 'claude-opus-4-8',
                session_id: 'abc',
            }) as ExecutionStep[];
            expect(steps4[0].type).toBe('meta');
        });

        it('canUseTool semantics: sandbox blocks dangerous Bash commands', async () => {
            const spec = defaultAgentSpec({ id: 'coder', name: 'Coder' });
            const engine = new ClaudeAgentSdkEngine(spec, mockLogger);
            // 直接验证内部沙箱（canUseTool 委托给它）
            const sandbox = (engine as any).sandbox;
            expect(sandbox.validate('rm -rf /').allowed).toBe(false);
            expect(sandbox.validate('npm test').allowed).toBe(true);
        });
    });
});
