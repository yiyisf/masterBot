import { describe, it, expect, vi, beforeEach } from 'vitest';

// review fix: SDKResultError（error_during_execution 等异常终止子类型）没有 `.result` 字段，
// 只有 SDKResultSuccess 才有。之前 `(message as any).result` 恒为 undefined，
// 异常终止时 Grader 拿不到任何 answer 步骤。验证改用 `errors: string[]` 后能正确 yield。

const queryMock = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: queryMock,
}));

import { ClaudeAgentSdkEngine } from '../src/core/harness/claude-sdk-engine.js';
import { defaultAgentSpec } from '../src/core/harness/agent-spec.js';
import type { ExecutionStep, MemoryAccess } from '../src/types.js';

const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const mockMemory: MemoryAccess = { get: vi.fn(), set: vi.fn(), search: vi.fn() };

async function drain(gen: AsyncGenerator<ExecutionStep>): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];
    for await (const step of gen) steps.push(step);
    return steps;
}

async function* fakeQueryStream(messages: any[]) {
    for (const m of messages) yield m;
}

describe('ClaudeAgentSdkEngine: result message translation (review fix)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.ANTHROPIC_API_KEY = 'test-key';
    });

    it('yields an answer step from `errors` on an error-terminated SDK result (not the nonexistent `.result` field)', async () => {
        queryMock.mockReturnValue(fakeQueryStream([
            {
                type: 'result',
                subtype: 'error_max_turns',
                duration_ms: 1000,
                duration_api_ms: 900,
                is_error: true,
                num_turns: 80,
                stop_reason: null,
                total_cost_usd: 0.05,
                usage: {},
                modelUsage: {},
                permission_denials: [],
                errors: ['Exceeded maxTurns (80)'],
                uuid: 'u1',
                session_id: 's1',
            },
        ]));

        const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', engine: 'claude-agent-sdk' });
        const engine = new ClaudeAgentSdkEngine(spec, mockLogger as any);

        const steps = await drain(engine.run('do the task', { sessionId: 's1', memory: mockMemory }));

        const answerStep = steps.find(s => s.type === 'answer');
        expect(answerStep).toBeDefined();
        expect(answerStep!.content).toContain('Exceeded maxTurns (80)');

        const metaStep = steps.find(s => s.type === 'meta' && s.content.includes('异常结束'));
        expect(metaStep).toBeDefined();
    });

    it('does not yield a spurious answer step when `errors` is empty', async () => {
        queryMock.mockReturnValue(fakeQueryStream([
            {
                type: 'result',
                subtype: 'error_during_execution',
                duration_ms: 500,
                duration_api_ms: 400,
                is_error: true,
                num_turns: 3,
                stop_reason: null,
                total_cost_usd: 0.01,
                usage: {},
                modelUsage: {},
                permission_denials: [],
                errors: [],
                uuid: 'u2',
                session_id: 's2',
            },
        ]));

        const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', engine: 'claude-agent-sdk' });
        const engine = new ClaudeAgentSdkEngine(spec, mockLogger as any);

        const steps = await drain(engine.run('do the task', { sessionId: 's2', memory: mockMemory }));
        expect(steps.find(s => s.type === 'answer')).toBeUndefined();
    });

    it('still yields the success-path answer from `.result` unaffected by this fix', async () => {
        queryMock.mockReturnValue(fakeQueryStream([
            {
                type: 'result',
                subtype: 'success',
                duration_ms: 100,
                duration_api_ms: 90,
                is_error: false,
                num_turns: 2,
                result: 'done successfully',
                stop_reason: null,
                total_cost_usd: 0.001,
                usage: {},
                modelUsage: {},
                permission_denials: [],
                uuid: 'u3',
                session_id: 's3',
            },
        ]));

        const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', engine: 'claude-agent-sdk' });
        const engine = new ClaudeAgentSdkEngine(spec, mockLogger as any);

        const steps = await drain(engine.run('do the task', { sessionId: 's3', memory: mockMemory }));
        const answerStep = steps.find(s => s.type === 'answer');
        expect(answerStep?.content).toBe('done successfully');
    });
});
