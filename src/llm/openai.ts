import OpenAI from 'openai';
import type {
    LLMAdapter,
    Message,
    ChatOptions,
    StreamChunk,
    LLMConfig,
    ToolDefinition,
    TokenUsageEvent
} from '../types.js';
import { fetch as undiciFetch } from 'undici';
import { getProxyDispatcher } from './proxy.js';

/**
 * P1-4: OpenAI 推理模型（o1/o3/o4/gpt-5 系列）已弃用 `max_tokens`，
 * 改用 `max_completion_tokens`，否则请求会报 400。按模型名路由参数，
 * 其余模型（含第三方 OpenAI 兼容端点）继续用 `max_tokens` 保持兼容。
 */
function usesMaxCompletionTokens(model: string): boolean {
    return /^o\d(-|$)/.test(model) || model.startsWith('gpt-5');
}

/**
 * OpenAI 标准适配器
 * 支持所有兼容 OpenAI API 的模型服务
 */
export class OpenAIAdapter implements LLMAdapter {
    readonly provider = 'openai';
    private client: OpenAI;
    private config: LLMConfig;
    /** P1-7: token 用量上报回调（由 LLMFactory 注入），适配器不再直接依赖 DB */
    private onUsage?: (usage: TokenUsageEvent) => void;

    constructor(config: LLMConfig, onUsage?: (usage: TokenUsageEvent) => void) {
        this.config = config;
        this.onUsage = onUsage;
        // P1-4: Node.js 内置 fetch 不读取 https_proxy 环境变量。EnvHttpProxyAgent 会自动探测
        // HTTP_PROXY/HTTPS_PROXY/NO_PROXY（未配置代理时透明直连），因此无需再手写环境变量判断分支。
        // dispatcher 必须与同一个 undici 包的 fetch 配合使用，否则 Node.js 内置 fetch
        // 与外部 undici dispatcher 版本不匹配会导致 APIConnectionError（openai v5+ 移除了 httpAgent，改为 fetchOptions.dispatcher）
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseUrl,
            fetch: undiciFetch as unknown as typeof globalThis.fetch,
            fetchOptions: { dispatcher: getProxyDispatcher() as never },
        });
    }

    async chat(messages: Message[], options?: ChatOptions): Promise<Message> {
        const activeModel = options?.model ?? this.config.model;
        const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 4096;
        const response = await this.client.chat.completions.create({
            model: activeModel,
            messages: this.convertMessages(messages),
            temperature: options?.temperature ?? 0.7,
            ...(usesMaxCompletionTokens(activeModel)
                ? { max_completion_tokens: maxTokens }
                : { max_tokens: maxTokens }),
            tools: options?.tools ? this.convertTools(options.tools) : undefined,
        }, { signal: options?.abortSignal });

        const choice = response.choices[0];
        const message = choice.message;

        this._reportUsage(options?.model ?? this.config.model, response.usage);

        return {
            role: 'assistant',
            content: message.content ?? '',
            // openai v6: tool_calls 为 function/custom 联合类型，仅处理 function 调用
            toolCalls: message.tool_calls
                ?.filter(tc => tc.type === 'function')
                .map(tc => ({
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
        const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 4096;
        const stream = await this.client.chat.completions.create({
            model: activeModel,
            messages: this.convertMessages(messages),
            temperature: options?.temperature ?? 0.7,
            ...(usesMaxCompletionTokens(activeModel)
                ? { max_completion_tokens: maxTokens }
                : { max_tokens: maxTokens }),
            tools: options?.tools ? this.convertTools(options.tools) : undefined,
            stream: true,
            stream_options: { include_usage: true },
        }, { signal: options?.abortSignal });

        let currentToolCall: Partial<StreamChunk['toolCall']> | null = null;

        for await (const chunk of stream) {
            // Record usage from the final usage-bearing chunk
            if (chunk.usage) {
                this._reportUsage(activeModel, chunk.usage);
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

    private _reportUsage(
        model: string,
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null | undefined
    ): void {
        if (!usage || !this.onUsage) return;
        try {
            this.onUsage({
                model,
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
                totalTokens: usage.total_tokens,
            });
        } catch {
            // non-fatal — 上报失败不应影响 LLM 调用本身
        }
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
