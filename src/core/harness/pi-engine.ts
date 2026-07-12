/**
 * PiEngine — 基于 pi (@earendil-works/pi-coding-agent) CLI 的执行引擎
 * （研发流程管理模块，spec §5.3）
 *
 * 驱动方式：`pi --mode json -p`（一次性非交互模式：`-p/--print` 处理完 prompt 就退出）。
 *
 * 范围决策（实施地图 #61 ticket #66）：spec §5.3 原本设想 pi 走 `--mode rpc`（JSON-RPC 2.0
 * over stdio）的双向协议实现可编程审批（interactiveApproval: true）。真实二进制实测后
 * 改为 v1 先用更简单的一次性非交互模式（`--mode json -p`），与 claude-code/codex/opencode
 * 引擎保持一致的 spawn+readline 架构；`--mode rpc` 的双向通道是明显更大的工程量，留作后续
 * 增强。因此 v1 capabilities.interactiveApproval = false，与 codex/opencode 一致做显式降级。
 *
 * 实测记录：用 pi CLI 0.80.6 + Mistral（用户在 PR review 里指出并授权的凭证）跑出了完整
 * 成功路径，包括一次真实工具调用（ls）和一次真实认证失败：
 * - JSONL 每行是扁平信封，无统一包装，字段随 `type` 变化。
 * - `session`：`{type:"session", version, id, timestamp, cwd}`，会话开始。
 * - `message_start`/`message_end`（`message.role`）：user/assistant/toolResult 三种角色都会
 *   经过这两个事件；`message_update`（`assistantMessageEvent.type`: text_start/text_delta/
 *   text_end/toolcall_start/toolcall_delta/toolcall_end）是流式增量，为避免逐字符刷屏噪音，
 *   只消费 `message_end` 里的最终内容，不逐条转译 `message_update`。
 * - **关键坑（实测确认）**：pi 的进程退出码在 API 认证失败等场景下仍然是 0——失败信号
 *   藏在 assistant `message_end` 的 `message.stopReason === "error"` +
 *   `message.errorMessage` 里，不是靠非零退出码/顶层 error 事件。必须显式检测这个字段，
 *   在 run() 结束时补抛异常，否则调用方（RequirementExecutionService）会把失败误判为成功。
 * - `tool_execution_start` / `tool_execution_end`：`{type, toolCallId, toolName, args}` /
 *   `{type, toolCallId, toolName, result:{content:[{type:"text",text}]}, isError}`——比
 *   `message_update` 里的 toolcall_* 增量事件干净得多，直接用这一对映射 action/observation。
 * - `agent_end`：整个 agent 循环结束（可能包含多个 turn），携带完整 `messages[]`；只用作
 *   收尾标记，不重复提取内容（已经在各个 message_end 里发过了）。
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { ExecutionStep, Logger } from '../../types.js';
import type { IAgentEngine, EngineRunContext, EngineCapabilities } from './agent-engine.js';

export interface PiEngineOptions {
    /** 工作目录（默认 process.cwd()）*/
    cwd?: string;
    /** pi 可执行文件路径/名（默认 'pi'；测试用可注入 fake 脚本）*/
    binaryPath?: string;
    /** provider 名（如 'anthropic'/'mistral'；默认由 pi 自身配置/环境变量决定）*/
    provider?: string;
    /** 模型 ID/pattern */
    model?: string;
    /** 工具白名单（默认不传，使用 pi 默认工具集：read/bash/edit/write）*/
    tools?: string[];
}

interface PiTextContentPart {
    type: 'text';
    text: string;
}

interface PiToolCallContentPart {
    type: 'toolCall';
    id: string;
    name: string;
    arguments: unknown;
}

interface PiMessage {
    role: 'user' | 'assistant' | 'toolResult';
    content?: Array<PiTextContentPart | PiToolCallContentPart>;
    stopReason?: string;
    errorMessage?: string;
    toolName?: string;
    isError?: boolean;
}

interface PiJsonLine {
    type: string;
    message?: PiMessage;
    toolCallId?: string;
    toolName?: string;
    args?: unknown;
    result?: { content?: Array<{ type: string; text?: string }> };
    isError?: boolean;
    cwd?: string;
    [key: string]: unknown;
}

interface TranslateState {
    hasError: boolean;
    errorMessage?: string;
}

export class PiEngine implements IAgentEngine {
    readonly kind = 'pi' as const;
    // v1 用一次性非交互模式（--mode json -p），无编程式转人工接口；--mode rpc 的双向
    // 通道留作后续增强（见文件头注释）；不做 PTY 文本匹配兜底；v1 无 resume
    readonly capabilities: EngineCapabilities = { interactiveApproval: false, resume: false };

    constructor(private logger: Logger, private options: PiEngineOptions = {}) {}

    async *run(input: string, context: EngineRunContext): AsyncGenerator<ExecutionStep> {
        const cwd = context.cwd ?? this.options.cwd ?? process.cwd();
        const binary = this.options.binaryPath ?? 'pi';
        const args = ['--mode', 'json', '-p'];
        if (this.options.provider) args.push('--provider', this.options.provider);
        if (this.options.model) args.push('--model', this.options.model);
        if (this.options.tools && this.options.tools.length > 0) args.push('--tools', this.options.tools.join(','));
        args.push(input);

        this.logger.info(`[pi-engine] Starting "${binary} -p" (cwd: ${cwd})`);

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
                ? new Error(`无法启动 pi（可执行文件 "${binary}" 未找到，或工作目录不存在：${cwd}）`)
                : err;
        });

        let exitCode: number | null = null;
        let exitSignal: NodeJS.Signals | null = null;
        const closePromise = new Promise<void>((resolve) => {
            child.on('close', (code, signal) => { exitCode = code; exitSignal = signal; resolve(); });
        });

        const state: TranslateState = { hasError: false };

        if (child.stdout) {
            const rl = createInterface({ input: child.stdout });
            try {
                for await (const line of rl) {
                    if (!line.trim()) continue;
                    yield* this._translateLine(line, state);
                }
            } finally {
                rl.close();
            }
        }

        await closePromise;
        if (context.abortSignal) context.abortSignal.removeEventListener('abort', onAbort);

        if (spawnError) throw spawnError;
        if (exitSignal) {
            throw new Error(`pi terminated by signal ${exitSignal}${context.abortSignal?.aborted ? ' (aborted)' : ''}`);
        }
        if (exitCode !== 0) {
            throw new Error(`pi exited with code ${exitCode}${stderrBuf ? `: ${stderrBuf.slice(0, 500)}` : ''}`);
        }
        // 关键：pi 认证失败等场景下退出码仍是 0，失败信号只在消息体里，需要显式检测（见文件头注释）
        if (state.hasError) {
            throw new Error(`pi reported an error: ${state.errorMessage ?? 'unknown error'}`);
        }
    }

    // ─────────────────────────────── private ───────────────────────────────

    private *_translateLine(raw: string, state: TranslateState): Generator<ExecutionStep> {
        let parsed: PiJsonLine;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return; // 非 JSON 行容错跳过
        }

        const now = () => new Date();

        switch (parsed.type) {
            case 'session':
                yield { type: 'meta', content: `🚀 pi 会话已启动（cwd: ${parsed.cwd ?? '-'}）`, timestamp: now() };
                break;

            case 'message_end': {
                const message = parsed.message;
                if (!message || message.role !== 'assistant') break; // user/toolResult 已由其他事件覆盖

                if (message.stopReason === 'error') {
                    state.hasError = true;
                    state.errorMessage = message.errorMessage;
                    yield { type: 'answer', content: message.errorMessage ?? '未知错误', timestamp: now() };
                    yield { type: 'meta', content: '❌ pi 执行失败', timestamp: now() };
                    break;
                }

                const text = (message.content ?? [])
                    .filter((c): c is PiTextContentPart => c.type === 'text')
                    .map(c => c.text)
                    .join('');
                if (text.length > 0) {
                    yield { type: 'content', content: text, timestamp: now() };
                }
                break;
            }

            case 'tool_execution_start':
                yield {
                    type: 'action',
                    content: `调用 ${parsed.toolName ?? 'unknown'}`,
                    toolName: parsed.toolName,
                    toolInput: (parsed.args as Record<string, unknown>) ?? {},
                    timestamp: now(),
                };
                break;

            case 'tool_execution_end': {
                const text = (parsed.result?.content ?? [])
                    .filter(c => c.type === 'text' && typeof c.text === 'string')
                    .map(c => c.text as string)
                    .join('\n');
                const content = parsed.isError ? `❌ 工具执行失败：${text}` : text;
                yield {
                    type: 'observation',
                    content: content.length > 2000 ? content.slice(0, 2000) + `\n...[截断，共 ${content.length} 字符]` : content,
                    timestamp: now(),
                };
                break;
            }

            // 纯流程标记/流式增量事件，不产出用户可见步骤（见文件头注释）
            case 'agent_start':
            case 'agent_end':
            case 'agent_settled':
            case 'turn_start':
            case 'turn_end':
            case 'message_start':
            case 'message_update':
                break;

            default:
                yield { type: 'meta', content: `[pi:${parsed.type}] ${JSON.stringify(parsed).slice(0, 500)}`, timestamp: now() };
        }
    }
}
