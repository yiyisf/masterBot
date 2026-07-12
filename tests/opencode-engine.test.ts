import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, chmodSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { OpenCodeEngine } from '../src/core/harness/opencode-engine.js';
import type { ExecutionStep, Logger, MemoryAccess } from '../src/types.js';

const mockLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const mockMemory: MemoryAccess = { get: async () => undefined, set: async () => {}, search: async () => [] };

let tmpDir: string;
let fakeBinPath: string;

async function drain(gen: AsyncGenerator<ExecutionStep>): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];
    for await (const s of gen) steps.push(s);
    return steps;
}

beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'fake-opencode-'));
    fakeBinPath = path.join(tmpDir, 'fake-opencode.cjs');
    writeFileSync(fakeBinPath, `#!/usr/bin/env node
const fs = require('fs');
if (process.env.FAKE_OPENCODE_ARGS_FILE) {
    fs.writeFileSync(process.env.FAKE_OPENCODE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
}
const output = process.env.FAKE_OPENCODE_OUTPUT || '';
if (output) process.stdout.write(output);
process.exitCode = parseInt(process.env.FAKE_OPENCODE_EXIT_CODE || '0', 10);
`);
    chmodSync(fakeBinPath, 0o755);
});

afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
    delete process.env.FAKE_OPENCODE_OUTPUT;
    delete process.env.FAKE_OPENCODE_EXIT_CODE;
    delete process.env.FAKE_OPENCODE_ARGS_FILE;
});

describe('OpenCodeEngine', () => {
    it('capabilities: interactiveApproval=false（v1 一次性非交互模式，opencode serve 双向通道留后续）, resume=false', () => {
        const engine = new OpenCodeEngine(mockLogger, { binaryPath: fakeBinPath });
        expect(engine.capabilities).toEqual({ interactiveApproval: false, resume: false });
    });

    it('拼装的 CLI 参数包含 run/--format/json 与 prompt', async () => {
        const argsFile = path.join(tmpDir, 'args.json');
        process.env.FAKE_OPENCODE_ARGS_FILE = argsFile;
        const engine = new OpenCodeEngine(mockLogger, { binaryPath: fakeBinPath, model: 'opencode/deepseek-v4-flash-free' });
        await drain(engine.run('implement X', { sessionId: 's1', memory: mockMemory, cwd: tmpDir }));
        const args = JSON.parse(readFileSync(argsFile, 'utf-8'));
        expect(args).toEqual(['run', '--format', 'json', '-m', 'opencode/deepseek-v4-flash-free', 'implement X']);
    });

    it('真实成功路径（实测，纯文本回复）：step_start → text → step_finish', async () => {
        // 真实抓到的 JSONL（免费模型 opencode/deepseek-v4-flash-free，prompt: "pong"）
        process.env.FAKE_OPENCODE_OUTPUT = [
            JSON.stringify({ type: 'step_start', timestamp: 1, sessionID: 's', part: { type: 'step-start' } }),
            JSON.stringify({ type: 'text', timestamp: 2, sessionID: 's', part: { type: 'text', text: 'pong' } }),
            JSON.stringify({ type: 'step_finish', timestamp: 3, sessionID: 's', part: { type: 'step-finish', reason: 'stop', cost: 0, tokens: { input: 10, output: 2 } } }),
        ].join('\n') + '\n';

        const engine = new OpenCodeEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('reply pong', { sessionId: 's2', memory: mockMemory }));

        // step-start 不产出步骤；text → content；step-finish(reason=stop) → meta
        expect(steps).toHaveLength(2);
        expect(steps[0]).toMatchObject({ type: 'content', content: 'pong' });
        expect(steps[1]).toMatchObject({ type: 'meta' });
        expect(steps[1].content).toContain('stop');
    });

    it('真实成功路径（实测，含工具调用）：tool_use（glob）拆成 action+observation，step_finish(reason=tool-calls) 不产出步骤', async () => {
        // 真实抓到的 JSONL（免费模型，prompt 要求列出当前目录文件）
        process.env.FAKE_OPENCODE_OUTPUT = [
            JSON.stringify({ type: 'step_start', timestamp: 1, sessionID: 's', part: { type: 'step-start' } }),
            JSON.stringify({
                type: 'tool_use', timestamp: 2, sessionID: 's',
                part: {
                    type: 'tool', tool: 'glob', callID: 'call1',
                    state: { status: 'completed', input: { pattern: '*' }, output: 'a.txt\nb.txt', title: 'x' },
                },
            }),
            JSON.stringify({ type: 'step_finish', timestamp: 3, sessionID: 's', part: { type: 'step-finish', reason: 'tool-calls', cost: 0 } }),
            JSON.stringify({ type: 'step_start', timestamp: 4, sessionID: 's', part: { type: 'step-start' } }),
            JSON.stringify({ type: 'text', timestamp: 5, sessionID: 's', part: { type: 'text', text: 'Found 2 files.' } }),
            JSON.stringify({ type: 'step_finish', timestamp: 6, sessionID: 's', part: { type: 'step-finish', reason: 'stop', cost: 0 } }),
        ].join('\n') + '\n';

        const engine = new OpenCodeEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('list files', { sessionId: 's3', memory: mockMemory }));

        const action = steps.find(s => s.type === 'action');
        expect(action?.toolName).toBe('glob');
        expect(action?.toolInput).toEqual({ pattern: '*' });
        const observation = steps.find(s => s.type === 'observation');
        expect(observation?.content).toContain('a.txt');
        expect(steps.find(s => s.type === 'content')?.content).toBe('Found 2 files.');
        // tool-calls 阶段的 step_finish 不产出 meta（只有最终 stop 阶段才产出）
        expect(steps.filter(s => s.type === 'meta')).toHaveLength(1);
    });

    it('error 事件（实测确认，无 part 包装）：answer + meta', async () => {
        // 真实抓到的 JSONL（未认证模型 401）
        process.env.FAKE_OPENCODE_OUTPUT = JSON.stringify({
            type: 'error', timestamp: 1, sessionID: 's',
            error: { name: 'APIError', data: { message: 'Model grok-code is not supported', statusCode: 401 } },
        }) + '\n';

        const engine = new OpenCodeEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('task', { sessionId: 's4', memory: mockMemory }));

        expect(steps.some(s => s.type === 'answer' && s.content.includes('not supported'))).toBe(true);
        expect(steps.some(s => s.type === 'meta' && s.content.includes('失败'))).toBe(true);
    });

    it('未识别事件类型不静默丢弃，降级为 meta', async () => {
        process.env.FAKE_OPENCODE_OUTPUT = JSON.stringify({
            type: 'some_future_event', timestamp: 1, sessionID: 's', part: { type: 'some-future-part', foo: 'bar' },
        }) + '\n';
        const engine = new OpenCodeEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('task', { sessionId: 's5', memory: mockMemory }));
        expect(steps).toHaveLength(1);
        expect(steps[0].content).toContain('some-future-part');
        expect(steps[0].content).toContain('bar');
    });

    it('工具执行失败（state.status=error）产出带 ❌ 前缀的 observation', async () => {
        process.env.FAKE_OPENCODE_OUTPUT = JSON.stringify({
            type: 'tool_use', timestamp: 1, sessionID: 's',
            part: { type: 'tool', tool: 'bash', callID: 'call2', state: { status: 'error', input: { command: 'false' }, output: 'command failed' } },
        }) + '\n';
        const engine = new OpenCodeEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('task', { sessionId: 's6', memory: mockMemory }));
        const observation = steps.find(s => s.type === 'observation');
        expect(observation?.content).toContain('❌');
        expect(observation?.content).toContain('command failed');
    });

    it('非零退出码抛错', async () => {
        process.env.FAKE_OPENCODE_EXIT_CODE = '1';
        const engine = new OpenCodeEngine(mockLogger, { binaryPath: fakeBinPath });
        await expect(drain(engine.run('task', { sessionId: 's7', memory: mockMemory })))
            .rejects.toThrow(/exited with code 1/);
    });

    it('可执行文件不存在时给出清晰错误', async () => {
        const engine = new OpenCodeEngine(mockLogger, { binaryPath: path.join(tmpDir, 'does-not-exist') });
        await expect(drain(engine.run('task', { sessionId: 's8', memory: mockMemory })))
            .rejects.toThrow(/未找到/);
    });

    it('abortSignal 触发时终止子进程，不会一直挂起', async () => {
        const slowScript = path.join(tmpDir, 'slow-opencode.cjs');
        writeFileSync(slowScript, `#!/usr/bin/env node\nsetTimeout(() => { process.exit(0); }, 30000);\n`);
        chmodSync(slowScript, 0o755);

        const engine = new OpenCodeEngine(mockLogger, { binaryPath: slowScript });
        const controller = new AbortController();
        const runPromise = drain(engine.run('task', { sessionId: 's9', memory: mockMemory, abortSignal: controller.signal }));
        controller.abort();
        await expect(runPromise).rejects.toThrow();
    });
});
