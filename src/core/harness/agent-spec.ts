/**
 * AgentSpec — 声明式 Agent 规格定义
 * Phase 23: Managed Agents Harness
 *
 * 取代原 WorkerAgentConfig，支持完整的权限、资源、记忆、Hook 和 Outcome 声明。
 * 通过 SOUL.md frontmatter 加载，也可由 API 动态注册。
 */

import type { OutcomeSpec } from './outcome-spec.js';

// ────────────────────────────────────────────────────────────────────────────
// Hook 定义
// ────────────────────────────────────────────────────────────────────────────

export type HookDef =
    | { type: 'log'; config: { level?: 'info' | 'warn' | 'error'; message?: string } }
    | { type: 'approve'; config: { pattern: string; message?: string } }
    | { type: 'notify'; config: { channel: 'im' | 'dingtalk' | 'feishu'; template: string } }
    | { type: 'shell'; config: { command: string; timeout?: number } };

export interface HookSet {
    /** Agent 开始执行时 */
    onStart?: HookDef[];
    /** 每次工具调用前（可通过 approve 阻断）*/
    onToolCall?: HookDef[];
    /** 每次工具调用后 */
    onToolResult?: HookDef[];
    /** Agent 完成时 */
    onComplete?: HookDef[];
    /** Agent 失败时 */
    onError?: HookDef[];
}

// ────────────────────────────────────────────────────────────────────────────
// AgentSpec 主体
// ────────────────────────────────────────────────────────────────────────────

export interface AgentSpec {
    id: string;
    name: string;
    version: string;
    description: string;
    systemPrompt: string;

    /** 工具权限：支持 glob 模式，如 "file-manager.*", "shell.execute" */
    tools: {
        allow: string[];  // 白名单（为空则允许全部）
        deny: string[];   // 黑名单（优先于白名单）
    };

    resources: {
        maxIterations: number;  // 默认 10
        timeoutMs: number;      // 默认 60000
        /** 该 Spec 同时运行的最大实例数 */
        concurrency: number;    // 默认 3
        /** 指定 LLM 提供商（未设置则使用系统默认）*/
        preferredProvider?: string;
    };

    memory: {
        /** 长期记忆命名空间前缀（默认 spec.id）*/
        namespace: string;
        /** isolated: 独立上下文; shared: 继承父 Agent 的短期记忆 */
        scope: 'isolated' | 'shared';
    };

    hooks: HookSet;

    /** 任务结果质量评判（可选，启用后开启修订循环）*/
    outcome?: OutcomeSpec;
}

// ────────────────────────────────────────────────────────────────────────────
// 默认值工厂
// ────────────────────────────────────────────────────────────────────────────

export function defaultAgentSpec(partial: Partial<AgentSpec> & { id: string; name: string }): AgentSpec {
    return {
        version: '1.0.0',
        description: '',
        systemPrompt: `你是 ${partial.name}，${partial.description ?? '一个专业的 AI 助手'}。`,
        tools: { allow: [], deny: [] },
        resources: { maxIterations: 10, timeoutMs: 60_000, concurrency: 3 },
        memory: { namespace: partial.id, scope: 'isolated' },
        hooks: {},
        ...partial,
    };
}

// ────────────────────────────────────────────────────────────────────────────
// 运行时实例信息
// ────────────────────────────────────────────────────────────────────────────

export type AgentLifecycleState =
    | 'queued'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface AgentInstanceInfo {
    instanceId: string;
    specId: string;
    specName: string;
    state: AgentLifecycleState;
    task: string;
    revision: number;
    startedAt: Date;
    completedAt?: Date;
    /** 累计 step 数 */
    stepCount: number;
    /** 最近一次 Grader 评分 */
    lastScore?: number;
    error?: string;
}
