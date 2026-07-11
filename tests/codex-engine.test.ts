import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, chmodSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { CodexEngine } from '../src/core/harness/codex-engine.js';
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
    tmpDir = mkdtempSync(path.join(tmpdir(), 'fake-codex-'));
    fakeBinPath = path.join(tmpDir, 'fake-codex.cjs');
    writeFileSync(fakeBinPath, `#!/usr/bin/env node
const fs = require('fs');
if (process.env.FAKE_CODEX_ARGS_FILE) {
    fs.writeFileSync(process.env.FAKE_CODEX_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
}
const output = process.env.FAKE_CODEX_OUTPUT || '';
if (output) process.stdout.write(output);
const stderrOut = process.env.FAKE_CODEX_STDERR || '';
if (stderrOut) process.stderr.write(stderrOut);
process.exitCode = parseInt(process.env.FAKE_CODEX_EXIT_CODE || '0', 10);
`);
    chmodSync(fakeBinPath, 0o755);
});

afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
    delete process.env.FAKE_CODEX_OUTPUT;
    delete process.env.FAKE_CODEX_STDERR;
    delete process.env.FAKE_CODEX_EXIT_CODE;
    delete process.env.FAKE_CODEX_ARGS_FILE;
});

describe('CodexEngine', () => {
    it('capabilities: interactiveApproval=false, resume=false（显式降级，spec §5.5）', () => {
        const engine = new CodexEngine(mockLogger, { binaryPath: fakeBinPath });
        expect(engine.capabilities).toEqual({ interactiveApproval: false, resume: false });
    });

    it('拼装的 CLI 参数包含 exec/--json/--sandbox/--skip-git-repo-check 与 prompt（不含 -a/--ask-for-approval，实测确认 exec 不支持该参数）', async () => {
        const argsFile = path.join(tmpDir, 'args.json');
        process.env.FAKE_CODEX_ARGS_FILE = argsFile;
        const engine = new CodexEngine(mockLogger, { binaryPath: fakeBinPath, sandbox: 'read-only' });
        await drain(engine.run('implement X', { sessionId: 's8', memory: mockMemory, cwd: tmpDir }));
        const args = JSON.parse(readFileSync(argsFile, 'utf-8'));
        expect(args).toEqual(['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', 'implement X']);
    });

    it('解析真实实测过的事件形状：配置回显 → meta，task_started → meta（实施地图 #61 ticket #65 实测记录）', async () => {
        process.env.FAKE_CODEX_OUTPUT = [
            JSON.stringify({ approval: 'never', model: 'gpt-5', workdir: '/tmp', provider: 'aicoding', sandbox: 'workspace-write' }),
            JSON.stringify({ prompt: 'do the task' }),
            JSON.stringify({ id: '0', msg: { type: 'task_started', model_context_window: 272000 } }),
        ].join('\n') + '\n';

        const engine = new CodexEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('do the task', { sessionId: 's1', memory: mockMemory }));

        expect(steps).toHaveLength(2);
        expect(steps[0].type).toBe('meta');
        expect(steps[0].content).toContain('gpt-5');
        expect(steps[1].content).toContain('272000');
    });

    it('stream_error 视为瞬时警告（meta，不中断），error 视为终态失败（answer+meta）——均实测确认', async () => {
        process.env.FAKE_CODEX_OUTPUT = [
            JSON.stringify({ id: '0', msg: { type: 'stream_error', message: '402 Payment Required' } }),
            JSON.stringify({ id: '0', msg: { type: 'error', message: 'unexpected status 402' } }),
        ].join('\n') + '\n';

        const engine = new CodexEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('task', { sessionId: 's2', memory: mockMemory }));

        expect(steps.some(s => s.type === 'meta' && s.content.includes('重试中'))).toBe(true);
        expect(steps.some(s => s.type === 'answer' && s.content.includes('402'))).toBe(true);
    });

    it('未识别的事件类型不静默丢弃，降级为 meta 透出原始 payload', async () => {
        process.env.FAKE_CODEX_OUTPUT = JSON.stringify({ id: '0', msg: { type: 'some_future_event', foo: 'bar' } }) + '\n';
        const engine = new CodexEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('task', { sessionId: 's3', memory: mockMemory }));
        expect(steps).toHaveLength(1);
        expect(steps[0].content).toContain('some_future_event');
        expect(steps[0].content).toContain('bar');
    });

    it('非 JSON 行被容错跳过，不中断整体解析', async () => {
        process.env.FAKE_CODEX_OUTPUT = [
            'not json at all',
            JSON.stringify({ id: '0', msg: { type: 'task_started', model_context_window: 1000 } }),
        ].join('\n') + '\n';
        const engine = new CodexEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('task', { sessionId: 's3b', memory: mockMemory }));
        expect(steps).toHaveLength(1);
        expect(steps[0].content).toContain('1000');
    });

    it('推断事件映射（未实测，基于协议一般认知）：agent_message→content, agent_reasoning→thought, exec_command_begin/end→action/observation, token_count 静默, task_complete→answer+meta', async () => {
        process.env.FAKE_CODEX_OUTPUT = [
            JSON.stringify({ id: '0', msg: { type: 'agent_reasoning', text: '思考中...' } }),
            JSON.stringify({ id: '0', msg: { type: 'agent_message', message: '我来处理这个任务' } }),
            JSON.stringify({ id: '0', msg: { type: 'exec_command_begin', command: ['ls', '-la'] } }),
            JSON.stringify({ id: '0', msg: { type: 'exec_command_end', stdout: 'file1\nfile2' } }),
            JSON.stringify({ id: '0', msg: { type: 'token_count', input_tokens: 100 } }),
            JSON.stringify({ id: '0', msg: { type: 'task_complete', last_agent_message: '完成了' } }),
        ].join('\n') + '\n';

        const engine = new CodexEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('task', { sessionId: 's4', memory: mockMemory }));

        expect(steps.find(s => s.type === 'thought')?.content).toBe('思考中...');
        expect(steps.find(s => s.type === 'content')?.content).toBe('我来处理这个任务');
        const action = steps.find(s => s.type === 'action');
        expect(action?.toolName).toBe('Bash');
        expect(action?.content).toContain('ls -la');
        expect(steps.find(s => s.type === 'observation')?.content).toContain('file1');
        expect(steps.some(s => s.content?.includes('input_tokens'))).toBe(false);
        expect(steps.find(s => s.type === 'answer')?.content).toBe('完成了');
    });

    it('非零退出码抛错，携带 stderr', async () => {
        process.env.FAKE_CODEX_EXIT_CODE = '1';
        process.env.FAKE_CODEX_STDERR = 'boom';
        const engine = new CodexEngine(mockLogger, { binaryPath: fakeBinPath });
        await expect(drain(engine.run('task', { sessionId: 's5', memory: mockMemory })))
            .rejects.toThrow(/exited with code 1/);
    });

    it('可执行文件不存在时给出清晰错误（不是裸 ENOENT）', async () => {
        const engine = new CodexEngine(mockLogger, { binaryPath: path.join(tmpDir, 'does-not-exist-binary') });
        await expect(drain(engine.run('task', { sessionId: 's6', memory: mockMemory })))
            .rejects.toThrow(/未找到/);
    });

    it('abortSignal 触发时终止子进程，不会一直挂起', async () => {
        const slowScript = path.join(tmpDir, 'slow-codex.cjs');
        writeFileSync(slowScript, `#!/usr/bin/env node\nsetTimeout(() => { process.exit(0); }, 30000);\n`);
        chmodSync(slowScript, 0o755);

        const engine = new CodexEngine(mockLogger, { binaryPath: slowScript });
        const controller = new AbortController();
        const runPromise = drain(engine.run('task', { sessionId: 's7', memory: mockMemory, abortSignal: controller.signal }));

        controller.abort();
        // kill 后进程以信号终止（非 0 退出码），run() 应该 reject 而不是永久挂起
        await expect(runPromise).rejects.toThrow();
    });
});
