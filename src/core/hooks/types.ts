/**
 * Phase 2: Hook 系统类型定义
 * 12 个标准事件，覆盖 Agent 生命周期的完整节点。
 */

// ─── 共用上下文 ────────────────────────────────────────────────────────────────

export interface HookContext {
    sessionId: string;
    userId: string;
    tenantId: string;
}

// ─── 事件定义 ─────────────────────────────────────────────────────────────────

export interface PreToolUseEvent {
    type: 'PreToolUse';
    toolName: string;
    toolInput: Record<string, unknown>;
    ctx: HookContext;
}

export interface PostToolUseEvent {
    type: 'PostToolUse';
    toolName: string;
    toolInput: Record<string, unknown>;
    result: unknown;
    durationMs: number;
    ctx: HookContext;
}

export interface PostToolUseFailureEvent {
    type: 'PostToolUseFailure';
    toolName: string;
    toolInput: Record<string, unknown>;
    error: string;
    durationMs: number;
    ctx: HookContext;
}

export interface UserPromptSubmitEvent {
    type: 'UserPromptSubmit';
    /** 经过 PII 脱敏后的 prompt（如未启用则与原始相同） */
    prompt: string;
    rawPrompt: string;
    ctx: HookContext;
}

export interface SessionStartEvent {
    type: 'SessionStart';
    ctx: HookContext;
}

export interface SessionEndEvent {
    type: 'SessionEnd';
    ctx: HookContext;
    totalSteps: number;
}

export interface SubagentStartEvent {
    type: 'SubagentStart';
    workerId: string;
    agentSpec: string;
    ctx: HookContext;
}

export interface SubagentStopEvent {
    type: 'SubagentStop';
    workerId: string;
    outcome: 'success' | 'failure' | 'timeout';
    ctx: HookContext;
}

export interface PreCompactEvent {
    type: 'PreCompact';
    droppedCount: number;
    ctx: HookContext;
}

export interface PermissionRequestEvent {
    type: 'PermissionRequest';
    toolName: string;
    reason: string;
    /** Hook 可 resolve true（允许）/ false（拒绝） */
    resolve: (approved: boolean) => void;
    ctx: HookContext;
}

export interface StopEvent {
    type: 'Stop';
    reason: 'max_iterations' | 'answer' | 'error' | 'abort';
    ctx: HookContext;
}

export interface NotificationEvent {
    type: 'Notification';
    level: 'info' | 'warn' | 'error';
    message: string;
    ctx: HookContext;
}

// ─── 联合类型 ─────────────────────────────────────────────────────────────────

export type HookEvent =
    | PreToolUseEvent
    | PostToolUseEvent
    | PostToolUseFailureEvent
    | UserPromptSubmitEvent
    | SessionStartEvent
    | SessionEndEvent
    | SubagentStartEvent
    | SubagentStopEvent
    | PreCompactEvent
    | PermissionRequestEvent
    | StopEvent
    | NotificationEvent;

export type HookEventType = HookEvent['type'];

// ─── Hook 定义 ────────────────────────────────────────────────────────────────

/**
 * HookResult 控制 pipeline 流转：
 * - void / undefined → 继续
 * - { abort: true } → 中止当前操作
 * - { modified } → 修改事件数据（仅部分事件类型支持）
 */
export interface HookResult {
    abort?: boolean;
    modified?: Partial<HookEvent>;
}

export type HookFn<E extends HookEvent = HookEvent> = (event: E) => Promise<HookResult | void> | HookResult | void;

export interface HookRegistration<E extends HookEvent = HookEvent> {
    id: string;
    eventType: E['type'];
    fn: HookFn<E>;
    /** 执行顺序，越小越先；默认 0 */
    priority?: number;
}
