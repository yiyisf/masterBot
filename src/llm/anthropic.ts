import Anthropic from '@anthropic-ai/sdk';
import type {
    LLMAdapter,
    Message,
    ChatOptions,
    StreamChunk,
    LLMConfig,
    ToolDefinition
} from '../types.js';

/**
 * Anthropic 标准适配器
 * 支持 Claude 系列模型
 */
export class AnthropicAdapter implements LLMAdapter {
    readonly provider = 'anthropic';
    private client: Anthropic;
    private config: LLMConfig;

    constructor(config: LLMConfig) {
        this.config = config;
        this.client = new Anthropic({
            apiKey: config.apiKey,
            baseURL: config.baseUrl || undefined,
        });
    }

    async chat(messages: Message[], options?: ChatOptions): Promise<Message> {
        const { systemPrompt, convertedMessages } = this.convertMessages(messages);

        const response = await this.client.messages.create({
            model: options?.model ?? this.config.model,
            max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
            system: systemPrompt,
            messages: convertedMessages,
            tools: options?.tools ? this.convertTools(options.tools) : undefined,
        }, { signal: options?.abortSignal });

        // Process response content
        let content = '';
        const toolCalls: Message['toolCalls'] = [];

        for (const block of response.content) {
            if (block.type === 'text') {
                content += block.text;
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    type: 'function',
                    function: {
                        name: block.name,
                        arguments: JSON.stringify(block.input),
                    },
                });
            }
        }

        return {
            role: 'assistant',
            content,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };
    }

    async *chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<StreamChunk> {
        const { systemPrompt, convertedMessages } = this.convertMessages(messages);

        const stream = this.client.messages.stream({
            model: options?.model ?? this.config.model,
            max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
            system: systemPrompt,
            messages: convertedMessages,
            tools: options?.tools ? this.convertTools(options.tools) : undefined,
        }, { signal: options?.abortSignal });

        let currentToolCall: StreamChunk['toolCall'] | null = null;
        let currentToolInput = '';

        for await (const event of stream) {
            if (event.type === 'content_block_start') {
                const block = event.content_block;
                if (block.type === 'tool_use') {
                    currentToolCall = {
                        id: block.id,
                        type: 'function',
                        function: {
                            name: block.name,
                            arguments: '',
                        },
                    };
                    currentToolInput = '';
                }
            } else if (event.type === 'content_block_delta') {
                const delta = event.delta;
                if (delta.type === 'text_delta') {
                    yield { type: 'content', content: delta.text };
                } else if (delta.type === 'input_json_delta' && currentToolCall) {
                    currentToolInput += delta.partial_json;
                }
            } else if (event.type === 'content_block_stop') {
                if (currentToolCall) {
                    currentToolCall.function = {
                        name: currentToolCall.function?.name ?? '',
                        arguments: currentToolInput,
                    };
                    yield { type: 'tool_call', toolCall: currentToolCall };
                    currentToolCall = null;
                    currentToolInput = '';
                }
            } else if (event.type === 'message_stop') {
                yield { type: 'done' };
            }
        }
    }

    async embeddings(_texts: string[]): Promise<number[][]> {
        // Anthropic 不直接提供 embeddings API
        // 需要使用其他服务或自定义实现
        throw new Error('Anthropic adapter does not support embeddings. Use OpenAI adapter for embeddings.');
    }

    private convertMessages(messages: Message[]): {
        systemPrompt: string;
        convertedMessages: Anthropic.MessageParam[];
    } {
        let systemPrompt = '';
        const convertedMessages: Anthropic.MessageParam[] = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                systemPrompt = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                continue;
            }

            let content: any = msg.content;
            if (Array.isArray(msg.content)) {
                content = msg.content.map(part => {
                    if (part.type === 'image_url') {
                        // Anthropic expects base64 for images in the message array usually, 
                        // but here we just map our structure. 
                        // Note: Claude 3 supports image blocks.
                        return {
                            type: 'image',
                            source: {
                                type: 'url', // Assuming the model/adapter handles this or we need to convert to base64
                                url: part.image_url.url
                            }
                        } as any;
                    }
                    return { type: 'text', text: part.text };
                });
            } else if (msg.attachments && msg.attachments.length > 0) {
                // If there are attachments and content is a string, wrap it.
                const parts: any[] = [{ type: 'text', text: msg.content }];
                for (const att of msg.attachments) {
                    if (att.type.startsWith('image/')) {
                        parts.push({
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: att.type,
                                data: att.base64 // We need base64 for Anthropic images
                            }
                        });
                    }
                }
                content = parts;
            }

            if (msg.role === 'user') {
                convertedMessages.push({
                    role: 'user',
                    content: content,
                });
            } else if (msg.role === 'assistant') {
                const responseContent: Anthropic.ContentBlock[] = [];

                if (Array.isArray(content)) {
                    responseContent.push(...content);
                } else if (content) {
                    responseContent.push({ type: 'text', text: content });
                }

                if (msg.toolCalls) {
                    for (const tc of msg.toolCalls) {
                        responseContent.push({
                            type: 'tool_use',
                            id: tc.id,
                            name: tc.function.name,
                            input: JSON.parse(tc.function.arguments),
                        });
                    }
                }

                convertedMessages.push({
                    role: 'assistant',
                    content: responseContent.length > 0 ? responseContent : (typeof content === 'string' ? content : ''),
                });
            } else if (msg.role === 'tool') {
                convertedMessages.push({
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: msg.toolCallId ?? '',
                        content: typeof content === 'string' ? content : JSON.stringify(content),
                    }],
                });
            }
        }

        return { systemPrompt, convertedMessages };
    }

    private convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
        return tools.map(tool => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters as Anthropic.Tool.InputSchema,
        }));
    }
}
