import OpenAI from 'openai';
import { nanoid } from 'nanoid';
import { db } from '../core/database.js';
import type {
    LLMAdapter,
    Message,
    ChatOptions,
    StreamChunk,
    LLMConfig,
    ToolDefinition
} from '../types.js';
import { HttpsProxyAgent } from 'https-proxy-agent';

function recordTokenUsage(model: string, usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null | undefined) {
    if (!usage) return;
    try {
        db.prepare(
            'INSERT INTO token_usage (id, model, prompt_tokens, completion_tokens, total_tokens) VALUES (?, ?, ?, ?, ?)'
        ).run(nanoid(), model, usage.prompt_tokens, usage.completion_tokens, usage.total_tokens);
    } catch {
        // non-fatal
    }
}

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
        // Node.js 18+ 内置 fetch 不读取 https_proxy 环境变量，
        // 当系统配置了代理时（常见于需要科学上网的环境），需手动注入 httpAgent
        const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY
            || process.env.http_proxy || process.env.HTTP_PROXY;
        const httpAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseUrl,
            ...(httpAgent ? { httpAgent } : {}),
        });
    }

    async chat(messages: Message[], options?: ChatOptions): Promise<Message> {
        const response = await this.client.chat.completions.create({
            model: options?.model ?? this.config.model,
            messages: this.convertMessages(messages),
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
            tools: options?.tools ? this.convertTools(options.tools) : undefined,
        }, { signal: options?.abortSignal });

        const choice = response.choices[0];
        const message = choice.message;

        recordTokenUsage(options?.model ?? this.config.model, response.usage);

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
        const activeModel = options?.model ?? this.config.model;
        const stream = await this.client.chat.completions.create({
            model: activeModel,
            messages: this.convertMessages(messages),
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
            tools: options?.tools ? this.convertTools(options.tools) : undefined,
            stream: true,
            stream_options: { include_usage: true },
        }, { signal: options?.abortSignal });

        let currentToolCall: Partial<StreamChunk['toolCall']> | null = null;

        for await (const chunk of stream) {
            // Record usage from the final usage-bearing chunk
            if (chunk.usage) {
                recordTokenUsage(activeModel, chunk.usage);
            }

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
            model: this.config.embeddingModel || 'text-embedding-3-small',
            input: texts,
        });

        return response.data.map(d => d.embedding);
    }

    private convertMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
        return messages.map(msg => {
            if (msg.role === 'tool') {
                return {
                    role: 'tool' as const,
                    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                    tool_call_id: msg.toolCallId ?? '',
                };
            }

            let content: any = msg.content;
            if (Array.isArray(msg.content)) {
                content = msg.content.map(part => {
                    if (part.type === 'image_url') {
                        return { type: 'image_url', image_url: { url: part.image_url.url } };
                    }
                    return { type: 'text', text: part.text };
                });
            }

            if (msg.role === 'assistant') {
                return {
                    role: 'assistant' as const,
                    content: (typeof content === 'string' || Array.isArray(content)) ? content : null,
                    tool_calls: msg.toolCalls?.map(tc => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: {
                            name: tc.function.name,
                            arguments: tc.function.arguments,
                        },
                    })),
                } as OpenAI.ChatCompletionAssistantMessageParam;
            }

            return {
                role: msg.role as 'system' | 'user',
                content: content,
            } as OpenAI.ChatCompletionMessageParam;
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
