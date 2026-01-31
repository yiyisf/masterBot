import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

// ============ LLM Types ============

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
    role: MessageRole;
    content: string;
    name?: string;
    toolCallId?: string;
    toolCalls?: ToolCall[];
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ChatOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: ToolDefinition[];
    stream?: boolean;
}

export interface StreamChunk {
    type: 'content' | 'tool_call' | 'done' | 'error';
    content?: string;
    toolCall?: Partial<ToolCall>;
    error?: string;
}

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface LLMAdapter {
    readonly provider: string;

    chat(messages: Message[], options?: ChatOptions): Promise<Message>;
    chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<StreamChunk>;
    embeddings(texts: string[]): Promise<number[][]>;
}

export interface LLMConfig {
    type: 'openai' | 'anthropic' | 'custom';
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTokens?: number;
}

// ============ Skill Types ============

export interface SkillMetadata {
    name: string;
    version: string;
    description: string;
    author?: string;
    dependencies?: Record<string, string>;
}

export interface SkillAction {
    name: string;
    description: string;
    parameters: Record<string, ParameterSchema>;
    handler: (ctx: SkillContext, params: Record<string, unknown>) => Promise<unknown>;
}

export interface ParameterSchema {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description?: string;
    required?: boolean;
    default?: unknown;
}

export interface Skill {
    metadata: SkillMetadata;
    actions: Map<string, SkillAction>;

    init?(): Promise<void>;
    destroy?(): Promise<void>;
}

export interface SkillContext {
    sessionId: string;
    userId?: string;
    memory: MemoryAccess;
    logger: Logger;
    config: Record<string, unknown>;
}

export interface SkillResult {
    success: boolean;
    data?: unknown;
    error?: string;
}

// ============ Memory Types ============

export interface MemoryEntry {
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    embedding?: number[];
    createdAt: Date;
}

export interface MemoryAccess {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown, ttl?: number): Promise<void>;
    search(query: string, limit?: number): Promise<MemoryEntry[]>;
}

// ============ Agent Types ============

export interface AgentConfig {
    llm: LLMConfig;
    skills: string[];
    systemPrompt?: string;
    maxIterations?: number;
}

export interface AgentTask {
    id: string;
    input: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    result?: unknown;
    error?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface ExecutionStep {
    type: 'thought' | 'action' | 'observation' | 'answer';
    content: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolOutput?: unknown;
    timestamp: Date;
}

// ============ Gateway Types ============

export interface ChatRequest {
    message: string;
    sessionId?: string;
    userId?: string;
    stream?: boolean;
    context?: Record<string, unknown>;
    history?: Message[];
}

export interface ChatResponse {
    sessionId: string;
    message: string;
    steps?: ExecutionStep[];
    toolResults?: Array<{
        tool: string;
        result: unknown;
    }>;
}

// ============ Utility Types ============

export interface Logger {
    debug(msg: string, ...args: unknown[]): void;
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
}

export interface Config {
    server: {
        port: number;
        host: string;
    };
    models: {
        default: string;
        providers: Record<string, LLMConfig>;
    };
    memory: {
        shortTerm: {
            maxMessages: number;
            ttlSeconds: number;
        };
        longTerm: {
            enabled: boolean;
            vectorDb: string;
            chromaUrl: string;
            collectionName: string;
        };
    };
    skills: {
        autoLoad: boolean;
        directories: string[];
    };
    queue: {
        redis: {
            url: string;
        };
    };
    logging: {
        level: string;
        prettyPrint: boolean;
    };
}
