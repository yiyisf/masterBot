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
    // 通道留作后续增强（见文件头注释）；不做 PTY 文本匹配兜底；v1 无 resume
    readonly capabilities: EngineCapabilities = { interactiveApproval: false, resume: false };

    constructor(private logger: Logger, private options: OpenCodeEngineOptions = {}) {}

    async *run(input: string, context: EngineRunContext): AsyncGenerator<ExecutionStep> {
        const cwd = context.cwd ?? this.options.cwd ?? process.cwd();
        const binary = this.options.binaryPath ?? 'opencode';
        const args = ['run', '--format', 'json'];
        if (this.options.model) args.push('-m', this.options.model);
        args.push(input);

        this.logger.info(`[opencode-engine] Starting "${binary} run" (cwd: ${cwd})`);

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
            throw new Error(`opencode run terminated by signal ${exitSignal}${context.abortSignal?.aborted ? ' (aborted)' : ''}`);
        }
        if (exitCode !== 0) {
            throw new Error(`opencode run exited with code ${exitCode}${stderrBuf ? `: ${stderrBuf.slice(0, 500)}` : ''}`);
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
