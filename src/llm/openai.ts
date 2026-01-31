import OpenAI from 'openai';
import type {
    LLMAdapter,
    Message,
    ChatOptions,
    StreamChunk,
    LLMConfig,
    ToolDefinition
} from '../types.js';

/**
 * OpenAI 标准适配器
 * 支持所有兼容 OpenAI API 的模型服务
 */
export class OpenAIAdapter implements LLMAdapter {
    readonly provider = 'openai';
    private client: OpenAI;
    private config: LLMConfig;

    constructor(config: LLMConfig) {
        this.config = config;
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseUrl,
        });
    }

    async chat(messages: Message[], options?: ChatOptions): Promise<Message> {
        const response = await this.client.chat.completions.create({
            model: options?.model ?? this.config.model,
            messages: this.convertMessages(messages),
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
            tools: options?.tools ? this.convertTools(options.tools) : undefined,
        });

        const choice = response.choices[0];
        const message = choice.message;

        return {
            role: 'assistant',
            content: message.content ?? '',
            toolCalls: message.tool_calls?.map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                },
            })),
        };
    }

    async *chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<StreamChunk> {
        const stream = await this.client.chat.completions.create({
            model: options?.model ?? this.config.model,
            messages: this.convertMessages(messages),
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
            tools: options?.tools ? this.convertTools(options.tools) : undefined,
            stream: true,
        });

        let currentToolCall: Partial<StreamChunk['toolCall']> | null = null;

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;

            if (delta?.content) {
                yield { type: 'content', content: delta.content };
            }

            if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (tc.id) {
                        // New tool call
                        if (currentToolCall) {
                            yield { type: 'tool_call', toolCall: currentToolCall };
                        }
                        currentToolCall = {
                            id: tc.id,
                            type: 'function',
                            function: {
                                name: tc.function?.name ?? '',
                                arguments: tc.function?.arguments ?? '',
                            },
                        };
                    } else if (tc.function?.arguments && currentToolCall) {
                        // Continue building arguments
                        currentToolCall.function = {
                            name: currentToolCall.function?.name ?? '',
                            arguments: (currentToolCall.function?.arguments ?? '') + tc.function.arguments,
                        };
                    }
                }
            }

            if (chunk.choices[0]?.finish_reason) {
                if (currentToolCall) {
                    yield { type: 'tool_call', toolCall: currentToolCall };
                }
                yield { type: 'done' };
            }
        }
    }

    async embeddings(texts: string[]): Promise<number[][]> {
        const response = await this.client.embeddings.create({
            model: 'text-embedding-ada-002',
            input: texts,
        });

        return response.data.map(d => d.embedding);
    }

    private convertMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
        return messages.map(msg => {
            if (msg.role === 'tool') {
                return {
                    role: 'tool' as const,
                    content: msg.content,
                    tool_call_id: msg.toolCallId ?? '',
                };
            }

            if (msg.role === 'assistant' && msg.toolCalls) {
                return {
                    role: 'assistant' as const,
                    content: msg.content || null,
                    tool_calls: msg.toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: {
                            name: tc.function.name,
                            arguments: tc.function.arguments,
                        },
                    })),
                };
            }

            return {
                role: msg.role as 'system' | 'user' | 'assistant',
                content: msg.content,
            };
        });
    }

    private convertTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
        return tools.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters,
            },
        }));
    }
}
