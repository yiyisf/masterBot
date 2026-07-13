/**
 * CodexEngine — 基于 codex CLI 的执行引擎（研发流程管理模块，spec §5.3/§5.5）
 *
 * 驱动方式：`codex exec --json`（headless/结构化输出模式，非 PTY 全交互黑盒）。
 *
 * 实测记录（实施地图 #61 ticket #65）：
 *
 * 第一轮，用真实 codex-cli 0.39.0 二进制、aicoding provider（测试账号无 API 额度，
 * 402 Payment Required，只跑出了启动失败路径）：
 * - `codex exec --help` 不暴露 `-a/--ask-for-approval`（该参数只在交互式顶层 `codex` 命令下有效），
 *   非交互模式本就没有"运行中途转人工"的编程接口——印证 capabilities.interactiveApproval = false。
 * - `--json` 输出的 JSONL 里，前两行是配置回显（含 model/workdir/sandbox 等字段，无 `msg` 包装）
 *   和 prompt 回显（`{"prompt": "..."}`，同样无 `msg` 包装）；之后每行是
 *   `{"id": "<turn-id>", "msg": {"type": "<event-type>", ...}}` 的信封。
 * - 确认 `msg.type`：`task_started`（带 `model_context_window`，可能是 null）、`stream_error`
 *   （瞬时重试，非终态失败）、`error`（终态失败）。
 *
 * 第二轮，改用 `-c model_provider` 覆写指向一个 OpenAI 协议兼容、有真实额度的 provider
 * （用户在 PR review 里指出并授权），跑出了完整的成功路径：
 * - 确认 `agent_message`：`{"type":"agent_message","message":"pong"}`——字段名与第一轮的推断一致。
 * - 确认 `token_count`：`{"type":"token_count","info":null}`——纯用量信息，不产出用户可见步骤。
 * - **没有观察到 `task_complete` 事件**：成功路径就是 `task_started` → `agent_message` →
 *   `token_count`，随后进程直接退出（exit code 0）——完成由进程退出信号，不是靠专门的事件。
 *   下面仍保留 `task_complete` 分支作为兜底（万一更复杂/多轮场景里真的会出现），但不是必经路径。
 * - `agent_reasoning`/`exec_command_begin`/`exec_command_end` 仍未观察到（这次的 prompt 刻意
 *   要求不调用任何工具），字段名沿用第一轮基于 Codex 协议一般认知的推断，未经实测确认。
 * `_translateLine()` 对任何未识别的 `msg.type` 一律降级为 meta 步骤透出原始 payload（不静默
 * 丢弃），后续如与推断不符，据此调整映射即可，不影响整体骨架。
 *
 * 防御性修复（研发流程管理 ticket #67 联调时在 opencode 引擎上真实踩中同一类 bug 后回头排查）：
 * `codex exec --help` 同样暴露 `-C/--cd <DIR>`（"Tell the agent to use the specified
 * directory as its working root"），说明 codex 内部可能不是单纯依赖进程级 cwd 判定工作目录。
 * 之前只靠 `child_process.spawn()` 的 `cwd` 选项，现在显式加上 `-C`，两边双保险。
 *
 * Resume 接入（两阶段自动化 spec #85，实测记录见地图 ticket #75）：
 * - `--json` 输出**不含**会话 id；id 只在 `~/.codex/sessions/<yyyy/mm/dd>/rollout-*-<uuid>.jsonl`
 *   的文件名（或文件首行 `session_meta.payload.id`）里，run() 结束后按 cwd 匹配 + 时间窗反查。
 * - resume 命令形态：所有 flags 必须在 `resume` 子命令**之前**，形如
 *   `codex exec --json --sandbox <mode> -C <cwd> resume <uuid> "<prompt>"`；resume 轮 sandbox
 *   默认回显 read-only，必须显式重传 `--sandbox`。
 * - **关键坑**：传入不存在的 uuid 不报错——exit 0，静默新建一个不带上下文的新会话。
 *   本引擎在使用调用方传入的 resumeToken 前会先校验对应 rollout 文件是否存在，不存在则
 *   直接抛错，不让"丢现场"被误判为"续接成功"。
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { readdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import type { ExecutionStep, Logger } from '../../types.js';
import type { IAgentEngine, EngineRunContext, EngineCapabilities } from './agent-engine.js';

export interface CodexEngineOptions {
    /** 工作目录（默认 process.cwd()）*/
    cwd?: string;
    /** codex 可执行文件路径/名（默认 'codex'；测试用可注入 fake 脚本）*/
    binaryPath?: string;
    /** 沙箱策略（默认 workspace-write，与 spec §5.3 一致）*/
    sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
    /** `~/.codex/sessions` 根目录覆盖（测试用，指向临时目录）*/
    sessionsRoot?: string;
}

interface CodexJsonLine {
    msg?: { type: string; [key: string]: unknown };
    model?: string;
    workdir?: string;
    sandbox?: string;
    [key: string]: unknown;
}

export class CodexEngine implements IAgentEngine {
    readonly kind = 'codex' as const;
    // codex exec 非交互模式无编程式转人工的接口（-a/--ask-for-approval 只在交互式顶层命令下有效，
    // 已实测确认 `codex exec --help` 不暴露该参数）；不做 PTY 文本匹配兜底（spec §5.5）。
    // resume=true：接 codex 原生会话续接（见文件头注释，实测记录 #75）
    readonly capabilities: EngineCapabilities = { interactiveApproval: false, resume: true };

    constructor(private logger: Logger, private options: CodexEngineOptions = {}) {}

    private get sessionsRoot(): string {
        return this.options.sessionsRoot ?? path.join(os.homedir(), '.codex', 'sessions');
    }

    async *run(input: string, context: EngineRunContext): AsyncGenerator<ExecutionStep> {
        const cwd = context.cwd ?? this.options.cwd ?? process.cwd();
        const binary = this.options.binaryPath ?? 'codex';
        const sandbox = this.options.sandbox ?? 'workspace-write';

        // 续接：resumeToken 必须先校验 rollout 文件仍存在，否则 codex 会静默新建一个不带
        // 上下文的新会话（exit 0，无任何报错信号）——那样"丢现场"会被误判为"续接成功"。
        if (context.resumeToken) {
            const exists = await this._rolloutFileExists(context.resumeToken);
            if (!exists) {
                throw new Error(`codex resume 失败：会话 ${context.resumeToken} 对应的 rollout 文件不存在（可能已被清理），无法安全续接`);
            }
        }

        // -C/--cd 显式声明"working root"（同一类问题在 opencode 引擎上被真实用例踩中过：
        // 只靠 spawn() 的 cwd 选项，工具自己内部的目录解析可能不认——codex --help 里这个参数
        // 的说明原文就是 "Tell the agent to use the specified directory as its working root"）。
        // resume 子命令的 flags 必须前置（含 --sandbox，resume 轮默认回显 read-only 必须重传）。
        const configFlags = ['--json', '--sandbox', sandbox, '--skip-git-repo-check', '-C', cwd];
        const args = context.resumeToken
            ? ['exec', ...configFlags, 'resume', context.resumeToken, input]
            : ['exec', ...configFlags, input];
        const runStartedAt = Date.now();

        this.logger.info(`[codex-engine] Starting "${binary} exec${context.resumeToken ? ' resume' : ''}" (cwd: ${cwd}, sandbox: ${sandbox})`);

        const child = spawn(binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

        const onAbort = () => child.kill();
        if (context.abortSignal) {
            if (context.abortSignal.aborted) child.kill();
            else context.abortSignal.addEventListener('abort', onAbort, { once: true });
        }

        let stderrBuf = '';
        child.stderr?.on('data', (d: Buffer) => { stderrBuf += d.toString('utf-8'); });

        let spawnError: Error | undefined;
        child.on('error', (err: NodeJS.ErrnoException) => {
            // ENOENT 在这里可能是 codex 二进制未找到，也可能是 cwd 本身不存在（worktree 被意外删除）
            spawnError = err.code === 'ENOENT'
                ? new Error(`无法启动 codex（可执行文件 "${binary}" 未找到，或工作目录不存在：${cwd}）`)
                : err;
        });

        // 先挂 close 监听再开始读 stdout，避免子进程在读完之前就已退出导致的竞态。
        // 被信号杀死（如 abort 触发 kill()）时 code 是 null、signal 非空——不能用 `code ?? 0`
        // 简单归零，否则会把"被中止"误判为"正常退出成功"。
        let exitCode: number | null = null;
        let exitSignal: NodeJS.Signals | null = null;
        const closePromise = new Promise<void>((resolve) => {
            child.on('close', (code, signal) => { exitCode = code; exitSignal = signal; resolve(); });
        });

        if (child.stdout) {
            const rl = createInterface({ input: child.stdout });
            try {
                for await (const line of rl) {
                    if (!line.trim()) continue;
                    yield* this._translateLine(line);
                }
            } finally {
                rl.close();
            }
        }

        await closePromise;
        if (context.abortSignal) context.abortSignal.removeEventListener('abort', onAbort);

        if (spawnError) throw spawnError;
        if (exitSignal) {
            throw new Error(`codex exec terminated by signal ${exitSignal}${context.abortSignal?.aborted ? ' (aborted)' : ''}`);
        }
        if (exitCode !== 0) {
            throw new Error(`codex exec exited with code ${exitCode}${stderrBuf ? `: ${stderrBuf.slice(0, 500)}` : ''}`);
        }

        // 成功结束后反查本轮 rollout uuid 作为 resumeToken（--json 输出本身不含会话 id）
        const resumeToken = await this._findResumeToken(cwd, runStartedAt);
        if (resumeToken) {
            yield { type: 'meta', content: '💾 codex 会话已记录，可续接', resumeToken, timestamp: new Date() };
        }
    }

    // ─────────────────────────────── private ───────────────────────────────

    /** 按 cwd + 时间窗扫描 sessions 目录，反查本轮 run 对应的 rollout uuid */
    private async _findResumeToken(cwd: string, sinceMs: number): Promise<string | undefined> {
        try {
            const candidates = await this._listRolloutFiles();
            let best: { file: string; mtime: number; id: string } | undefined;
            for (const file of candidates) {
                let st;
                try {
                    st = await stat(file);
                } catch { continue; }
                if (st.mtimeMs < sinceMs - 2000) continue; // 允许 2s 时钟误差
                const meta = await this._readSessionMeta(file);
                if (!meta || meta.cwd !== cwd) continue;
                if (!best || st.mtimeMs > best.mtime) best = { file, mtime: st.mtimeMs, id: meta.id };
            }
            return best?.id;
        } catch {
            return undefined; // best-effort：反查失败不影响主流程（下轮就没有 resume 能力而已）
        }
    }

    /** 校验调用方传入的 resumeToken 对应的 rollout 文件是否仍存在（伪 id 防御） */
    private async _rolloutFileExists(resumeToken: string): Promise<boolean> {
        const candidates = await this._listRolloutFiles();
        return candidates.some(f => f.includes(resumeToken));
    }

    private async _listRolloutFiles(): Promise<string[]> {
        const root = this.sessionsRoot;
        if (!existsSync(root)) return [];
        const results: string[] = [];
        const walk = async (dir: string, depth: number) => {
            let entries;
            try {
                entries = await readdir(dir, { withFileTypes: true });
            } catch { return; }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory() && depth < 3) await walk(full, depth + 1);
                else if (entry.isFile() && entry.name.endsWith('.jsonl')) results.push(full);
            }
        };
        await walk(root, 0);
        return results;
    }

    private async _readSessionMeta(file: string): Promise<{ id: string; cwd: string } | undefined> {
        try {
            const content = await readFile(file, 'utf-8');
            const firstLine = content.split('\n', 1)[0];
            if (!firstLine) return undefined;
            const parsed = JSON.parse(firstLine);
            if (parsed?.type === 'session_meta' && parsed?.payload?.id && parsed?.payload?.cwd) {
                return { id: parsed.payload.id, cwd: parsed.payload.cwd };
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    private *_translateLine(raw: string): Generator<ExecutionStep> {
        let parsed: CodexJsonLine;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return; // --json 模式下不应出现非 JSON 行；容错跳过而非整体失败
        }

        const now = () => new Date();

        // 前两行（配置回显 / prompt 回显）没有 msg 包装（实测确认）
        if (!parsed.msg) {
            if (parsed.workdir !== undefined || parsed.sandbox !== undefined) {
                yield {
                    type: 'meta',
                    content: `🚀 codex 会话已启动（model: ${parsed.model ?? '-'}, sandbox: ${parsed.sandbox ?? '-'}）`,
                    timestamp: now(),
                };
            }
            return;
        }

        const msg = parsed.msg;
        switch (msg.type) {
            // ── 已用真实二进制验证（两轮实测，见文件头注释）──
            case 'task_started':
                yield { type: 'meta', content: `codex 任务已启动（context window: ${msg.model_context_window ?? '-'}）`, timestamp: now() };
                break;

            case 'stream_error':
                // 瞬时重试（内部已在重试），非终态失败，不中断执行
                yield { type: 'meta', content: `⚠️ codex 流错误（重试中）：${String(msg.message ?? '')}`, timestamp: now() };
                break;

            case 'error':
                yield { type: 'answer', content: String(msg.message ?? '未知错误'), timestamp: now() };
                yield { type: 'meta', content: '❌ codex 执行失败', timestamp: now() };
                break;

            case 'agent_message':
                if (typeof msg.message === 'string') {
                    yield { type: 'content', content: msg.message, timestamp: now() };
                }
                break;

            case 'token_count':
                break; // 纯用量信息，不产出用户可见步骤

            // ── 未用真实二进制验证，基于 Codex 协议一般认知推断（见文件头注释）──
            case 'agent_message_delta':
                if (typeof msg.message === 'string') {
                    yield { type: 'content', content: msg.message, timestamp: now() };
                }
                break;

            case 'agent_reasoning':
            case 'agent_reasoning_delta':
                if (typeof msg.text === 'string') {
                    yield { type: 'thought', content: msg.text, timestamp: now() };
                }
                break;

            case 'exec_command_begin': {
                const command = Array.isArray(msg.command) ? msg.command.join(' ') : String(msg.command ?? '');
                yield {
                    type: 'action',
                    content: `执行命令：${command}`,
                    toolName: 'Bash',
                    toolInput: { command },
                    timestamp: now(),
                };
                break;
            }

            case 'exec_command_end': {
                const out = String(msg.stdout ?? msg.output ?? '');
                yield {
                    type: 'observation',
                    content: out.length > 2000 ? out.slice(0, 2000) + `\n...[截断，共 ${out.length} 字符]` : out,
                    timestamp: now(),
                };
                break;
            }

            // 实测的成功路径里没有出现过这个事件（进程直接退出表示完成）；保留作为兜底，
            // 以防更复杂/多轮场景里真的会有一个显式的完成事件
            case 'task_complete':
                yield { type: 'answer', content: String(msg.last_agent_message ?? msg.message ?? ''), timestamp: now() };
                yield { type: 'meta', content: '✅ codex 会话完成', timestamp: now() };
                break;

            default:
                // 未识别的事件类型：不静默丢弃，以 meta 形式透出原始 payload
                yield { type: 'meta', content: `[codex:${msg.type}] ${JSON.stringify(msg).slice(0, 500)}`, timestamp: now() };
        }
    }
}
