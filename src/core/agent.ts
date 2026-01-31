import { nanoid } from 'nanoid';
import type {
    LLMAdapter,
    Message,
    ToolDefinition,
    ExecutionStep,
    SkillContext,
    Logger,
    MemoryAccess
} from '../types.js';
import { SkillRegistry } from '../skills/registry.js';

const SYSTEM_PROMPT = `你是 CMaster Bot，一个强大的企业级 AI 助手。

你可以使用以下工具来完成任务。当需要执行操作时，请调用相应的工具。

工作原则：
1. 分析用户请求，确定需要执行的步骤
2. 使用合适的工具来完成每个步骤
3. 清晰地解释你的操作和结果
4. 如果任务失败，提供有用的错误信息和建议

安全原则：
1. 不执行可能造成数据丢失的危险操作，除非用户明确确认
2. 不访问敏感系统文件
3. 保护用户隐私数据`;

/**
 * Agent 编排引擎
 * 负责协调 LLM 和技能的交互
 */
export class Agent {
    private llm: LLMAdapter;
    private skillRegistry: SkillRegistry;
    private logger: Logger;
    private maxIterations: number;

    constructor(options: {
        llm: LLMAdapter;
        skillRegistry: SkillRegistry;
        logger: Logger;
        maxIterations?: number;
    }) {
        this.llm = options.llm;
        this.skillRegistry = options.skillRegistry;
        this.logger = options.logger;
        this.maxIterations = options.maxIterations ?? 10;
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
        }
    ): AsyncGenerator<ExecutionStep> {
        const messages: Message[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...(context.history || []),
            { role: 'user', content: input },
        ];

        const tools = this.skillRegistry.getToolDefinitions();
        let iteration = 0;

        while (iteration < this.maxIterations) {
            iteration++;
            this.logger.debug(`Agent iteration ${iteration}`);

            // 调用 LLM
            const response = await this.llm.chat(messages, { tools });
            messages.push(response);

            // 如果没有工具调用，返回最终答案
            if (!response.toolCalls || response.toolCalls.length === 0) {
                yield {
                    type: 'answer',
                    content: response.content,
                    timestamp: new Date(),
                };
                break;
            }

            // 处理工具调用
            for (const toolCall of response.toolCalls) {
                const [skillName, actionName] = toolCall.function.name.split('.');
                const params = JSON.parse(toolCall.function.arguments);

                yield {
                    type: 'action',
                    content: `Calling ${toolCall.function.name}`,
                    toolName: toolCall.function.name,
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

                    // 执行技能
                    const result = await this.skillRegistry.executeAction(
                        skillName,
                        actionName,
                        params,
                        skillContext
                    );

                    const resultStr = typeof result === 'string'
                        ? result
                        : JSON.stringify(result, null, 2);

                    yield {
                        type: 'observation',
                        content: resultStr,
                        toolName: toolCall.function.name,
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
                        toolName: toolCall.function.name,
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
}
