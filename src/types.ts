import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

// ============ LLM Types ============

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
    id?: string;
    role: MessageRole;
    content: string | MessageContentPart[];
    name?: string;
    toolCallId?: string;
    toolCalls?: ToolCall[];
    attachments?: Attachment[];
}

export type MessageContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

export interface Attachment {
    id: string;
    name: string;
    type: string;
    url?: string;
    base64?: string;
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
    abortSignal?: AbortSignal;
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
    type: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'custom';
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTokens?: number;
    embeddingModel?: string;
}

// ============ Skill Types ============

export interface SkillMetadata {
    name: string;
    version: string;
    description: string;
    author?: string;
    dependencies?: Record<string, string>;
    loadError?: string;              // 加载失败原因
    status?: 'active' | 'degraded'; // 可用性状态
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

export interface SkillSource {
    name: string; // e.g., "local", "github-mcp"
    type: 'local' | 'mcp' | 'openapi';

    initialize(): Promise<void>;
    getTools(): Promise<ToolDefinition[]>;
    execute(toolName: string, params: Record<string, unknown>, context: SkillContext): Promise<unknown>;
    destroy?(): Promise<void>;
}

export interface SkillContext {
    sessionId: string;
    userId?: string;
    role?: string;
    memory: MemoryAccess;
    logger: Logger;
    config: Record<string, unknown>;
    llm?: unknown;
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
    type: 'thought' | 'plan' | 'action' | 'observation' | 'answer' | 'content' | 'task_created' | 'task_completed' | 'task_failed' | 'meta' | 'suggestions' | 'interrupt' | 'context_compressed' | 'workflow_generated' | 'grading' | 'grade_result' | 'agent_spawned';
    content: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolOutput?: unknown;
    duration?: number;    // ms — tool call duration
    taskId?: string;
    assistantMessageId?: string;
    items?: string[];
    // interrupt fields
    interruptId?: string;
    interruptReason?: string;
    // Phase 21: multi-agent delegation
    delegatedFrom?: string;  // workerId — 标记来自哪个 Worker 的步骤
    traceId?: string;
    spanId?: string;
    // Phase 22: context compression
    droppedCount?: number;
    timestamp: Date;
}

// ============ Meta-Harness Types ============

/**
 * ToolResult — 统一工具执行结果（不抛异常，错误作为值返回）
 * Brain/Hands 边界的标准信封：任何 skill 执行失败一律转换为 ToolResult.error
 */
export type ToolResult =
    | { kind: 'ok'; value: string }
    | { kind: 'error'; message: string; retryable: boolean };

/**
 * SessionEvent — append-only 会话事件日志条目
 * Session 层独立于 Harness 进程存活，支持 wake 恢复
 */
export type SessionEventType =
    | 'session_start'
    | 'session_end'
    | 'llm_request'
    | 'llm_response'
    | 'tool_call'
    | 'tool_result'
    | 'tool_error'
    | 'harness_wake'
    | 'harness_transform';

export interface SessionEvent {
    id: string;
    sessionId: string;
    timestamp: number;
    type: SessionEventType;
    payload: Record<string, unknown>;
    causedBy?: string;  // parent event id
}

// ============ Gateway Types ============

export interface ChatRequest {
    message: string;
    /** Multimodal content parts (text + image_url). When present, overrides `message`. */
    messageContent?: MessageContentPart[];
    sessionId?: string;
    userId?: string;
    stream?: boolean;
    context?: Record<string, unknown>;
    history?: Message[];
    attachments?: Attachment[];
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
    agent: {
        maxIterations: number;
        maxContextTokens: number;
    };
    memory: {
        shortTerm: {
            maxMessages: number;
            maxSessions: number;
            ttlSeconds: number;
        };
        longTerm: {
            enabled: boolean;
            vectorDb: string;
            chromaUrl?: string;
            collectionName: string;
        };
    };
    skills: {
        autoLoad: boolean;
        directories: string[];
        shell?: {
            preferGitBash?: boolean;
            sandbox?: {
                enabled: boolean;
                mode: 'blocklist' | 'allowlist';
                blocklist?: string[];
                allowlist?: string[];
            };
        };
    };
    auth?: {
        enabled: boolean;
        mode: 'api-key' | 'jwt';
        apiKeys?: string[];
        jwtSecret?: string;
    };
    queue?: {
        redis: {
            url: string;
        };
    };
    logging: {
        level: string;
        prettyPrint: boolean;
    };
    im?: {
        enabled: boolean;
        platform: string;
        feishu?: {
            appId: string;
            appSecret: string;
            verificationToken: string;
            encryptKey: string;
        };
        defaultRole?: string;
        hitlTimeoutMinutes?: number;
    };
    audit?: {
        enabled: boolean;
        retentionDays: number;
    };
}

export interface McpServerConfig {
    id: string;
    name: string;
    type: 'stdio' | 'sse' | 'streamable-http';
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    enabled: boolean;
}
