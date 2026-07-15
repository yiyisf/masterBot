/**
 * OpenCodeEngine — 基于 opencode CLI 的执行引擎（研发流程管理模块，spec §5.3）
 *
 * 驱动方式：`opencode run --format json`（一次性非交互模式，headless/结构化输出）。
 *
 * 范围决策（实施地图 #61 ticket #66）：spec §5.3 原本设想 opencode 走 `opencode serve`
 * HTTP API / ACP 的"server 双向通道"实现可编程审批（interactiveApproval: true）。真实
 * 二进制实测后改为 v1 先用更简单的一次性非交互模式（`opencode run`），与 claude-code/codex
 * 引擎保持一致的 spawn+readline 架构；`opencode serve` 的持久服务 + HTTP/SSE 双向通道是
 * 明显更大的工程量，留作后续增强。因此 v1 capabilities.interactiveApproval = false，
 * 与 codex 一致做显式降级，不是"忘了实现"。
 *
 * 实测记录：用 opencode CLI 1.1.25、免费网关模型（`opencode/<model>-free`，零成本零认证）
 * 跑出了完整成功路径，包括一次真实工具调用（glob）：
 * - JSONL 每行是扁平信封：`{"type": "<event-type>", "timestamp": <ms>, "sessionID": "...",
 *   "part": {...}}`（`error` 事件例外，没有 `part` 字段，见下）。
 * - `step_start` / `step_finish`：`part.type` 分别是 `"step-start"` / `"step-finish"`；
 *   `step_finish` 带 `part.reason`（如 `"stop"`/`"tool-calls"`）、`part.cost`、`part.tokens`。
 * - `text`：`part.text` 是完整文本（非增量 delta）。
 * - `tool_use`：`part.type === "tool"`，`part.tool`（工具名，如 `"glob"`）、`part.callID`、
 *   `part.state: { status, input, output, title, metadata, time }`——input/output/完成状态
 *   都在同一条事件里，不是"开始"/"结束"两条分开的事件。
 * - `error`（认证失败等场景实测确认）：`{"type":"error","timestamp":...,"sessionID":...,
 *   "error":{"name":"APIError","data":{"message":...,"statusCode":...}}}`，无 `part` 字段。
 * - 进程退出码：成功 0，认证/模型错误时非 0（沿用"非零退出码即失败"的通用判定）。
 *
 * 真实使用中发现的 bug（研发流程管理 ticket #67 联调反馈，非本文件原实测环境能复现——
 * 复现环境本机后台已有一个 opencode server/session 在跑）：opencode 是 daemon 式架构，
 * `opencode run` 可能自动发现并复用本机已在跑的 server，而不是在给定 cwd 里新起一个；
 * 此时 `child_process.spawn()` 的 `cwd` 选项只影响新 spawn 出来的这个客户端进程，管不到
 * 被复用的那个 server 进程，导致实际操作目录/需求都不对。修复：显式传 `--dir <cwd>`，
 * 不管是新起的还是被复用的 server，都会被这个参数正确定向。
 *
 * Resume 接入（两阶段自动化 spec #85，实测记录见地图 ticket #76，opencode CLI 1.17.18）：
 * - resumeToken 就是 JSONL 每行都带的顶层 `sessionID`，无需像 codex 那样反查文件，运行中
 *   捕获第一行出现的即可。
 * - resume 命令：`opencode run --session <id>`，**必须复用首轮相同的 `--dir`**。
 * - **关键坑**：resume 时 `--dir` 与会话原目录不一致会导致进程无输出、无报错地挂死
 *   （非 daemon 复用场景实测复现）。伪造 id 会显式报错（`Session not found`），这点比 codex
 *   更友好；但目录不一致这个坑报错机制救不了，只能靠进程级看门狗兜底——resume 场景下若
 *   watchdogMs 内收不到任何一行输出，主动 kill 并抛出清晰错误。
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { ExecutionStep, Logger } from '../../types.js';
import type { IAgentEngine, EngineRunContext, EngineCapabilities } from './agent-engine.js';

export interface OpenCodeEngineOptions {
    /** 工作目录（默认 process.cwd()）*/
    cwd?: string;
    /** opencode 可执行文件路径/名（默认 'opencode'；测试用可注入 fake 脚本）*/
    binaryPath?: string;
    /** provider/model，格式 "provider/model"（默认由 opencode 自身配置决定）*/
    model?: string;
    /** resume 场景下的看门狗超时（ms，默认 120000）：目录不一致会挂死且不报错，只能靠超时兜底 */
    resumeWatchdogMs?: number;
}

interface OpenCodePart {
    type: string;
    text?: string;
    tool?: string;
    callID?: string;
    state?: { status: string; input?: unknown; output?: string; title?: string; [key: string]: unknown };
    reason?: string;
    cost?: number;
    tokens?: unknown;
    [key: string]: unknown;
}

interface OpenCodeJsonLine {
    type: string;
    timestamp?: number;
    sessionID?: string;
    part?: OpenCodePart;
    error?: { name?: string; data?: { message?: string; statusCode?: number; [key: string]: unknown } };
    [key: string]: unknown;
}

export class OpenCodeEngine implements IAgentEngine {
    readonly kind = 'opencode' as const;
    // v1 用一次性非交互模式（opencode run），无编程式转人工接口；opencode serve 的双向
    // 通道留作后续增强（见文件头注释）；不做 PTY 文本匹配兜底。
    // resume=true：接 opencode 原生 --session 续接（见文件头注释，实测记录 #76）
    readonly capabilities: EngineCapabilities = { interactiveApproval: false, resume: true };

    constructor(private logger: Logger, private options: OpenCodeEngineOptions = {}) {}

    async *run(input: string, context: EngineRunContext): AsyncGenerator<ExecutionStep> {
        const cwd = context.cwd ?? this.options.cwd ?? process.cwd();
        const binary = this.options.binaryPath ?? 'opencode';
        // 真实使用中发现：opencode 会自动发现/复用本机已在跑的 opencode server（daemon 式架构），
        // 此时新 spawn 的进程只是连去那个已有 server，spawn() 的 cwd 选项管不到它——
        // 必须显式传 --dir 告诉（新起的或被复用的）server 用哪个目录，不能只依赖进程级 cwd。
        // resume 时必须复用首轮相同的 --dir（目录不一致会挂死，见文件头注释）。
        const args = ['run', '--format', 'json', '--dir', cwd];
        if (context.resumeToken) args.push('--session', context.resumeToken);
        if (this.options.model) args.push('-m', this.options.model);
        args.push(input);

        this.logger.info(`[opencode-engine] Starting "${binary} run"${context.resumeToken ? ' --session' : ''} (cwd: ${cwd})`);

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
            spawnError = err.code === 'ENOENT'
                ? new Error(`无法启动 opencode（可执行文件 "${binary}" 未找到，或工作目录不存在：${cwd}）`)
                : err;
        });

        let exitCode: number | null = null;
        let exitSignal: NodeJS.Signals | null = null;
        const closePromise = new Promise<void>((resolve) => {
            child.on('close', (code, signal) => { exitCode = code; exitSignal = signal; resolve(); });
        });

        // resume 场景专属看门狗：目录不一致时进程无输出无报错地挂死（实测确认），报错机制救不了，
        // 只能靠"多久没收到一行输出就主动判定为挂死"兜底。首轮（无 resumeToken）不受影响。
        let watchdogTimedOut = false;
        let watchdogTimer: NodeJS.Timeout | undefined;
        const armWatchdog = () => {
            if (!context.resumeToken) return;
            clearTimeout(watchdogTimer);
            watchdogTimer = setTimeout(() => {
                watchdogTimedOut = true;
                child.kill();
            }, this.options.resumeWatchdogMs ?? 120_000);
        };
        armWatchdog();

        let resumeToken: string | undefined;

        if (child.stdout) {
            const rl = createInterface({ input: child.stdout });
            try {
                for await (const line of rl) {
                    armWatchdog();
                    if (!line.trim()) continue;
                    if (!resumeToken) resumeToken = this._extractSessionId(line);
                    yield* this._translateLine(line);
                }
            } finally {
                rl.close();
            }
        }

        await closePromise;
        clearTimeout(watchdogTimer);
        if (context.abortSignal) context.abortSignal.removeEventListener('abort', onAbort);

        if (watchdogTimedOut) {
            throw new Error(`opencode resume 挂死：${this.options.resumeWatchdogMs ?? 120_000}ms 内无任何输出（很可能是 --dir 与会话原目录不一致导致进程无输出无报错地挂死，见 opencode-engine.ts 文件头注释）`);
        }
        if (spawnError) throw spawnError;
        if (exitSignal) {
            throw new Error(`opencode run terminated by signal ${exitSignal}${context.abortSignal?.aborted ? ' (aborted)' : ''}`);
        }
        if (exitCode !== 0) {
            throw new Error(`opencode run exited with code ${exitCode}${stderrBuf ? `: ${stderrBuf.slice(0, 500)}` : ''}`);
        }

        if (resumeToken) {
            yield { type: 'meta', content: '💾 opencode 会话已记录，可续接', resumeToken, timestamp: new Date() };
        }
    }

    private _extractSessionId(raw: string): string | undefined {
        try {
            const parsed = JSON.parse(raw) as OpenCodeJsonLine;
            return typeof parsed.sessionID === 'string' ? parsed.sessionID : undefined;
        } catch {
            return undefined;
        }
    }

    // ─────────────────────────────── private ───────────────────────────────

    private *_translateLine(raw: string): Generator<ExecutionStep> {
        let parsed: OpenCodeJsonLine;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return; // 非 JSON 行容错跳过
        }

        const now = () => new Date();

        // error 事件没有 part 包装（实测确认）
        if (parsed.type === 'error') {
            const message = parsed.error?.data?.message ?? parsed.error?.name ?? '未知错误';
            yield { type: 'answer', content: String(message), timestamp: now() };
            yield { type: 'meta', content: '❌ opencode 执行失败', timestamp: now() };
            return;
        }

        const part = parsed.part;
        if (!part) {
            // 未识别的无 part 事件：降级为 meta 透出，不静默丢弃
            yield { type: 'meta', content: `[opencode:${parsed.type}] ${JSON.stringify(parsed).slice(0, 500)}`, timestamp: now() };
            return;
        }

        switch (part.type) {
            case 'step-start':
                break; // 纯流程标记，不产出用户可见步骤

            case 'text':
                if (typeof part.text === 'string' && part.text.length > 0) {
                    yield { type: 'content', content: part.text, timestamp: now() };
                }
                break;

            case 'tool': {
                // input/output/完成状态在同一条事件里（实测确认，与 Claude SDK 的
                // action+observation 两步分开不同），这里拆成 action + observation 两个
                // ExecutionStep 以复用前端既有的渲染逻辑
                const toolName = part.tool ?? 'unknown';
                const state = part.state ?? { status: 'unknown' };
                yield {
                    type: 'action',
                    content: `调用 ${toolName}`,
                    toolName,
                    toolInput: (state.input as Record<string, unknown>) ?? {},
                    timestamp: now(),
                };
                if (state.status === 'completed') {
                    const out = String(state.output ?? '');
                    yield {
                        type: 'observation',
                        content: out.length > 2000 ? out.slice(0, 2000) + `\n...[截断，共 ${out.length} 字符]` : out,
                        timestamp: now(),
                    };
                } else if (state.status === 'error') {
                    yield { type: 'observation', content: `❌ 工具执行失败：${String(state.output ?? '')}`, timestamp: now() };
                }
                break;
            }

            case 'step-finish':
                if (part.reason && part.reason !== 'tool-calls') {
                    yield { type: 'meta', content: `✅ opencode 步骤完成（${part.reason}）`, timestamp: now() };
                }
                break;

            default:
                yield { type: 'meta', content: `[opencode:${part.type}] ${JSON.stringify(part).slice(0, 500)}`, timestamp: now() };
        }
    }
}
