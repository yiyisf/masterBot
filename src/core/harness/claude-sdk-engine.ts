/**
 * ClaudeAgentSdkEngine — 基于 Claude Agent SDK 的执行引擎（U16）
 *
 * 用 Claude Code 同款 Harness（系统提示、Edit/Grep/Glob/Bash 工具、上下文压缩、
 * prompt caching）替换自研 ReAct 循环，专供 coder 类 Agent 使用。
 *
 * 治理对接：
 * - SDK query() 流 → 逐消息转译为 ExecutionStep（前端/审计/追踪零改动）
 * - canUseTool 回调 → CommandSandbox 校验 Bash 命令 + 工具白名单（第二道闸）
 * - 外层 Harness 的 OutcomeSpec/Grader 修订循环保持不变
 *
 * 降级策略：SDK 未安装 / Claude 凭证缺失时自动回落 fallback 引擎（NativeAgentEngine），
 * 纯内网/内部模型部署不受影响。
 */

import type { Logger } from '../../types.js';
import type { ExecutionStep } from '../../types.js';
import type { AgentSpec } from './agent-spec.js';
import type { IAgentEngine, EngineRunContext } from './agent-engine.js';
import { CommandSandbox } from '../../skills/sandbox.js';

/** coder 场景默认放行的 SDK 内建工具 */
const DEFAULT_ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'TodoWrite'];

export interface ClaudeSdkEngineOptions {
    /** SDK 不可用时的降级引擎（推荐传入 NativeAgentEngine）*/
    fallback?: IAgentEngine;
    /** 工作目录（默认 process.cwd()）*/
    cwd?: string;
    /** 模型（默认由 SDK / 环境变量决定）*/
    model?: string;
    /** Anthropic 凭证（缺省读环境变量 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL）*/
    apiKey?: string;
    baseUrl?: string;
    /** Bash 命令沙箱配置（缺省启用黑名单模式）*/
    sandboxConfig?: { enabled: boolean; mode: 'blocklist' | 'allowlist'; blocklist?: string[]; allowlist?: string[] };
}

export class ClaudeAgentSdkEngine implements IAgentEngine {
    readonly kind = 'claude-agent-sdk' as const;
    private sandbox: CommandSandbox;
    private allowedTools: string[];

    constructor(
        private spec: AgentSpec,
        private logger: Logger,
        private options: ClaudeSdkEngineOptions = {}
    ) {
        this.sandbox = new CommandSandbox(
            options.sandboxConfig ?? { enabled: true, mode: 'blocklist' },
            logger
        );
        this.allowedTools = spec.engineOptions?.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
    }

    async *run(input: string, context: EngineRunContext): AsyncGenerator<ExecutionStep> {
        // 动态加载 SDK：未安装时降级
        let sdk: any;
        try {
            sdk = await import('@anthropic-ai/claude-agent-sdk');
        } catch (err) {
            yield* this._fallbackOrThrow(
                input, context,
                `Claude Agent SDK 不可用（${(err as Error).message.split('\n')[0]}）`
            );
            return;
        }

        const apiKey = this.options.apiKey ?? process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            yield* this._fallbackOrThrow(input, context, 'ANTHROPIC_API_KEY 未配置');
            return;
        }

        // abortSignal → AbortController 桥接
        const abortController = new AbortController();
        if (context.abortSignal) {
            if (context.abortSignal.aborted) abortController.abort();
            else context.abortSignal.addEventListener('abort', () => abortController.abort(), { once: true });
        }

        const env: Record<string, string> = {
            ...process.env as Record<string, string>,
            ANTHROPIC_API_KEY: apiKey,
        };
        if (this.options.baseUrl) env.ANTHROPIC_BASE_URL = this.options.baseUrl;

        const allowedSet = new Set(this.allowedTools);

        const queryOptions: Record<string, unknown> = {
            cwd: this.spec.engineOptions?.cwd ?? this.options.cwd ?? process.cwd(),
            maxTurns: Math.max(this.spec.resources.maxIterations, 30),
            systemPrompt: { type: 'preset', preset: 'claude_code', append: this.spec.systemPrompt },
            allowedTools: this.allowedTools,
            abortController,
            env,
            // 第二道闸：Bash 命令过沙箱校验，未放行工具一律拒绝
            canUseTool: async (toolName: string, toolInput: Record<string, unknown>) => {
                if (!allowedSet.has(toolName)) {
                    this.logger.warn(`[claude-sdk-engine] Tool denied (not in allowlist): ${toolName}`);
                    return { behavior: 'deny', message: `Tool "${toolName}" is not allowed for this agent` };
                }
                if (toolName === 'Bash') {
                    const command = String(toolInput?.command ?? '');
                    const verdict = this.sandbox.validate(command);
                    if (!verdict.allowed) {
                        this.logger.warn(`[claude-sdk-engine] Bash command blocked by sandbox: ${command.slice(0, 100)}`);
                        return { behavior: 'deny', message: `Command blocked by sandbox: ${verdict.reason}` };
                    }
                }
                return { behavior: 'allow', updatedInput: toolInput };
            },
        };
        if (this.options.model || this.spec.engineOptions?.model) {
            queryOptions.model = this.spec.engineOptions?.model ?? this.options.model;
        }

        this.logger.info(`[claude-sdk-engine] Starting query for spec "${this.spec.id}" (cwd: ${queryOptions.cwd})`);

        let sawResult = false;
        try {
            for await (const message of sdk.query({ prompt: input, options: queryOptions })) {
                for (const step of this._translateMessage(message)) {
                    yield step;
                }
                if (message?.type === 'result') sawResult = true;
            }
        } catch (err) {
            // SDK 启动期失败（如 CLI 二进制缺失）且还没产出任何结果 → 降级
            if (!sawResult) {
                yield* this._fallbackOrThrow(
                    input, context,
                    `Claude Agent SDK 执行失败（${(err as Error).message.split('\n')[0]}）`
                );
                return;
            }
            throw err;
        }
    }

    // ─────────────────────────────── private ───────────────────────────────

    /**
     * SDK 消息 → ExecutionStep 转译（与 agent.ts 的 yield 范式对齐）
     */
    private *_translateMessage(message: any): Generator<ExecutionStep> {
        const now = () => new Date();

        switch (message?.type) {
            case 'system': {
                if (message.subtype === 'init') {
                    yield {
                        type: 'meta',
                        content: `🚀 Claude Agent SDK 会话已启动（model: ${message.model ?? 'default'}, session: ${message.session_id ?? '-'}）`,
                        timestamp: now(),
                    };
                }
                break;
            }

            case 'assistant': {
                const blocks = message.message?.content ?? [];
                for (const block of blocks) {
                    if (block.type === 'text' && block.text) {
                        yield { type: 'content', content: block.text, timestamp: now() };
                    } else if (block.type === 'thinking' && block.thinking) {
                        yield { type: 'thought', content: block.thinking, timestamp: now() };
                    } else if (block.type === 'tool_use') {
                        yield {
                            type: 'action',
                            content: `调用 ${block.name}`,
                            toolName: block.name,
                            toolInput: block.input as Record<string, unknown>,
                            timestamp: now(),
                        };
                    }
                }
                break;
            }

            case 'user': {
                // 工具结果回填
                const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
                for (const block of blocks) {
                    if (block.type === 'tool_result') {
                        const raw = typeof block.content === 'string'
                            ? block.content
                            : Array.isArray(block.content)
                                ? block.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
                                : JSON.stringify(block.content ?? '');
                        yield {
                            type: 'observation',
                            content: raw.length > 2000 ? raw.slice(0, 2000) + `\n...[截断，共 ${raw.length} 字符]` : raw,
                            timestamp: now(),
                        };
                    }
                }
                break;
            }

            case 'result': {
                const costInfo = typeof message.total_cost_usd === 'number'
                    ? `, cost: $${message.total_cost_usd.toFixed(4)}`
                    : '';
                if (message.subtype === 'success') {
                    yield {
                        type: 'answer',
                        content: message.result ?? '',
                        timestamp: now(),
                    };
                    yield {
                        type: 'meta',
                        content: `✅ SDK 会话完成（turns: ${message.num_turns ?? '-'}${costInfo}）`,
                        timestamp: now(),
                    };
                } else {
                    yield {
                        type: 'meta',
                        content: `⚠️ SDK 会话异常结束（${message.subtype}${costInfo}）`,
                        timestamp: now(),
                    };
                    // 即使异常也输出已有结果，交由外层 Grader 评分
                    if (message.result) {
                        yield { type: 'answer', content: message.result, timestamp: now() };
                    }
                }
                break;
            }

            default:
                break;
        }
    }

    private async *_fallbackOrThrow(
        input: string,
        context: EngineRunContext,
        reason: string
    ): AsyncGenerator<ExecutionStep> {
        if (this.options.fallback) {
            this.logger.warn(`[claude-sdk-engine] ${reason}，降级到 ${this.options.fallback.kind} 引擎`);
            yield {
                type: 'meta',
                content: `⚠️ ${reason}，已降级到内置引擎执行`,
                timestamp: new Date(),
            };
            yield* this.options.fallback.run(input, context);
            return;
        }
        throw new Error(`[claude-sdk-engine] ${reason}，且未配置降级引擎`);
    }
}
