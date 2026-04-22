import { nanoid } from 'nanoid';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import type {
    LLMAdapter,
    Message,
    ExecutionStep,
    Logger,
    MemoryAccess,
    Attachment
} from '../types.js';
import { SkillRegistry, type ISkillRegistry } from '../skills/registry.js';
import { ContextManager } from './context-manager.js';
import type { LongTermMemory } from '../memory/long-term.js';
import type { SessionEventStore } from './harness/session-store.js';
import { spanRecorder } from './trace.js';
import type { MemoryRouter } from '../memory/memory-router.js';
import { classifyComplexity, type ReasoningTier } from './complexity-classifier.js';
import {
    SYSTEM_PROMPT,
    PLAN_TOOL_DEF,
    MEMORY_REMEMBER_TOOL,
    MEMORY_RECALL_TOOL,
    DAG_CREATE_TASK_TOOL,
    DAG_GET_STATUS_TOOL,
    DAG_EXECUTE_TOOL,
    SKILL_GENERATE_TOOL,
    DELEGATE_AGENT_TOOL,
    KNOWLEDGE_SEARCH_TOOL,
    SESSION_RECALL_TOOL,
    BUILTIN_TOOL_NAMES,
    buildMinimalContext,
} from './agent-tools.js';
import {
    handleBuiltinToolCall,
    handleExternalToolCalls,
    type BuiltinHandlerDeps,
    type RunContext,
} from './agent-run-helpers.js';

/**
 * Agent 编排引擎
 * 负责协调 LLM 和技能的交互
 */
export class Agent {
    private llmGetter: () => LLMAdapter;
    private skillRegistry: ISkillRegistry;
    private logger: Logger;
    private maxIterations: number;
    private contextManager: ContextManager;
    private longTermMemory?: LongTermMemory;
    private memoryRouter?: MemoryRouter;
    /** 缓存 CMASTER.md + MEMORY.md 拼接后的全局指令，首次加载后复用 */
    private _globalInstructions: string | null | undefined = undefined;
    private skillConfig: Record<string, unknown>;
    private skillGenerator?: any;
    private orchestrator?: any;
    private knowledgeGraph?: any;
    private deepThinkingProvider?: () => LLMAdapter;
    private sessionStore?: SessionEventStore;
    private agentPool?: import('./harness/agent-pool.js').AgentPool;

    constructor(options: {
        llm: LLMAdapter | (() => LLMAdapter);
        skillRegistry: ISkillRegistry;
        logger: Logger;
        maxIterations?: number;
        maxContextTokens?: number;
        longTermMemory?: LongTermMemory;
        memoryRouter?: MemoryRouter;
        skillConfig?: Record<string, unknown>;
        skillGenerator?: any;
        orchestrator?: any;
        knowledgeGraph?: any;
        deepThinkingProvider?: () => LLMAdapter;
        sessionStore?: SessionEventStore;
        agentPool?: import('./harness/agent-pool.js').AgentPool;
    }) {
        this.llmGetter = typeof options.llm === 'function' ? options.llm : () => options.llm as LLMAdapter;
        this.skillRegistry = options.skillRegistry;
        this.logger = options.logger;
        this.maxIterations = options.maxIterations ?? 10;
        this.longTermMemory = options.longTermMemory;
        this.memoryRouter = options.memoryRouter;
        this.skillConfig = options.skillConfig ?? {};
        this.skillGenerator = options.skillGenerator;
        this.orchestrator = options.orchestrator;
        this.knowledgeGraph = options.knowledgeGraph;
        this.deepThinkingProvider = options.deepThinkingProvider;
        this.sessionStore = options.sessionStore;
        this.agentPool = options.agentPool;
        this.contextManager = new ContextManager({
            maxTokens: options.maxContextTokens,
            logger: options.logger,
        });
    }

    /**
     * 获取当前 LLM 适配器
     */
    private get llm(): LLMAdapter {
        return this.llmGetter();
    }

    /**
     * 处理用户输入并返回响应
     */
    async *run(
        input: string | import('../types.js').MessageContentPart[],
        context: {
            sessionId: string;
            userId?: string;
            memory: MemoryAccess;
            history?: Message[];
            abortSignal?: AbortSignal;
            attachments?: Attachment[];
            traceId?: string;
        }
    ): AsyncGenerator<ExecutionStep> {
        // Phase 21: 分布式追踪 — 开启 agent:run span
        const traceId = context.traceId ?? nanoid();
        const agentSpanId = spanRecorder.startSpan(traceId, undefined, 'agent:run', {
            sessionId: context.sessionId,
            userId: context.userId,
        });

        // Extract plain-text representation of input for memory/suggestion APIs
        const inputText = typeof input === 'string'
            ? input
            : input.filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text).join(' ');

        // 加载全局指令（CMASTER.md + MEMORY.md 索引），首次运行时懒加载并缓存
        if (this._globalInstructions === undefined) {
            this._globalInstructions = await this._loadGlobalInstructions();
        }

        // Auto-inject relevant long-term memories into system prompt
        let systemContent = SYSTEM_PROMPT;

        // 注入 CMASTER.md 全局指令 + MEMORY.md 索引
        if (this._globalInstructions) {
            systemContent += this._globalInstructions;
        }

        if (this.longTermMemory) {
            try {
                const memories = await this.longTermMemory.search(inputText, 3);
                if (memories.length > 0) {
                    const memoryContext = memories.map(m => `- ${m.content}`).join('\n');
                    systemContent += `\n\n相关记忆:\n${memoryContext}`;
                }
            } catch (err) {
                this.logger.warn(`Failed to retrieve long-term memories: ${(err as Error).message}`);
            }
        }

        // Phase 26: 注入可用 Harness Agent 列表（供 LLM 决策 delegate）
        if (this.agentPool) {
            const specs = this.agentPool.listSpecs();
            if (specs.length > 0) {
                const agentListStr = specs
                    .map(s => `- ${s.id}: ${s.name} — ${s.description.slice(0, 100)}`)
                    .join('\n');
                systemContent += `\n\n可用的专业 Agent（通过 delegate_to_agent 工具调用）:\n${agentListStr}`;
            }
        }

        const systemMessage: Message = { role: 'system', content: systemContent };
        const currentInput: Message[] = [{
            role: 'user',
            content: input,
            attachments: context.attachments
        }];

        // D1: 发射 user_message 事件（仅当 sessionStore 存在时）
        if (this.sessionStore) {
            this.sessionStore.append({
                sessionId: context.sessionId,
                timestamp: Date.now(),
                type: 'user_message',
                payload: {
                    content: inputText.slice(0, 1000),
                    userId: context.userId,
                },
            });
        }

        // Apply context window management to prevent exceeding LLM context limit
        const trimResult = await this.contextManager.trimMessages(
            systemMessage,
            context.history || [],
            currentInput,
            this.llm
        );
        const messages = trimResult.messages;

        // 如果发生压缩，通知前端，并执行 Pre-Compaction Flush（持久化摘要）
        if (trimResult.droppedCount > 0) {
            const summaryStr = trimResult.summaryText ?? `已压缩 ${trimResult.droppedCount} 条历史消息`;

            if (this.longTermMemory && trimResult.summaryText) {
                try {
                    await this.longTermMemory.remember(
                        `[AutoFlush] ${trimResult.summaryText}`,
                        { category: 'operational', topic: `auto-flush-${context.sessionId.slice(0, 8)}`, tags: ['auto-flush', context.sessionId] },
                        context.sessionId
                    );
                    this.logger.info(`[PreCompactionFlush] Saved summary to long-term memory for session ${context.sessionId}`);
                } catch (err) {
                    this.logger.warn(`[PreCompactionFlush] Failed to save summary: ${(err as Error).message}`);
                }
            }

            // T2-5: 向 SessionEventStore 发射 harness_transform 事件，供 Harness 监听
            if (this.sessionStore) {
                this.sessionStore.append({
                    sessionId: context.sessionId,
                    timestamp: Date.now(),
                    type: 'harness_transform',
                    payload: {
                        transform: 'context_compaction',
                        droppedCount: trimResult.droppedCount,
                        summaryText: summaryStr,
                    },
                });
            }

            yield {
                type: 'context_compressed',
                content: summaryStr,
                droppedCount: trimResult.droppedCount,
                timestamp: new Date(),
            } satisfies ExecutionStep;
        }

        // 合并内置工具和外部技能工具
        const externalTools = await this.skillRegistry.getToolDefinitions();
        const builtinTools = [PLAN_TOOL_DEF, DAG_CREATE_TASK_TOOL, DAG_GET_STATUS_TOOL, DAG_EXECUTE_TOOL, SKILL_GENERATE_TOOL, DELEGATE_AGENT_TOOL, KNOWLEDGE_SEARCH_TOOL];
        if (this.longTermMemory) {
            builtinTools.push(MEMORY_REMEMBER_TOOL, MEMORY_RECALL_TOOL);
        }
        // Gap 5: session_recall 仅当 sessionStore 已注入时暴露
        if (this.sessionStore) {
            builtinTools.push(SESSION_RECALL_TOOL);
        }
        let tools = [...builtinTools, ...externalTools];

        // ─────────────────────────────────────────────────────────────────
        // Adaptive AI Thinking: Route complexity dynamically
        // ─────────────────────────────────────────────────────────────────
        let activeMaxIterations = this.maxIterations;
        let activeLlm = this.llm;

        const tier = classifyComplexity(inputText, externalTools.length);
        if (tier === 1) {
            this.logger.info(`[AdaptiveThinking] Routing to Tier 1: Fast direct reply. Skipping external tools.`);
            activeMaxIterations = 1;
            // Tier 1 只去掉外部技能工具，保留内置工具（plan/memory/delegate 等）
            // 确保 delegate_to_agent 在有可用 Harness Agent 时始终可调用
            tools = builtinTools;
        } else if (tier === 3) {
            this.logger.info(`[AdaptiveThinking] Routing to Tier 3: Deep thinking required.`);
            activeMaxIterations = 25; // Extended patience
            if (this.deepThinkingProvider) {
                this.logger.info(`[AdaptiveThinking] Switching to extended deep-thinking LLM.`);
                activeLlm = this.deepThinkingProvider();
            }
        } else {
            this.logger.debug(`[AdaptiveThinking] Routing to Tier 2: Standard workflow.`);
        }

        let iteration = 0;

        while (iteration < activeMaxIterations) {
            iteration++;
            this.logger.debug(`Agent iteration ${iteration}`);

            let fullContent = '';
            let toolCalls: any[] = [];

            // D1: LLM 调用前发射 llm_request 事件
            if (this.sessionStore) {
                this.sessionStore.append({
                    sessionId: context.sessionId,
                    timestamp: Date.now(),
                    type: 'llm_request',
                    payload: { model: this.llm.provider, messageCount: messages.length, iteration },
                });
            }

            // 调用 LLM (流式获取内容和工具调用)
            try {
                for await (const chunk of activeLlm.chatStream(messages, { tools, abortSignal: context.abortSignal })) {
                    if (chunk.type === 'content' && chunk.content) {
                        fullContent += chunk.content;
                        yield {
                            type: 'content',
                            content: chunk.content,
                            timestamp: new Date(),
                        };
                    } else if (chunk.type === 'tool_call' && chunk.toolCall) {
                        toolCalls.push(chunk.toolCall);
                    }
                }
            } catch (llmErr: any) {
                // 处理上下文超限错误：强制丢弃更多历史后重试一次
                // 注意：仅当明确为 token 超限时才压缩，避免将其他 400 误判为超限
                const errMsg: string = llmErr?.message ?? '';
                const isContextLimitErr =
                    errMsg.includes('context_length_exceeded') ||
                    errMsg.includes('maximum context length') ||
                    errMsg.includes('reduce the length') ||
                    errMsg.includes('too many tokens') ||
                    errMsg.includes('请求的 token 数量') ||
                    (llmErr?.status === 400 && (
                        errMsg.includes('token') ||
                        errMsg.includes('context') ||
                        errMsg.includes('length')
                    ));

                if (isContextLimitErr && messages.length > 3) {
                    this.logger.warn(`LLM context limit hit, aggressively trimming and retrying...`);
                    // 构建最小合法上下文：
                    //   system + 最近一组完整的 assistant(tool_calls)+tool 配对（或最后 user 消息）
                    // 确保不产生孤立 tool 消息导致 400 坏请求
                    const sysMsg = messages[0];
                    const trimmed = buildMinimalContext(messages);
                    messages.length = 0;
                    messages.push(sysMsg, ...trimmed);
                    yield {
                        type: 'context_compressed',
                        content: '上下文超限，已强制压缩历史消息，正在重试…',
                        droppedCount: -1,
                        timestamp: new Date(),
                    } satisfies ExecutionStep;
                    // 重试本轮
                    for await (const chunk of activeLlm.chatStream(messages, { tools, abortSignal: context.abortSignal })) {
                        if (chunk.type === 'content' && chunk.content) {
                            fullContent += chunk.content;
                            yield {
                                type: 'content',
                                content: chunk.content,
                                timestamp: new Date(),
                            };
                        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
                            toolCalls.push(chunk.toolCall);
                        }
                    }
                } else {
                    throw llmErr;
                }
            }

            const response: Message = {
                role: 'assistant',
                content: fullContent,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            };
            messages.push(response);

            // D1: LLM 调用后发射 llm_response 事件
            if (this.sessionStore) {
                this.sessionStore.append({
                    sessionId: context.sessionId,
                    timestamp: Date.now(),
                    type: 'llm_response',
                    payload: {
                        hasToolCalls: !!response.toolCalls?.length,
                        contentLength: typeof response.content === 'string' ? response.content.length : 0,
                    },
                });
            }

            // 如果没有工具调用，返回最终答案
            if (!response.toolCalls || response.toolCalls.length === 0) {
                const answerContent = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
                // Phase 21: 结束 agent span
                spanRecorder.endSpan(agentSpanId, answerContent.slice(0, 300));
                yield {
                    type: 'answer',
                    content: answerContent,
                    traceId,
                    timestamp: new Date(),
                };

                // Generate follow-up suggestions asynchronously
                try {
                    const suggestions = await this.generateSuggestions(inputText, answerContent);
                    if (suggestions.length > 0) {
                        yield {
                            type: 'suggestions',
                            content: '',
                            items: suggestions,
                            timestamp: new Date(),
                        };
                    }
                } catch (err) {
                    this.logger.debug(`Suggestion generation skipped: ${(err as Error).message}`);
                }

                break;
            }

            // 处理工具调用 — 分离内置工具（顺序执行）和外部技能（并行执行）
            const builtinCalls: typeof response.toolCalls = [];
            const externalCalls: typeof response.toolCalls = [];
            for (const tc of response.toolCalls) {
                if (BUILTIN_TOOL_NAMES.has(tc.function.name)) {
                    builtinCalls.push(tc);
                } else {
                    externalCalls.push(tc);
                }
            }

            // 构建 handler 所需的依赖包
            const handlerDeps: BuiltinHandlerDeps = {
                logger: this.logger,
                longTermMemory: this.longTermMemory,
                memoryRouter: this.memoryRouter,
                sessionStore: this.sessionStore,
                skillRegistry: this.skillRegistry,
                skillGenerator: this.skillGenerator,
                orchestrator: this.orchestrator,
                agentPool: this.agentPool,
                knowledgeGraph: this.knowledgeGraph,
                skillConfig: this.skillConfig,
                llm: activeLlm,
            };
            const runCtx: RunContext = { ...context, traceId, agentSpanId };

            // Handle built-in tools sequentially（yield* 委托给 agent-run-helpers）
            for (const toolCall of builtinCalls) {
                const params = JSON.parse(toolCall.function.arguments);
                yield* handleBuiltinToolCall(toolCall, params, runCtx, handlerDeps, messages);
            }

            // Handle external skill calls in parallel（yield* 委托，cancelled 时 continue 主循环）
            if (externalCalls.length > 0) {
                const parsedCalls = externalCalls.map(tc => ({
                    toolCall: tc,
                    params: JSON.parse(tc.function.arguments) as Record<string, unknown>,
                    toolName: tc.function.name,
                }));
                let cancelled = false;
                for await (const step of handleExternalToolCalls(parsedCalls, runCtx, handlerDeps, messages)) {
                    if (step.type === 'observation' && step.content === '操作已取消（用户拒绝）。') {
                        cancelled = true;
                    }
                    yield step;
                }
                if (cancelled) continue;
            }
        }

        if (iteration >= activeMaxIterations) {
            const errMsg = '抱歉，我已达到最大执行步骤限制。请尝试将任务拆分为更小的步骤。';
            spanRecorder.endSpan(agentSpanId, undefined, errMsg);
            yield {
                type: 'answer',
                content: errMsg,
                traceId,
                timestamp: new Date(),
            };
        }
    }

    /**
     * 单次执行（返回完整结果）
     */
    async execute(
        input: string,
        context: {
            sessionId: string;
            userId?: string;
            memory: MemoryAccess;
            history?: Message[];
            abortSignal?: AbortSignal;
            attachments?: Attachment[];
        }
    ): Promise<{
        answer: string;
        steps: ExecutionStep[];
    }> {
        const steps: ExecutionStep[] = [];
        let answer = '';

        for await (const step of this.run(input, context)) {
            steps.push(step);
            if (step.type === 'answer') {
                answer = step.content;
            }
        }

        return { answer, steps };
    }

    /**
 * 获取技能注册中心
 */
    public getSkillRegistry(): ISkillRegistry {
        return this.skillRegistry;
    }

    /**
     * 获取当前 LLM 适配器
     */
    public getLLMAdapter(): LLMAdapter {
        return this.llm;
    }

    /**
     * 带超时保护的工具执行
     */
    private async executeWithTimeout<T>(
        fn: () => Promise<T>,
        timeoutMs: number,
        toolName: string
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            fn().then(
                (result) => { clearTimeout(timer); resolve(result); },
                (error) => { clearTimeout(timer); reject(error); }
            );
        });
    }

    /**
     * 生成后续建议问题
     */
    private async generateSuggestions(userMessage: string, answer: string): Promise<string[]> {
        const prompt = `基于以下对话，生成2-3个用户可能想继续问的简短后续问题。每个问题一行，不要加序号和标点。

用户: ${userMessage.slice(0, 200)}
助手: ${answer.slice(0, 300)}

后续问题:`;

        const response = await this.llm.chat([
            { role: 'user', content: prompt }
        ]);

        let text = typeof response.content === 'string' ? response.content : '';
        if (!text && Array.isArray(response.content)) {
            text = response.content.map(p => p.type === 'text' ? p.text : '').join('');
        }

        return text
            .split('\n')
            .map(line => line.trim().replace(/^\d+[\.\)、]\s*/, ''))
            .filter(line => line.length > 0 && line.length < 50)
            .slice(0, 3);
    }

    /**
     * 加载 CMASTER.md（全局指令）和 MEMORY.md 索引（前 200 行），
     * 拼接后追加到 system prompt。
     * 结果为 null 表示两者均不存在，空字符串表示加载但内容为空。
     */
    private async _loadGlobalInstructions(): Promise<string | null> {
        const parts: string[] = [];

        // 1. CMASTER.md — 管理员/用户手写的全局指令
        const cmasterPath = 'data/CMASTER.md';
        if (existsSync(cmasterPath)) {
            try {
                const content = await readFile(cmasterPath, 'utf-8');
                if (content.trim()) {
                    parts.push(`\n\n## 全局指令 (CMASTER.md)\n\n${content.trim()}`);
                }
            } catch (err) {
                this.logger.warn(`[agent] Failed to load CMASTER.md: ${(err as Error).message}`);
            }
        }

        // 2. MEMORY.md — Agent 自动维护的记忆索引（前 200 行）
        if (this.longTermMemory) {
            try {
                const memIndex = await this.longTermMemory.loadMemoryIndex(200);
                if (memIndex) {
                    parts.push(`\n\n## 记忆索引 (MEMORY.md)\n\n${memIndex}`);
                }
            } catch (err) {
                this.logger.warn(`[agent] Failed to load MEMORY.md: ${(err as Error).message}`);
            }
        }

        return parts.length > 0 ? parts.join('') : null;
    }

    /**
     * 为会话生成简短标题
     */
    async generateTitle(userMessage: string): Promise<string> {
        try {
            const prompt = `请为以下用户输入生成一个非常简短的标题（5-10个字以内），直接返回标题内容，不要包含任何标点符号或解释：\n\n${userMessage}`;
            const response = await this.llm.chat([
                { role: 'user', content: prompt }
            ]);

            let title = typeof response.content === 'string' ? response.content : '';
            if (!title && Array.isArray(response.content)) {
                title = response.content.map(p => p.type === 'text' ? p.text : '').join('');
            }

            return title.trim().replace(/["""]/g, '');
        } catch (error) {
            this.logger.warn(`Failed to generate title: ${(error as Error).message}`);
            return '新对话';
        }
    }
}
