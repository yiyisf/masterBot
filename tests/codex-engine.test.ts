import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, mkdirSync, chmodSync, rmSync, readFileSync } from 'fs';
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

    it('拼装的 CLI 参数包含 exec/--json/--sandbox/-C/--skip-git-repo-check 与 prompt（不含 -a/--ask-for-approval，实测确认 exec 不支持该参数）', async () => {
        const argsFile = path.join(tmpDir, 'args.json');
        process.env.FAKE_CODEX_ARGS_FILE = argsFile;
        const engine = new CodexEngine(mockLogger, { binaryPath: fakeBinPath, sandbox: 'read-only' });
        await drain(engine.run('implement X', { sessionId: 's8', memory: mockMemory, cwd: tmpDir }));
        const args = JSON.parse(readFileSync(argsFile, 'utf-8'));
        expect(args).toEqual(['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', tmpDir, 'implement X']);
    });

    it('-C 显式传给 CLI，不依赖进程级 cwd（防御性修复，同一类 bug 在 opencode 引擎上被真实踩中过）', async () => {
        const argsFile = path.join(tmpDir, 'args.json');
        process.env.FAKE_CODEX_ARGS_FILE = argsFile;
        const engine = new CodexEngine(mockLogger, { binaryPath: fakeBinPath });
        const otherDir = path.join(tmpDir, 'a-different-project-dir');
        mkdirSync(otherDir);
        await drain(engine.run('task', { sessionId: 's8b', memory: mockMemory, cwd: otherDir }));
        const args = JSON.parse(readFileSync(argsFile, 'utf-8'));
        expect(args).toContain('-C');
        expect(args[args.indexOf('-C') + 1]).toBe(otherDir);
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

    it('完整成功路径（第二轮实测，改用 OpenAI 兼容 provider 拿到真实额度）：task_started → agent_message → token_count，无 task_complete', async () => {
        // 真实抓到的 JSONL（prompt: "Just reply with the single word: pong."）：
        // {"id":"0","msg":{"type":"task_started","model_context_window":null}}
        // {"id":"0","msg":{"type":"agent_message","message":"pong"}}
        // {"id":"0","msg":{"type":"token_count","info":null}}
        // 进程随后直接退出（code 0）——完成靠进程退出，不是靠专门的事件。
        process.env.FAKE_CODEX_OUTPUT = [
            JSON.stringify({ workdir: '/repo', provider: 'mistral_probe', approval: 'never', sandbox: 'read-only', model: 'mistral-large-latest' }),
            JSON.stringify({ prompt: 'Just reply with the single word: pong. Do not run any commands.' }),
            JSON.stringify({ id: '0', msg: { type: 'task_started', model_context_window: null } }),
            JSON.stringify({ id: '0', msg: { type: 'agent_message', message: 'pong' } }),
            JSON.stringify({ id: '0', msg: { type: 'token_count', info: null } }),
        ].join('\n') + '\n';

        const engine = new CodexEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('Just reply with the single word: pong.', { sessionId: 's1b', memory: mockMemory }));

        // 配置回显 1 条 meta（prompt 回显不产出）+ task_started 1 条 meta + agent_message 1 条
        // content（token_count 不产出步骤）= 3 步
        expect(steps).toHaveLength(3);
        expect(steps[0].type).toBe('meta');
        expect(steps[0].content).toContain('mistral-large-latest');
        expect(steps[1]).toMatchObject({ type: 'meta' });
        expect(steps[1].content).toContain('context window: -'); // model_context_window: null → '-'
        expect(steps[2]).toMatchObject({ type: 'content', content: 'pong' });
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

    it('推断事件映射（仍未实测——两轮实测的 prompt 都没有触发工具调用/多轮）：agent_reasoning→thought, exec_command_begin/end→action/observation, task_complete→answer+meta（未在真实成功路径里出现，兜底分支）', async () => {
        process.env.FAKE_CODEX_OUTPUT = [
            JSON.stringify({ id: '0', msg: { type: 'agent_reasoning', text: '思考中...' } }),
            JSON.stringify({ id: '0', msg: { type: 'exec_command_begin', command: ['ls', '-la'] } }),
            JSON.stringify({ id: '0', msg: { type: 'exec_command_end', stdout: 'file1\nfile2' } }),
            JSON.stringify({ id: '0', msg: { type: 'task_complete', last_agent_message: '完成了' } }),
        ].join('\n') + '\n';

        const engine = new CodexEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('task', { sessionId: 's4', memory: mockMemory }));

        expect(steps.find(s => s.type === 'thought')?.content).toBe('思考中...');
        const action = steps.find(s => s.type === 'action');
        expect(action?.toolName).toBe('Bash');
        expect(action?.content).toContain('ls -la');
        expect(steps.find(s => s.type === 'observation')?.content).toContain('file1');
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
