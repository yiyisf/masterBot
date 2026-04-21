/**
 * agent-tools.ts
 *
 * 所有内置工具定义（ToolDefinition）、系统提示词常量，以及工具相关的纯函数辅助工具。
 * 从 agent.ts 拆分，减少单文件规模，便于独立测试和维护。
 */

import type { ToolDefinition, Message } from '../types.js';

// ─────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────

export const SYSTEM_PROMPT = `你是 CMaster Bot，一个强大的企业级 AI 助手。

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

// ─────────────────────────────────────────────
// Built-in Tool Definitions
// ─────────────────────────────────────────────

export const PLAN_TOOL_DEF: ToolDefinition = {
    type: 'function',
    function: {
        name: 'plan_task',
        description: 'Create or update a execution plan for complex tasks',
        parameters: {
            type: 'object',
            properties: {
                thought: { type: 'string', description: 'The reasoning behind this plan (Thinking process)' },
                steps: { type: 'array', items: { type: 'string' }, description: 'List of actionable steps to complete the task' },
            },
            required: ['thought', 'steps'],
        },
    },
};

export const MEMORY_REMEMBER_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'memory_remember',
        description: 'Save important information to long-term memory for future recall across sessions. ' +
            'Use category to classify: user (preferences), operational (ops patterns), governance (rules/decisions), ' +
            'skill (skill tips), correction (corrected mistakes), reference (external pointers).',
        parameters: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'The information to remember' },
                category: {
                    type: 'string',
                    enum: ['user', 'operational', 'governance', 'skill', 'correction', 'reference'],
                    description: 'Memory category (default: user)',
                },
                topic: { type: 'string', description: 'Short filename-safe topic identifier, e.g. "cloud-quota-lessons"' },
                tags: { type: 'string', description: 'Optional comma-separated tags for additional categorization' },
            },
            required: ['content'],
        },
    },
};

export const MEMORY_RECALL_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'memory_recall',
        description: 'Search long-term memory for previously saved information',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The search query to find relevant memories' },
                limit: { type: 'number', description: 'Maximum number of results (default: 5)' },
            },
            required: ['query'],
        },
    },
};

export const DAG_CREATE_TASK_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'dag_create_task',
        description: 'Create a sub-task in the DAG for complex task decomposition. The description can be plain text or a JSON tool call: {"tool":"skill.action","params":{...}}',
        parameters: {
            type: 'object',
            properties: {
                description: { type: 'string', description: 'Task description or JSON tool call specification' },
                dependencies: { type: 'array', items: { type: 'string' }, description: 'Optional array of task IDs that must complete before this task' },
            },
            required: ['description'],
        },
    },
};

export const DAG_GET_STATUS_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'dag_get_status',
        description: 'View the current DAG status including all tasks and their dependencies',
        parameters: { type: 'object', properties: {}, required: [] },
    },
};

export const DAG_EXECUTE_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'dag_execute',
        description: 'Execute all ready tasks in the DAG in parallel, respecting dependency order. Continues until no more tasks are ready.',
        parameters: { type: 'object', properties: {}, required: [] },
    },
};

export const SKILL_GENERATE_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'skill_generate',
        description: "Automatically generate, install and hot-reload a new skill using AI. Use when the user requests a capability that doesn't exist yet.",
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Skill name (lowercase, hyphen-separated, e.g. "weather-api")' },
                description: { type: 'string', description: 'What the skill does' },
                actions: {
                    type: 'array',
                    items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } },
                    description: 'List of actions with name and description',
                },
            },
            required: ['name', 'description', 'actions'],
        },
    },
};

export const DELEGATE_AGENT_TOOL: ToolDefinition = {
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

export const KNOWLEDGE_SEARCH_TOOL: ToolDefinition = {
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

export const SESSION_RECALL_TOOL: ToolDefinition = {
    type: 'function',
    function: {
        name: 'session_recall',
        description: 'Query historical events from the current session event log. Supports filtering by event type, tool name, or time range.',
        parameters: {
            type: 'object',
            properties: {
                types: { type: 'array', items: { type: 'string' }, description: 'Filter by event types (e.g. ["tool_call","tool_result","tool_error"])' },
                toolName: { type: 'string', description: 'Filter events for a specific tool name' },
                last: { type: 'number', description: 'Return only the last N events (default: 20)' },
                fromTimestamp: { type: 'number', description: 'Unix ms start timestamp (inclusive)' },
                toTimestamp: { type: 'number', description: 'Unix ms end timestamp (inclusive)' },
            },
            required: [],
        },
    },
};

/** All built-in tool names for fast lookup */
export const BUILTIN_TOOL_NAMES = new Set([
    'plan_task',
    'memory_remember',
    'memory_recall',
    'dag_create_task',
    'dag_get_status',
    'dag_execute',
    'skill_generate',
    'delegate_to_agent',
    'knowledge_search',
    'session_recall',
]);

// ─────────────────────────────────────────────
// Tool Safety Helpers
// ─────────────────────────────────────────────

/**
 * Detect whether a tool call requires human confirmation before execution.
 * Returns a human-readable reason string if dangerous, null if safe.
 */
export function isDangerousToolCall(toolName: string, params: Record<string, unknown>): string | null {
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

// ─────────────────────────────────────────────
// Context Repair Helpers
// ─────────────────────────────────────────────

/**
 * 构建最小合法上下文，避免孤立 tool 消息导致 400 错误。
 *
 * 规则：
 * 1. 从消息末尾向前扫描，收集最近的完整 assistant(tool_calls)+tool 配对。
 * 2. tool 结果内容超过 2000 字符时截断，防止下一轮再次溢出。
 * 3. 始终保留最后一条 user 消息（提供对话锚点）。
 * 4. 不包含第 0 条（system），调用方自行拼接。
 */
export function buildMinimalContext(messages: Message[]): Message[] {
    const MAX_TOOL_CONTENT = 2000;
    const rest = messages.slice(1); // messages[0] 是 system
    if (rest.length === 0) return [];

    const result: Message[] = [];
    let i = rest.length - 1;

    while (i >= 0) {
        const msg = rest[i];

        if (msg.role === 'tool') {
            let j = i - 1;
            while (j >= 0 && rest[j].role !== 'assistant') j--;

            if (j >= 0 && Array.isArray((rest[j] as any).tool_calls) && (rest[j] as any).tool_calls.length > 0) {
                const toolMsgs: Message[] = [];
                for (let k = i; k >= j + 1; k--) {
                    const t = rest[k];
                    if (t.role === 'tool') {
                        const content = typeof t.content === 'string' && t.content.length > MAX_TOOL_CONTENT
                            ? t.content.slice(0, MAX_TOOL_CONTENT) + '\n[内容已截断]'
                            : t.content;
                        toolMsgs.unshift({ ...t, content } as Message);
                    } else {
                        toolMsgs.unshift(t);
                    }
                }
                result.unshift(rest[j], ...toolMsgs);
                i = j - 1;
                break;
            } else {
                i--; // 孤立 tool 消息，丢弃
            }
        } else if (msg.role === 'user') {
            result.unshift(msg);
            i--;
            break;
        } else {
            i--;
        }
    }

    // 确保至少有一条 user 消息作为上下文锚点
    const hasUser = result.some(m => m.role === 'user');
    if (!hasUser) {
        for (let k = rest.length - 1; k >= 0; k--) {
            if (rest[k].role === 'user') {
                result.unshift(rest[k]);
                break;
            }
        }
    }

    return result;
}
