import { describe, it, expect, vi, beforeEach } from 'vitest';

// review fix: SDKResultError（error_during_execution 等异常终止子类型）没有 `.result` 字段，
// 只有 SDKResultSuccess 才有。之前 `(message as any).result` 恒为 undefined，
// 异常终止时 Grader 拿不到任何 answer 步骤。验证改用 `errors: string[]` 后能正确 yield。

const queryMock = vi.hoisted(() => vi.fn());
// 研发流程管理执行层基座：ask_user MCP 工具注入需要 SDK 的 tool()/createSdkMcpServer()。
// mock 只需保留调用方能取回 handler 的最小形状，不需要真正实现 MCP 协议。
const toolMock = vi.hoisted(() => vi.fn((name: string, description: string, inputSchema: unknown, handler: unknown) => ({
    name, description, inputSchema, handler,
})));
const createSdkMcpServerMock = vi.hoisted(() => vi.fn((opts: unknown) => opts));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: queryMock,
    tool: toolMock,
    createSdkMcpServer: createSdkMcpServerMock,
}));

import { ClaudeAgentSdkEngine } from '../src/core/harness/claude-sdk-engine.js';
import { defaultAgentSpec } from '../src/core/harness/agent-spec.js';
import { resolveInterrupt, hasPendingInterrupt } from '../src/core/interrupt-coordinator.js';
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

describe('ClaudeAgentSdkEngine: 执行层基座（研发流程管理）', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.ANTHROPIC_API_KEY = 'test-key';
    });

    it('capabilities: interactiveApproval=true, resume=false', () => {
        const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', engine: 'claude-agent-sdk' });
        const engine = new ClaudeAgentSdkEngine(spec, mockLogger as any);
        expect(engine.capabilities).toEqual({ interactiveApproval: true, resume: false });
    });

    it('context.cwd 优先于 spec.engineOptions.cwd（spec §5.2）', async () => {
        queryMock.mockReturnValue(fakeQueryStream([]));
        const spec = defaultAgentSpec({
            id: 'coder', name: 'Coder', engine: 'claude-agent-sdk',
            engineOptions: { cwd: '/spec/engine-options/cwd' },
        });
        const engine = new ClaudeAgentSdkEngine(spec, mockLogger as any);

        await drain(engine.run('task', { sessionId: 's-cwd-1', memory: mockMemory, cwd: '/worktree/cmasterBot-42' }));
        expect(queryMock.mock.calls[0][0].options.cwd).toBe('/worktree/cmasterBot-42');
    });

    it('未传 context.cwd 时回退到 spec.engineOptions.cwd', async () => {
        queryMock.mockReturnValue(fakeQueryStream([]));
        const spec = defaultAgentSpec({
            id: 'coder', name: 'Coder', engine: 'claude-agent-sdk',
            engineOptions: { cwd: '/spec/engine-options/cwd' },
        });
        const engine = new ClaudeAgentSdkEngine(spec, mockLogger as any);

        await drain(engine.run('task', { sessionId: 's-cwd-2', memory: mockMemory }));
        expect(queryMock.mock.calls[0][0].options.cwd).toBe('/spec/engine-options/cwd');
    });

    it('注入了 ask_user MCP 工具并加入 allowedTools（question 通道常开）', async () => {
        queryMock.mockReturnValue(fakeQueryStream([]));
        const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', engine: 'claude-agent-sdk' });
        const engine = new ClaudeAgentSdkEngine(spec, mockLogger as any);

        await drain(engine.run('task', { sessionId: 's-ask-user-setup', memory: mockMemory }));
        const options = queryMock.mock.calls[0][0].options;
        expect(options.allowedTools).toContain('mcp__ask_user_server__ask_user');
        expect(options.mcpServers.ask_user_server.tools[0].name).toBe('ask_user');
    });

    it('ask_user 工具 handler 阻塞直到 waitForUserDecision 被 resolveInterrupt 释放，并把文本应答回传', async () => {
        queryMock.mockReturnValue(fakeQueryStream([]));
        const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', engine: 'claude-agent-sdk' });
        const engine = new ClaudeAgentSdkEngine(spec, mockLogger as any);

        const sessionId = 's-ask-user-flow';
        await drain(engine.run('task', { sessionId, memory: mockMemory }));
        const handler = queryMock.mock.calls[0][0].options.mcpServers.ask_user_server.tools[0].handler;

        const resultPromise = handler({ question: '要不要用 PostgreSQL？' }, {});
        expect(hasPendingInterrupt(sessionId)).toBe(true);
        expect(resolveInterrupt(sessionId, true, { response: '用 PostgreSQL' })).toBe(true);

        const result = await resultPromise;
        expect(result).toEqual({ content: [{ type: 'text', text: '用 PostgreSQL' }] });
    });

    it('ask_user 无文本应答时返回占位说明（区分批准/拒绝）', async () => {
        queryMock.mockReturnValue(fakeQueryStream([]));
        const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', engine: 'claude-agent-sdk' });
        const engine = new ClaudeAgentSdkEngine(spec, mockLogger as any);

        const sessionId = 's-ask-user-no-text';
        await drain(engine.run('task', { sessionId, memory: mockMemory }));
        const handler = queryMock.mock.calls[0][0].options.mcpServers.ask_user_server.tools[0].handler;

        const resultPromise = handler({ question: 'ok?' }, {});
        resolveInterrupt(sessionId, false);
        const result = await resultPromise;
        expect(result.content[0].text).toContain('拒绝');
    });

    it('canUseTool 默认（approvalMode 未设置）对危险 Bash 命令直接 deny，不打扰人', async () => {
        queryMock.mockReturnValue(fakeQueryStream([]));
        const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', engine: 'claude-agent-sdk' });
        const engine = new ClaudeAgentSdkEngine(spec, mockLogger as any);

        const sessionId = 's-deny-default';
        await drain(engine.run('task', { sessionId, memory: mockMemory }));
        const canUseTool = queryMock.mock.calls[0][0].options.canUseTool;

        const verdict = await canUseTool('Bash', { command: 'rm -rf /' });
        expect(verdict.behavior).toBe('deny');
        expect(hasPendingInterrupt(sessionId)).toBe(false);
    });

    it('canUseTool 在 approvalMode=ask-on-risky 时把危险 Bash 命令转人工审批（approve→allow）', async () => {
        queryMock.mockReturnValue(fakeQueryStream([]));
        const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', engine: 'claude-agent-sdk' });
        const engine = new ClaudeAgentSdkEngine(spec, mockLogger as any);

        const sessionId = 's-ask-on-risky-approve';
        await drain(engine.run('task', { sessionId, memory: mockMemory, approvalMode: 'ask-on-risky' }));
        const canUseTool = queryMock.mock.calls[0][0].options.canUseTool;

        const verdictPromise = canUseTool('Bash', { command: 'rm -rf /' });
        expect(hasPendingInterrupt(sessionId)).toBe(true);
        resolveInterrupt(sessionId, true);

        const verdict = await verdictPromise;
        expect(verdict.behavior).toBe('allow');
    });

    it('canUseTool 在 approvalMode=ask-on-risky 时人工拒绝仍然 deny', async () => {
        queryMock.mockReturnValue(fakeQueryStream([]));
        const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', engine: 'claude-agent-sdk' });
        const engine = new ClaudeAgentSdkEngine(spec, mockLogger as any);

        const sessionId = 's-ask-on-risky-reject';
        await drain(engine.run('task', { sessionId, memory: mockMemory, approvalMode: 'ask-on-risky' }));
        const canUseTool = queryMock.mock.calls[0][0].options.canUseTool;

        const verdictPromise = canUseTool('Bash', { command: 'rm -rf /' });
        resolveInterrupt(sessionId, false);

        const verdict = await verdictPromise;
        expect(verdict.behavior).toBe('deny');
    });

    it('canUseTool 对非 Bash 且不在白名单的工具仍然直接 deny（不受 ask-on-risky 影响）', async () => {
        queryMock.mockReturnValue(fakeQueryStream([]));
        const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', engine: 'claude-agent-sdk' });
        const engine = new ClaudeAgentSdkEngine(spec, mockLogger as any);

        const sessionId = 's-not-allowed';
        await drain(engine.run('task', { sessionId, memory: mockMemory, approvalMode: 'ask-on-risky' }));
        const canUseTool = queryMock.mock.calls[0][0].options.canUseTool;

        const verdict = await canUseTool('SomeRandomTool', {});
        expect(verdict.behavior).toBe('deny');
        expect(hasPendingInterrupt(sessionId)).toBe(false);
    });
});
