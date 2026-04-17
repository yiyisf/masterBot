import { nanoid } from 'nanoid';
import type {
    LLMAdapter,
    Message,
    ToolDefinition,
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

/**
 * Detect whether a tool call requires human confirmation before execution.
 * Returns a human-readable reason string if dangerous, null if safe.
 */
function isDangerousToolCall(toolName: string, params: Record<string, unknown>): string | null {
    if (toolName === 'shell.execute') {
        const cmd = (params.command as string) ?? '';
        const patterns: Array<[RegExp, string]> = [
            [/\brm\s+(-[rRfF]+\s+)?\//, '删除系统路径'],
            [/\brm\s+-[rRfF]{2,}/, '递归强制删除文件'],
            [/\bmkfs\b/, '格式化磁盘分区'],
            [/\bdd\b.+of=\/dev\//, '直接写入磁盘设备'],
            [/\bdrop\s+(table|database|schema)\b/i, '删除数据库对象'],
            [/\btruncate\b/i, '清空表数据'],
            [/[|;`]\s*rm\b/, '管道/链接删除命令'],
            [/\bshred\b/, '安全擦除文件'],
            [/\b(poweroff|shutdown|reboot|init\s+0)\b/, '关机/重启操作'],
        ];
        for (const [pattern, reason] of patterns) {
            if (pattern.test(cmd)) return reason;
        }
    }
    if (toolName === 'database-connector.execute_query') {
        const query = (params.query as string) ?? '';
        if (/\b(drop\s+(table|database|schema)|truncate\s+table)\b/i.test(query)) {
            return 'SQL 删除/清空数据库对象';
        }
    }
    if (toolName === 'file-manager.write') {
        const filePath = (params.path as string) ?? '';
        if (/^\/?(etc|usr|bin|sbin|boot|sys|proc)\//i.test(filePath)) {
            return `写入系统目录: ${filePath}`;
        }
    }
    return null;
}

const SYSTEM_PROMPT = `你是 CMaster Bot，一个强大的企业级 AI 助手。

核心工作流 (Think-Plan-Act):
1. **思考 (Think)**: 在行动前，先进行深思熟虑，分析用户意图和潜在难点。
2. **规划 (Plan)**: 对于复杂任务，必须先调用 \`plan_task\` 工具制定步骤。
3. **执行 (Act)**: 按照计划一步步调用工具执行。
4. **反思 (Reflect)**: 如果工具执行失败，分析原因并修正计划。

任务 DAG (用于复杂多步任务):
- 使用 \`dag_create_task\` 将复杂任务分解为多个子任务，声明依赖关系
- 任务描述可以是纯文本，也可以是 JSON 格式的工具调用: {"tool":"skill.action","params":{...}}
- 使用 \`dag_get_status\` 查看当前 DAG 状态
- 使用 \`dag_execute\` 并行执行所有就绪任务

安全与原则：
1. 不执行危害性操作，保护隐私。
2. 遇到不确定的关键操作（如删除），需请求用户确认。
3. 保持回答简洁专业。`;

// 内置规划工具定义
const PLAN_TOOL_DEF: ToolDefinition = {
    type: 'function',
    function: {
        name: 'plan_task',
        description: 'Create or update a execution plan for complex tasks',
        parameters: {
            type: 'object',
            properties: {
                thought: {
                    type: 'string',
                    description: 'The reasoning behind this plan (Thinking process)'
                },
                steps: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of actionable steps to complete the task'
                }
            },
            required: ['thought', 'steps']
        }
    }
};

// 内置记忆工具定义
const MEMORY_REMEMBER_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'memory_remember',
        description: 'Save important information to long-term memory for future recall across sessions',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'The information to remember'
                },
                tags: {
                    type: 'string',
                    description: 'Optional comma-separated tags for categorization'
                }
            },
            required: ['content']
        }
    }
};

const MEMORY_RECALL_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'memory_recall',
        description: 'Search long-term memory for previously saved information',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query to find relevant memories'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 5)'
                }
            },
            required: ['query']
        }
    }
};

// DAG task tools
const DAG_CREATE_TASK_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'dag_create_task',
        description: 'Create a sub-task in the DAG for complex task decomposition. The description can be plain text or a JSON tool call: {"tool":"skill.action","params":{...}}',
        parameters: {
            type: 'object',
            properties: {
                description: {
                    type: 'string',
                    description: 'Task description or JSON tool call specification'
                },
                dependencies: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional array of task IDs that must complete before this task'
                }
            },
            required: ['description']
        }
    }
};

const DAG_GET_STATUS_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'dag_get_status',
        description: 'View the current DAG status including all tasks and their dependencies',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    }
};

const DAG_EXECUTE_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'dag_execute',
        description: 'Execute all ready tasks in the DAG in parallel, respecting dependency order. Continues until no more tasks are ready.',
        parameters: {
            type: 'object',
            properties: {},
            required: []
        }
    }
};

const SKILL_GENERATE_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'skill_generate',
        description: 'Automatically generate, install and hot-reload a new skill using AI. Use when the user requests a capability that doesn\'t exist yet.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Skill name (lowercase, hyphen-separated, e.g. "weather-api")' },
                description: { type: 'string', description: 'What the skill does' },
                actions: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            description: { type: 'string' },
                        },
                    },
                    description: 'List of actions with name and description',
                },
            },
            required: ['name', 'description', 'actions'],
        },
    },
};

const DELEGATE_AGENT_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'delegate_to_agent',
        description: 'Delegate a subtask to a specialized managed agent. The agent runs with its own tool permissions, quality grading, and lifecycle hooks. Available agents: use worker_id matching the agent spec ID.',
        parameters: {
            type: 'object',
            properties: {
                worker_id: { type: 'string', description: 'ID of the worker agent to delegate to' },
                task: { type: 'string', description: 'The task description to send to the worker' },
                context_summary: { type: 'string', description: 'Brief summary of context the worker needs' },
            },
            required: ['worker_id', 'task'],
        },
    },
};

const KNOWLEDGE_SEARCH_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'knowledge_search',
        description: 'Search the enterprise knowledge graph for relevant information. Uses vector similarity and graph traversal.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
                depth: { type: 'number', description: 'Graph traversal depth (1-3, default 2)' },
                limit: { type: 'number', description: 'Max results (default 10)' },
            },
            required: ['query'],
        },
    },
};

const SESSION_RECALL_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'session_recall',
        description: 'Query historical events from the current session event log. Useful for reviewing past tool calls, errors, or results without re-executing them. Supports filtering by event type, tool name, or time range.',
        parameters: {
            type: 'object',
            properties: {
                types: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Filter by event types (e.g. ["tool_call","tool_result","tool_error"])',
                },
                toolName: { type: 'string', description: 'Filter events for a specific tool name' },
                last: { type: 'number', description: 'Return only the last N events (default: 20)' },
                fromTimestamp: { type: 'number', description: 'Unix ms start timestamp (inclusive)' },
                toTimestamp: { type: 'number', description: 'Unix ms end timestamp (inclusive)' },
            },
            required: [],
        },
    },
};

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

        // Auto-inject relevant long-term memories into system prompt
        let systemContent = SYSTEM_PROMPT;
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
                        { tags: ['auto-flush', context.sessionId] },
                        context.sessionId
                    );
                    this.logger.info(`[PreCompactionFlush] Saved summary to long-term memory for session ${context.sessionId}`);
                } catch (err) {
                    this.logger.warn(`[PreCompactionFlush] Failed to save summary: ${(err as Error).message}`);
                }
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
                const isContextLimitErr =
                    llmErr?.message?.includes('context_length_exceeded') ||
                    llmErr?.message?.includes('maximum context length') ||
                    llmErr?.message?.includes('reduce the length') ||
                    llmErr?.status === 400;

                if (isContextLimitErr && messages.length > 3) {
                    this.logger.warn(`LLM context limit hit, aggressively trimming and retrying...`);
                    // 强制保留 system + 最后 2 条消息（最小化上下文）
                    const sysMsg = messages[0];
                    const lastTwo = messages.slice(-2);
                    messages.splice(1, messages.length - 3, ...lastTwo.slice(0, 0)); // clear middle
                    messages.length = 0;
                    messages.push(sysMsg, ...lastTwo);
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
            const BUILTIN_NAMES = new Set(['plan_task', 'memory_remember', 'memory_recall', 'dag_create_task', 'dag_get_status', 'dag_execute', 'skill_generate', 'delegate_to_agent', 'knowledge_search', 'session_recall']);

            for (const tc of response.toolCalls) {
                if (BUILTIN_NAMES.has(tc.function.name)) {
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
                    const { content: memContent, tags } = params;
                    const metadata = tags ? { tags: tags.split(',').map((t: string) => t.trim()) } : {};
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
