import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, chmodSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PiEngine } from '../src/core/harness/pi-engine.js';
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
    tmpDir = mkdtempSync(path.join(tmpdir(), 'fake-pi-'));
    fakeBinPath = path.join(tmpDir, 'fake-pi.cjs');
    writeFileSync(fakeBinPath, `#!/usr/bin/env node
const fs = require('fs');
if (process.env.FAKE_PI_ARGS_FILE) {
    fs.writeFileSync(process.env.FAKE_PI_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
}
const output = process.env.FAKE_PI_OUTPUT || '';
if (output) process.stdout.write(output);
process.exitCode = parseInt(process.env.FAKE_PI_EXIT_CODE || '0', 10);
`);
    chmodSync(fakeBinPath, 0o755);
});

afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
    delete process.env.FAKE_PI_OUTPUT;
    delete process.env.FAKE_PI_EXIT_CODE;
    delete process.env.FAKE_PI_ARGS_FILE;
});

describe('PiEngine', () => {
    it('capabilities: interactiveApproval=false（v1 一次性非交互模式，--mode rpc 双向通道留后续）, resume=true（原生 --session 续接，spec #85）', () => {
        const engine = new PiEngine(mockLogger, { binaryPath: fakeBinPath });
        expect(engine.capabilities).toEqual({ interactiveApproval: false, resume: true });
    });

    it('拼装的 CLI 参数包含 --mode json -p、--provider/--model/--tools 与 prompt', async () => {
        const argsFile = path.join(tmpDir, 'args.json');
        process.env.FAKE_PI_ARGS_FILE = argsFile;
        const engine = new PiEngine(mockLogger, {
            binaryPath: fakeBinPath, provider: 'mistral', model: 'mistral-large-latest', tools: ['read', 'grep'],
        });
        await drain(engine.run('implement X', { sessionId: 's1', memory: mockMemory, cwd: tmpDir }));
        const args = JSON.parse(readFileSync(argsFile, 'utf-8'));
        expect(args).toEqual([
            '--mode', 'json', '-p',
            '--provider', 'mistral', '--model', 'mistral-large-latest', '--tools', 'read,grep',
            '--session-dir', path.join(tmpDir, '.cmaster-pi-sessions'),
            'implement X',
        ]);
    });

    it('真实成功路径（实测，Mistral，纯文本回复）：session → message_end(assistant) → content', async () => {
        // 真实抓到的 JSONL（pi 0.80.6 + mistral-large-latest，prompt: "pong"；已省略 message_start/
        // message_update 流式增量与 user 角色的 message_start/end，引擎本身也会跳过它们）
        process.env.FAKE_PI_OUTPUT = [
            JSON.stringify({ type: 'session', version: 3, id: 'x', timestamp: 't', cwd: '/private/tmp/pi-probe' }),
            JSON.stringify({ type: 'agent_start' }),
            JSON.stringify({ type: 'turn_start' }),
            JSON.stringify({
                type: 'message_end',
                message: { role: 'assistant', content: [{ type: 'text', text: 'pong' }], stopReason: 'stop', provider: 'mistral' },
            }),
            JSON.stringify({ type: 'turn_end' }),
            JSON.stringify({ type: 'agent_end', messages: [] }),
            JSON.stringify({ type: 'agent_settled' }),
        ].join('\n') + '\n';

        const engine = new PiEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('reply pong', { sessionId: 's2', memory: mockMemory }));

        // session 启动 meta + pong content + 成功结束后追加的 resumeToken meta（id='x'）
        expect(steps).toHaveLength(3);
        expect(steps[0]).toMatchObject({ type: 'meta' });
        expect(steps[0].content).toContain('/private/tmp/pi-probe');
        expect(steps[1]).toMatchObject({ type: 'content', content: 'pong' });
        expect(steps[2].resumeToken).toBe('x');
    });

    it('真实成功路径（实测，含工具调用）：tool_execution_start/end → action/observation，多轮 message_end 各自产出 content', async () => {
        // 真实抓到的 JSONL（pi 0.80.6 + mistral-large-latest，要求列出当前目录文件）
        process.env.FAKE_PI_OUTPUT = [
            JSON.stringify({ type: 'session', version: 3, id: 'x', timestamp: 't', cwd: '/tmp' }),
            JSON.stringify({ type: 'turn_start' }),
            JSON.stringify({
                type: 'message_end',
                message: { role: 'assistant', content: [{ type: 'text', text: '' }, { type: 'toolCall', id: 'c1', name: 'ls', arguments: { path: '/tmp' } }], stopReason: 'toolUse' },
            }),
            JSON.stringify({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'ls', args: { path: '/tmp' } }),
            JSON.stringify({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'ls', result: { content: [{ type: 'text', text: 'a.txt\nb.txt' }] }, isError: false }),
            JSON.stringify({
                type: 'message_end',
                message: { role: 'toolResult', toolCallId: 'c1', toolName: 'ls', content: [{ type: 'text', text: 'a.txt\nb.txt' }], isError: false },
            }),
            JSON.stringify({ type: 'turn_end' }),
            JSON.stringify({ type: 'turn_start' }),
            JSON.stringify({
                type: 'message_end',
                message: { role: 'assistant', content: [{ type: 'text', text: 'Found 2 files.' }], stopReason: 'stop' },
            }),
            JSON.stringify({ type: 'turn_end' }),
            JSON.stringify({ type: 'agent_end', messages: [] }),
        ].join('\n') + '\n';

        const engine = new PiEngine(mockLogger, { binaryPath: fakeBinPath, tools: ['read', 'grep', 'find', 'ls'] });
        const steps = await drain(engine.run('list files', { sessionId: 's3', memory: mockMemory }));

        // message_end(role=toolResult) 应该被跳过（tool_execution_end 已经给了同样的信息），
        // 不产出重复的 observation
        expect(steps.filter(s => s.type === 'observation')).toHaveLength(1);
        const action = steps.find(s => s.type === 'action');
        expect(action?.toolName).toBe('ls');
        expect(action?.toolInput).toEqual({ path: '/tmp' });
        expect(steps.find(s => s.type === 'observation')?.content).toContain('a.txt');
        expect(steps.find(s => s.type === 'content')?.content).toBe('Found 2 files.');
    });

    it('关键坑：认证失败时退出码仍是 0，但 message.stopReason=error 要被检测并抛错（实测确认）', async () => {
        // 真实抓到的 JSONL（用一个明显无效的 API key 触发 401）
        process.env.FAKE_PI_OUTPUT = [
            JSON.stringify({ type: 'session', version: 3, id: 'x', timestamp: 't', cwd: '/tmp' }),
            JSON.stringify({
                type: 'message_end',
                message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Mistral API error (401): {"detail":"Unauthorized"}' },
            }),
            JSON.stringify({ type: 'agent_end', messages: [] }),
        ].join('\n') + '\n';
        process.env.FAKE_PI_EXIT_CODE = '0'; // 显式确认：即使退出码是 0

        const engine = new PiEngine(mockLogger, { binaryPath: fakeBinPath });
        await expect(drain(engine.run('task', { sessionId: 's4', memory: mockMemory })))
            .rejects.toThrow(/Unauthorized|pi reported an error/);
    });

    it('错误场景下仍会 yield answer+meta 步骤（不是只抛错，静默丢失过程信息）', async () => {
        process.env.FAKE_PI_OUTPUT = JSON.stringify({
            type: 'message_end',
            message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'boom' },
        }) + '\n';

        const engine = new PiEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps: ExecutionStep[] = [];
        try {
            for await (const s of engine.run('task', { sessionId: 's5', memory: mockMemory })) steps.push(s);
        } catch {
            // 预期会抛错，这里只关心抛错之前 yield 过的步骤
        }
        expect(steps.some(s => s.type === 'answer' && s.content === 'boom')).toBe(true);
        expect(steps.some(s => s.type === 'meta' && s.content.includes('失败'))).toBe(true);
    });

    it('user/toolResult 角色的 message_end 不产出重复步骤', async () => {
        process.env.FAKE_PI_OUTPUT = [
            JSON.stringify({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
            JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }], stopReason: 'stop' } }),
        ].join('\n') + '\n';
        const engine = new PiEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('task', { sessionId: 's6', memory: mockMemory }));
        expect(steps).toHaveLength(1);
        expect(steps[0]).toMatchObject({ type: 'content', content: 'hello' });
    });

    it('未识别事件类型不静默丢弃，降级为 meta', async () => {
        process.env.FAKE_PI_OUTPUT = JSON.stringify({ type: 'some_future_event', foo: 'bar' }) + '\n';
        const engine = new PiEngine(mockLogger, { binaryPath: fakeBinPath });
        const steps = await drain(engine.run('task', { sessionId: 's7', memory: mockMemory }));
        expect(steps).toHaveLength(1);
        expect(steps[0].content).toContain('some_future_event');
        expect(steps[0].content).toContain('bar');
    });

    it('非零退出码抛错', async () => {
        process.env.FAKE_PI_EXIT_CODE = '1';
        const engine = new PiEngine(mockLogger, { binaryPath: fakeBinPath });
        await expect(drain(engine.run('task', { sessionId: 's8', memory: mockMemory })))
            .rejects.toThrow(/exited with code 1/);
    });

    it('可执行文件不存在时给出清晰错误', async () => {
        const engine = new PiEngine(mockLogger, { binaryPath: path.join(tmpDir, 'does-not-exist') });
        await expect(drain(engine.run('task', { sessionId: 's9', memory: mockMemory })))
            .rejects.toThrow(/未找到/);
    });

    it('abortSignal 触发时终止子进程，不会一直挂起', async () => {
        const slowScript = path.join(tmpDir, 'slow-pi.cjs');
        writeFileSync(slowScript, `#!/usr/bin/env node\nsetTimeout(() => { process.exit(0); }, 30000);\n`);
        chmodSync(slowScript, 0o755);

        const engine = new PiEngine(mockLogger, { binaryPath: slowScript });
        const controller = new AbortController();
        const runPromise = drain(engine.run('task', { sessionId: 's10', memory: mockMemory, abortSignal: controller.signal }));
        controller.abort();
        await expect(runPromise).rejects.toThrow();
    });

    // ─────────────────────────── Resume（两阶段自动化 spec #85，实测记录 #77）───────────────────────────

    describe('resume', () => {
        it('传入 resumeToken 时 CLI 参数包含 --session-dir 与 --session', async () => {
            const argsFile = path.join(tmpDir, 'resume-args.json');
            process.env.FAKE_PI_ARGS_FILE = argsFile;
            process.env.FAKE_PI_OUTPUT = JSON.stringify({
                type: 'message_end',
                message: { role: 'assistant', content: [{ type: 'text', text: '紫色大象88' }], stopReason: 'stop' },
            }) + '\n';
            const engine = new PiEngine(mockLogger, { binaryPath: fakeBinPath, provider: 'mistral', model: 'devstral-medium-latest' });
            await drain(engine.run('刚才的暗号是什么？', { sessionId: 'sr1', memory: mockMemory, cwd: tmpDir, resumeToken: '019f5548-b50a-abcd' }));
            const args = JSON.parse(readFileSync(argsFile, 'utf-8'));
            expect(args).toEqual([
                '--mode', 'json', '-p',
                '--provider', 'mistral', '--model', 'devstral-medium-latest',
                '--session-dir', path.join(tmpDir, '.cmaster-pi-sessions'),
                '--session', '019f5548-b50a-abcd',
                '刚才的暗号是什么？',
            ]);
        });

        it('resumeToken 直接取自首行 session 事件的 id 字段，无需扫目录反查', async () => {
            process.env.FAKE_PI_OUTPUT = [
                JSON.stringify({ type: 'session', version: 3, id: '019f5548-real-session', timestamp: 't', cwd: tmpDir }),
                JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' } }),
            ].join('\n') + '\n';
            const engine = new PiEngine(mockLogger, { binaryPath: fakeBinPath });
            const steps = await drain(engine.run('task', { sessionId: 'sr2', memory: mockMemory, cwd: tmpDir }));
            expect(steps.find(s => s.resumeToken)?.resumeToken).toBe('019f5548-real-session');
        });

        it('--session 传伪 id 时 pi 显式 exit 1 + stderr「No session found」，透传为可判的错误', async () => {
            const stderrScript = path.join(tmpDir, 'fake-pi-stderr.cjs');
            writeFileSync(stderrScript, `#!/usr/bin/env node
process.stderr.write("No session found matching '00000000-stale'");
process.exitCode = 1;
`);
            chmodSync(stderrScript, 0o755);
            const engine = new PiEngine(mockLogger, { binaryPath: stderrScript });
            await expect(drain(engine.run('task', {
                sessionId: 'sr3', memory: mockMemory, cwd: tmpDir, resumeToken: '00000000-stale',
            }))).rejects.toThrow(/No session found/);
        });
    });
});
