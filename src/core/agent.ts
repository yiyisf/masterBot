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
import { SkillRegistry } from '../skills/registry.js';
import { ContextManager } from './context-manager.js';
import type { LongTermMemory } from '../memory/long-term.js';

const SYSTEM_PROMPT = `你是 CMaster Bot，一个强大的企业级 AI 助手。

核心工作流 (Think-Plan-Act):
1. **思考 (Think)**: 在行动前，先进行深思熟虑，分析用户意图和潜在难点。
2. **规划 (Plan)**: 对于复杂任务，必须先调用 \`plan_task\` 工具制定步骤。
3. **执行 (Act)**: 按照计划一步步调用工具执行。
4. **反思 (Reflect)**: 如果工具执行失败，分析原因并修正计划。

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

/**
 * Agent 编排引擎
 * 负责协调 LLM 和技能的交互
 */
export class Agent {
    private llmGetter: () => LLMAdapter;
    private skillRegistry: SkillRegistry;
    private logger: Logger;
    private maxIterations: number;
    private contextManager: ContextManager;
    private longTermMemory?: LongTermMemory;

    constructor(options: {
        llm: LLMAdapter | (() => LLMAdapter);
        skillRegistry: SkillRegistry;
        logger: Logger;
        maxIterations?: number;
        maxContextTokens?: number;
        longTermMemory?: LongTermMemory;
    }) {
        this.llmGetter = typeof options.llm === 'function' ? options.llm : () => options.llm as LLMAdapter;
        this.skillRegistry = options.skillRegistry;
        this.logger = options.logger;
        this.maxIterations = options.maxIterations ?? 10;
        this.longTermMemory = options.longTermMemory;
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
        input: string,
        context: {
            sessionId: string;
            userId?: string;
            memory: MemoryAccess;
            history?: Message[];
            abortSignal?: AbortSignal;
            attachments?: Attachment[];
        }
    ): AsyncGenerator<ExecutionStep> {
        // Auto-inject relevant long-term memories into system prompt
        let systemContent = SYSTEM_PROMPT;
        if (this.longTermMemory) {
            try {
                const memories = await this.longTermMemory.search(input, 3);
                if (memories.length > 0) {
                    const memoryContext = memories.map(m => `- ${m.content}`).join('\n');
                    systemContent += `\n\n相关记忆:\n${memoryContext}`;
                }
            } catch (err) {
                this.logger.warn(`Failed to retrieve long-term memories: ${(err as Error).message}`);
            }
        }

        const systemMessage: Message = { role: 'system', content: systemContent };
        const currentInput: Message[] = [{
            role: 'user',
            content: input,
            attachments: context.attachments
        }];

        // Apply context window management to prevent exceeding LLM context limit
        const messages = await this.contextManager.trimMessages(
            systemMessage,
            context.history || [],
            currentInput,
            this.llm
        );

        // 合并内置工具和外部技能工具
        const externalTools = await this.skillRegistry.getToolDefinitions();
        const builtinTools = [PLAN_TOOL_DEF];
        if (this.longTermMemory) {
            builtinTools.push(MEMORY_REMEMBER_TOOL, MEMORY_RECALL_TOOL);
        }
        const tools = [...builtinTools, ...externalTools];

        let iteration = 0;

        while (iteration < this.maxIterations) {
            iteration++;
            this.logger.debug(`Agent iteration ${iteration}`);

            let fullContent = '';
            let toolCalls: any[] = [];

            // 调用 LLM (流式获取内容和工具调用)
            for await (const chunk of this.llm.chatStream(messages, { tools, abortSignal: context.abortSignal })) {
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

            const response: Message = {
                role: 'assistant',
                content: fullContent,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            };
            messages.push(response);

            // 如果没有工具调用，返回最终答案
            if (!response.toolCalls || response.toolCalls.length === 0) {
                yield {
                    type: 'answer',
                    content: typeof response.content === 'string' ? response.content : JSON.stringify(response.content),
                    timestamp: new Date(),
                };
                break;
            }

            // 处理工具调用
            for (const toolCall of response.toolCalls) {
                const params = JSON.parse(toolCall.function.arguments);
                const toolName = toolCall.function.name;

                // 2.1 处理内置规划工具
                if (toolName === 'plan_task') {
                    const { thought, steps } = params;

                    yield {
                        type: 'thought',
                        content: thought,
                        timestamp: new Date()
                    };

                    yield {
                        type: 'plan',
                        content: JSON.stringify(steps),
                        toolName: 'plan_task',
                        toolOutput: steps,
                        timestamp: new Date()
                    };

                    messages.push({
                        role: 'tool',
                        content: `Plan created: ${JSON.stringify(steps)}. Now precede to execute step 1.`,
                        toolCallId: toolCall.id
                    });

                    continue; // Skip normal skill execution
                }

                // 2.1b 处理内置记忆工具
                if (toolName === 'memory_remember' && this.longTermMemory) {
                    const { content: memContent, tags } = params;
                    const metadata = tags ? { tags: tags.split(',').map((t: string) => t.trim()) } : {};
                    const memId = await this.longTermMemory.remember(memContent, metadata, context.sessionId);

                    const result = `Memory saved (id: ${memId})`;
                    yield {
                        type: 'observation',
                        content: result,
                        toolName,
                        toolOutput: { id: memId },
                        timestamp: new Date(),
                    };
                    messages.push({ role: 'tool', content: result, toolCallId: toolCall.id });
                    continue;
                }

                if (toolName === 'memory_recall' && this.longTermMemory) {
                    const { query, limit: recallLimit } = params;
                    const memories = await this.longTermMemory.search(query, recallLimit ?? 5);
                    const resultStr = memories.length > 0
                        ? memories.map(m => `- ${m.content}`).join('\n')
                        : 'No relevant memories found.';

                    yield {
                        type: 'observation',
                        content: resultStr,
                        toolName,
                        toolOutput: memories,
                        timestamp: new Date(),
                    };
                    messages.push({ role: 'tool', content: resultStr, toolCallId: toolCall.id });
                    continue;
                }

                // 2.2 处理常规技能调用
                // const [skillName, actionName] = toolName.split('.'); // Registry now handles routing

                yield {
                    type: 'action',
                    content: `Calling ${toolName}`,
                    toolName: toolName,
                    toolInput: params,
                    timestamp: new Date(),
                };

                try {
                    // 创建技能上下文
                    const skillContext: SkillContext = {
                        sessionId: context.sessionId,
                        userId: context.userId,
                        memory: context.memory,
                        logger: this.logger,
                        config: {},
                    };

                    // 执行技能，带超时保护 (默认 60 秒)
                    const result = await this.executeWithTimeout(
                        () => this.skillRegistry.executeAction(toolName, params, skillContext),
                        60000,
                        toolName
                    );

                    const resultStr = typeof result === 'string'
                        ? result
                        : JSON.stringify(result, null, 2);

                    yield {
                        type: 'observation',
                        content: resultStr,
                        toolName: toolName,
                        toolOutput: result,
                        timestamp: new Date(),
                    };

                    // 添加工具结果到消息
                    messages.push({
                        role: 'tool',
                        content: resultStr,
                        toolCallId: toolCall.id,
                    });
                } catch (error: any) {
                    const errorMsg = `Error: ${error.message}`;

                    yield {
                        type: 'observation',
                        content: errorMsg,
                        toolName: toolName,
                        toolOutput: { error: error.message },
                        timestamp: new Date(),
                    };

                    messages.push({
                        role: 'tool',
                        content: errorMsg,
                        toolCallId: toolCall.id,
                    });
                }
            }
        }

        if (iteration >= this.maxIterations) {
            yield {
                type: 'answer',
                content: '抱歉，我已达到最大执行步骤限制。请尝试将任务拆分为更小的步骤。',
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
    public getSkillRegistry(): SkillRegistry {
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
