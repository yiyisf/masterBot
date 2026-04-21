import { nanoid } from 'nanoid';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import type {
    LLMAdapter,
    Message,
    ExecutionStep,
    SkillContext,
    Logger,
    MemoryAccess,
    Attachment
} from '../types.js';
import { SkillRegistry, type ISkillRegistry } from '../skills/registry.js';
import { ContextManager } from './context-manager.js';
import type { LongTermMemory } from '../memory/long-term.js';
import type { SessionEventStore, EventSelector } from './harness/session-store.js';
import { taskRepository } from './task-repository.js';
import { DAGExecutor } from './dag-executor.js';
import { waitForApproval } from './interrupt-coordinator.js';
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
    isDangerousToolCall,
    buildMinimalContext,
} from './agent-tools.js';

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

            // Handle built-in tools sequentially (they have side effects/ordering requirements)
            for (const toolCall of builtinCalls) {
                const params = JSON.parse(toolCall.function.arguments);
                const toolName = toolCall.function.name;

                if (toolName === 'plan_task') {
                    const { thought, steps } = params;
                    yield { type: 'thought', content: thought, timestamp: new Date() };
                    yield { type: 'plan', content: JSON.stringify(steps), toolName: 'plan_task', toolOutput: steps, timestamp: new Date() };
                    messages.push({ role: 'tool', content: `Plan created: ${JSON.stringify(steps)}. Now precede to execute step 1.`, toolCallId: toolCall.id });
                } else if (toolName === 'memory_remember' && this.longTermMemory) {
                    const { content: memContent, category, topic, tags } = params;
                    const metadata: Record<string, unknown> = {};
                    if (category) metadata.category = category;
                    if (topic) metadata.topic = topic;
                    if (tags) metadata.tags = tags.split(',').map((t: string) => t.trim());
                    const memId = await this.longTermMemory.remember(memContent, metadata, context.sessionId);
                    const result = `Memory saved (id: ${memId})`;
                    yield { type: 'observation', content: result, toolName, toolOutput: { id: memId }, timestamp: new Date() };
                    messages.push({ role: 'tool', content: result, toolCallId: toolCall.id });
                } else if (toolName === 'memory_recall' && this.longTermMemory) {
                    const { query, limit: recallLimit } = params;
                    let resultStr: string;
                    let toolOutput: unknown;
                    if (this.memoryRouter) {
                        // Phase 21: 使用统一内存路由器
                        const unified = await this.memoryRouter.query(query, { sessionId: context.sessionId, limit: recallLimit ?? 8 });
                        toolOutput = unified;
                        resultStr = unified.length > 0
                            ? unified.map(m => `[${m.source}] ${m.content}`).join('\n')
                            : 'No relevant memories found.';
                    } else {
                        const memories = await this.longTermMemory.search(query, recallLimit ?? 5);
                        toolOutput = memories;
                        resultStr = memories.length > 0 ? memories.map(m => `- ${m.content}`).join('\n') : 'No relevant memories found.';
                    }
                    yield { type: 'observation', content: resultStr, toolName, toolOutput, timestamp: new Date() };
                    messages.push({ role: 'tool', content: resultStr, toolCallId: toolCall.id });
                } else if (toolName === 'dag_create_task') {
                    const { description: taskDesc, dependencies: deps } = params;
                    const taskId = taskRepository.createTask(context.sessionId, taskDesc, deps);
                    yield { type: 'task_created', content: `Task created: ${taskDesc}`, taskId, toolName, timestamp: new Date() };
                    messages.push({ role: 'tool', content: JSON.stringify({ taskId, description: taskDesc }), toolCallId: toolCall.id });
                } else if (toolName === 'dag_get_status') {
                    const dag = taskRepository.getDAG(context.sessionId);
                    const resultStr = JSON.stringify(dag, null, 2);
                    yield { type: 'observation', content: resultStr, toolName, toolOutput: dag, timestamp: new Date() };
                    messages.push({ role: 'tool', content: resultStr, toolCallId: toolCall.id });
                } else if (toolName === 'dag_execute') {
                    const skillContext: SkillContext = {
                        sessionId: context.sessionId, userId: context.userId,
                        memory: context.memory, logger: this.logger, config: this.skillConfig,
                    };
                    const executor = new DAGExecutor(context.sessionId, this.skillRegistry, skillContext, this.logger);
                    const stepResults: string[] = [];
                    for await (const step of executor.execute()) {
                        yield { type: step.type, content: step.result || step.error || '', taskId: step.taskId, toolName: 'dag_execute', timestamp: new Date() };
                        stepResults.push(`${step.taskId}: ${step.type} - ${step.result || step.error}`);
                    }
                    const summary = stepResults.length > 0 ? `DAG execution completed:\n${stepResults.join('\n')}` : 'No tasks to execute.';
                    messages.push({ role: 'tool', content: summary, toolCallId: toolCall.id });
                } else if (toolName === 'skill_generate' && this.skillGenerator) {
                    const { name, description, actions } = params;
                    yield { type: 'action', content: `Generating skill: ${name}`, toolName, toolInput: params, timestamp: new Date() };
                    try {
                        const generated = await this.skillGenerator.generate({ name, description, actions });
                        const dir = await this.skillGenerator.install(generated);
                        // Hot-reload: add skill to existing local-files source to avoid overwriting it
                        try {
                            const existingLocal = this.skillRegistry.getAllSources()
                                .find(s => s.name === 'local-files' && typeof (s as any).loadSkill === 'function') as any;
                            if (existingLocal) {
                                await existingLocal.loadSkill(dir);
                                this.logger.info(`Hot-reloaded skill "${name}" into existing local-files source`);
                            } else {
                                const { LocalSkillSource } = await import('../skills/loader.js');
                                const tempSource = new LocalSkillSource([dir], this.logger);
                                await tempSource.initialize();
                                await this.skillRegistry.registerSource(tempSource);
                            }
                        } catch (err) {
                            this.logger.warn(`Hot-reload failed: ${(err as Error).message}`);
                        }
                        const resultStr = `技能 "${name}" 已生成并安装到 ${dir}。现在可以直接使用它。`;
                        yield { type: 'observation', content: resultStr, toolName, timestamp: new Date() };
                        messages.push({ role: 'tool', content: resultStr, toolCallId: toolCall.id });
                    } catch (err: any) {
                        const errorMsg = `技能生成失败: ${err.message}`;
                        yield { type: 'observation', content: errorMsg, toolName, timestamp: new Date() };
                        messages.push({ role: 'tool', content: errorMsg, toolCallId: toolCall.id });
                    }
                } else if (toolName === 'delegate_to_agent') {
                    const { worker_id, task } = params as { worker_id: string; task: string; context_summary?: string };
                    yield { type: 'action', content: `Delegating to agent: ${worker_id}`, toolName, toolInput: params, timestamp: new Date() };

                    const delegateSpanId = spanRecorder.startSpan(traceId, agentSpanId, `delegate:${worker_id}`, {
                        sessionId: context.sessionId, workerId: worker_id,
                    });

                    try {
                        let lastAnswer = '';

                        // Phase 26: 优先走 AgentPool（Harness 路径）
                        if (this.agentPool?.getSpec(worker_id)) {
                            const childSessionId = `harness-${nanoid(12)}`;
                            const instanceId = await this.agentPool.spawn(worker_id, task, {
                                sessionId: childSessionId,
                                userId: context.userId,
                                memory: context.memory,
                                parentInstanceId: traceId,
                                parentSessionId: context.sessionId,
                                trigger: 'chat_delegate',
                            });

                            // 通知前端：子 Agent 已启动
                            yield {
                                type: 'meta' as any,
                                content: `🤖 托管 Agent [${worker_id}] 已启动 (instance: ${instanceId})`,
                                harnessInstanceId: instanceId,
                                delegatedFrom: worker_id,
                                timestamp: new Date(),
                            };

                            // 流式消费子 Agent 步骤，内联到 Chat SSE 流
                            for await (const step of this.agentPool.streamInstance(instanceId)) {
                                yield { ...step, delegatedFrom: worker_id, harnessInstanceId: instanceId };
                                if (step.type === 'answer') lastAnswer = step.content ?? '';
                            }
                        }
                        // 回退旧路径：MultiAgentOrchestrator
                        else if (this.orchestrator) {
                            const delegateCtx = { ...context, traceId };
                            for await (const step of this.orchestrator.delegateStream(worker_id, task, delegateCtx)) {
                                yield step;
                                if (step.type === 'answer') lastAnswer = step.content ?? '';
                            }
                        } else {
                            throw new Error(`Agent "${worker_id}" not found in AgentPool or Orchestrator`);
                        }

                        spanRecorder.endSpan(delegateSpanId, lastAnswer.slice(0, 300));
                        messages.push({ role: 'tool', content: lastAnswer || '(no answer)', toolCallId: toolCall.id });
                    } catch (err: any) {
                        spanRecorder.endSpan(delegateSpanId, undefined, err.message);
                        const errorMsg = `委托失败: ${err.message}`;
                        yield { type: 'observation', content: errorMsg, toolName, timestamp: new Date() };
                        messages.push({ role: 'tool', content: errorMsg, toolCallId: toolCall.id });
                    }
                } else if (toolName === 'knowledge_search' && this.knowledgeGraph) {
                    const { query, depth, limit } = params as { query: string; depth?: number; limit?: number };
                    try {
                        const result = await this.knowledgeGraph.search(query, { depth: depth ?? 2, limit: limit ?? 10 });
                        const nodesSummary = result.nodes.slice(0, 5).map((n: any) => `**${n.title}** (${n.type}): ${n.content.substring(0, 150)}...`).join('\n\n');
                        const resultStr = result.nodes.length > 0
                            ? `找到 ${result.nodes.length} 个相关知识节点:\n\n${nodesSummary}`
                            : '知识库中未找到相关内容。';
                        yield { type: 'observation', content: resultStr, toolName, toolOutput: result, timestamp: new Date() };
                        messages.push({ role: 'tool', content: resultStr, toolCallId: toolCall.id });
                    } catch (err: any) {
                        const errorMsg = `知识检索失败: ${err.message}`;
                        yield { type: 'observation', content: errorMsg, toolName, timestamp: new Date() };
                        messages.push({ role: 'tool', content: errorMsg, toolCallId: toolCall.id });
                    }
                } else if (toolName === 'session_recall' && this.sessionStore) {
                    // Gap 5: Context 外置访问 — Agent 主动查询历史事件
                    const { types, toolName: filterToolName, last, fromTimestamp, toTimestamp } = params as {
                        types?: string[];
                        toolName?: string;
                        last?: number;
                        fromTimestamp?: number;
                        toTimestamp?: number;
                    };
                    const selector: EventSelector = {
                        types: types as any,
                        toolName: filterToolName,
                        last: last ?? 20,
                        fromTimestamp,
                        toTimestamp,
                    };
                    const events = this.sessionStore.getEvents(context.sessionId, selector);
                    const summary = events.length === 0
                        ? '当前 session 中未找到匹配的历史事件。'
                        : `找到 ${events.length} 条历史事件：\n\n` + events.map(e =>
                            `[${new Date(e.timestamp).toISOString()}] ${e.type}: ${JSON.stringify(e.payload).slice(0, 200)}`
                          ).join('\n');
                    yield { type: 'observation', content: summary, toolName, timestamp: new Date() };
                    messages.push({ role: 'tool', content: summary, toolCallId: toolCall.id });
                }
            }

            // Handle external skill calls in parallel (Promise.allSettled)
            if (externalCalls.length > 0) {
                // Emit all action steps first
                const parsedCalls = externalCalls.map(tc => ({
                    toolCall: tc,
                    params: JSON.parse(tc.function.arguments),
                    toolName: tc.function.name,
                }));

                for (const { toolName, params } of parsedCalls) {
                    yield {
                        type: 'action',
                        content: `Calling ${toolName}`,
                        toolName,
                        toolInput: params,
                        timestamp: new Date(),
                    };
                }

                // ── Human-in-the-Loop: check for dangerous tool calls ──────────
                const firstDangerous = parsedCalls
                    .map(c => ({ ...c, reason: isDangerousToolCall(c.toolName, c.params) }))
                    .find(c => c.reason !== null);

                if (firstDangerous) {
                    const interruptId = nanoid();
                    yield {
                        type: 'interrupt',
                        interruptId,
                        interruptReason: firstDangerous.reason!,
                        toolName: firstDangerous.toolName,
                        toolInput: firstDangerous.params,
                        content: `需要确认：${firstDangerous.reason}`,
                        timestamp: new Date(),
                    };

                    let approved = false;
                    try {
                        approved = await waitForApproval(context.sessionId, {
                            interruptId,
                            actionName: firstDangerous.toolName,
                            actionParams: JSON.stringify(firstDangerous.params).slice(0, 1000),
                            dangerReason: firstDangerous.reason ?? undefined,
                        });
                    } catch {
                        // Client disconnected mid-interrupt — treat as rejected
                        approved = false;
                    }

                    if (!approved) {
                        // Push cancelled tool results so LLM can respond appropriately
                        for (const { toolCall } of parsedCalls) {
                            messages.push({ role: 'tool', content: '用户已取消该操作。', toolCallId: toolCall.id });
                        }
                        yield {
                            type: 'observation',
                            content: '操作已取消（用户拒绝）。',
                            toolName: firstDangerous.toolName,
                            timestamp: new Date(),
                        };
                        continue; // back to LLM for a graceful response
                    }
                }
                // ── end Human-in-the-Loop ──────────────────────────────────────

                const skillContext: SkillContext = {
                    sessionId: context.sessionId,
                    userId: context.userId,
                    memory: context.memory,
                    logger: this.logger,
                    config: this.skillConfig,
                    llm: this.llm,
                    sessionToken: (context as any).sessionToken,
                };

                // Phase 21: 为每个外部工具调用开 span
                const toolSpanIds = parsedCalls.map(({ toolName, params: p }) =>
                    spanRecorder.startSpan(traceId, agentSpanId, `tool:${toolName}`, {
                        sessionId: context.sessionId,
                        input_summary: JSON.stringify(p).slice(0, 200),
                    })
                );

                // Execute all external tool calls in parallel (with duration tracking)
                const toolStartTimes = parsedCalls.map(() => Date.now());
                const results = await Promise.allSettled(
                    parsedCalls.map(({ toolName, params }) =>
                        this.executeWithTimeout(
                            () => this.skillRegistry.executeAction(toolName, params, skillContext),
                            60000,
                            toolName
                        )
                    )
                );

                // Yield observations and push tool messages
                for (let i = 0; i < results.length; i++) {
                    const { toolCall, toolName } = parsedCalls[i];
                    const result = results[i];
                    const duration = Date.now() - toolStartTimes[i];

                    if (result.status === 'fulfilled') {
                        const toolResult = result.value; // ToolResult

                        if (toolResult.kind === 'ok') {
                            const resultStr = toolResult.value;

                            // Phase 21: 结束工具 span
                            spanRecorder.endSpan(toolSpanIds[i], resultStr.slice(0, 300));

                            // 尝试解析 JSON 以供 toolOutput
                            let parsedOutput: unknown = resultStr;
                            try { parsedOutput = JSON.parse(resultStr); } catch { /* keep string */ }

                            yield {
                                type: 'observation',
                                content: resultStr,
                                toolName,
                                toolOutput: parsedOutput,
                                duration,
                                timestamp: new Date(),
                            };
                            // Emit dedicated workflow_generated step so frontend can render the workflow card
                            if (parsedOutput && typeof parsedOutput === 'object' && (parsedOutput as any).type === 'workflow_generated') {
                                const wf = parsedOutput as any;
                                yield {
                                    type: 'workflow_generated',
                                    content: resultStr,
                                    toolName,
                                    workflow: wf.workflow,
                                    subWorkflows: wf.subWorkflows,
                                    validation: wf.validation,
                                    allValid: wf.allValid,
                                    explanation: wf.explanation,
                                    timestamp: new Date(),
                                } as any;
                            }
                            messages.push({ role: 'tool', content: resultStr, toolCallId: toolCall.id });
                        } else {
                            // ToolResult.error — Hands 层统一错误，交还给 Brain 决策
                            const errorMsg = `Error: ${toolResult.message}`;

                            // Phase 21: 结束工具 span（失败）
                            spanRecorder.endSpan(toolSpanIds[i], undefined, errorMsg);

                            yield {
                                type: 'observation',
                                content: errorMsg,
                                toolName,
                                toolOutput: { error: toolResult.message, retryable: toolResult.retryable },
                                duration,
                                timestamp: new Date(),
                            };
                            messages.push({ role: 'tool', content: errorMsg, toolCallId: toolCall.id });
                        }
                    } else {
                        // executeWithTimeout 超时抛出
                        const errorMsg = `Error: ${result.reason?.message || 'Unknown error'}`;

                        // Phase 21: 结束工具 span（失败）
                        spanRecorder.endSpan(toolSpanIds[i], undefined, errorMsg);

                        yield {
                            type: 'observation',
                            content: errorMsg,
                            toolName,
                            toolOutput: { error: result.reason?.message },
                            duration,
                            timestamp: new Date(),
                        };
                        messages.push({ role: 'tool', content: errorMsg, toolCallId: toolCall.id });
                    }
                }
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
