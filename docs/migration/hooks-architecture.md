# Hooks 架构设计（Phase 2）

## 概述

Phase 2 引入统一 Agent 接口（`IAgent`）和 12 事件 Hook 系统，将横切关注点（沙箱、审计、OTel、内存注入等）从 Agent 核心逻辑中解耦。

---

## 目录结构

```
src/core/
├── agent/
│   ├── types.ts          # IAgent 接口 + AgentInput/AgentEvent/AgentCapabilities
│   ├── legacy.ts         # LegacySelfHostedAgent（包装现有 Agent 类）
│   └── router.ts         # AgentRouter + EnvFeatureFlagService
└── hooks/
    ├── types.ts           # 12 个 HookEvent 类型 + HookFn / HookResult
    ├── registry.ts        # HookRegistry（注册、优先级、顺序执行）
    └── builtin/
        ├── sandbox-hook.ts    # 5a: Shell 沙箱拦截
        ├── hitl-hook.ts       # 5b: Human-in-the-Loop 审批
        ├── memory-hook.ts     # 5c: 长期记忆注入
        ├── pii-hook.ts        # 5d: PII 脱敏（stub，Phase 6 完成）
        ├── retry-hook.ts      # 5e: 自动重试（stub，Phase 4 完成）
        ├── audit-hook.ts      # 5f: 合规审计记录
        └── otel-hook.ts       # 5g: OTel Span 桥接
```

---

## IAgent 接口

```typescript
interface IAgent {
    execute(input: AgentInput): AsyncGenerator<AgentEvent>;
    resume(sessionId: string): AsyncGenerator<AgentEvent>;
    fork(sessionId: string): Promise<string>;
    checkpoint(sessionId: string): Promise<string>;
    capabilities(): AgentCapabilities;
}
```

**AgentRouter** 按 provider + feature flag 路由：
- `provider='anthropic'` + `FEATURE_CLAUDE_MANAGED_AGENT=true` → ClaudeManagedAgent（Phase 3 注入）
- 其他情况 → `LegacySelfHostedAgent`（包装现有 Agent 类，无破坏性变更）

---

## 12 个 Hook 事件

| 事件 | 触发时机 | 内置 Hook |
|------|----------|-----------|
| `PreToolUse` | Agent 执行工具前 | sandbox-hook |
| `PostToolUse` | 工具执行成功后 | audit-hook, otel-hook |
| `PostToolUseFailure` | 工具执行失败后 | retry-hook, audit-hook, otel-hook |
| `UserPromptSubmit` | 用户消息进入 Agent 前 | memory-hook, pii-hook |
| `SessionStart` | 会话开始 | audit-hook, otel-hook |
| `SessionEnd` | 会话结束 | audit-hook, otel-hook |
| `SubagentStart` | 委托子 Agent 启动 | （预留） |
| `SubagentStop` | 子 Agent 返回 | （预留） |
| `PreCompact` | 上下文压缩前 | （预留） |
| `PermissionRequest` | Agent 请求高危权限 | hitl-hook |
| `Stop` | Agent 主循环退出 | （预留） |
| `Notification` | Agent 发送通知 | （预留） |

---

## HookRegistry 执行语义

1. 同类型 hook 按 `priority` 升序执行（越小越先）
2. Hook 返回 `{ abort: true }` 时立即停止 pipeline，后续 hook 不执行
3. Hook 返回 `{ modified: {...} }` 时将修改后的事件传给后续 hook
4. Hook 内部抛异常时：记录错误日志，继续执行后续 hook（不中止主流程）

---

## 与 Phase 1 OTel 的关系

Phase 1 的 `SpanRecorder` 双写桥接（SQLite + OTel）保持不变。
Phase 2 的 `otel-hook.ts` 在 Hook 层补充 SessionStart/End 和 ToolUse 的 Span，
两者共存，互不影响。Phase 4 将统一追踪入口。

---

## 注册 Hook 示例

```typescript
import { globalHookRegistry } from './hooks/registry.js';
import { createSandboxHook } from './hooks/builtin/sandbox-hook.js';

globalHookRegistry.register({
    id: 'sandbox',
    eventType: 'PreToolUse',
    priority: 0,
    fn: createSandboxHook({ enabled: true, mode: 'blocklist' }),
});
```

---

## 设计决策

| 决策 | 原因 |
|------|------|
| Hook 不抛出即继续 | 横切关注点的失败不应中断主 Agent 流程 |
| priority 数字排序 | 比名称排序更直观，管理员可精确控制顺序 |
| HookResult.modified 浅合并 | 避免复杂 diff 逻辑；事件类型已经是 plain object |
| 内置 Hook 均为工厂函数 | 便于注入依赖（sandbox config、longTermMemory 等） |
| PII/Retry 为 stub | 避免 Phase 2 引入大依赖（presidio、state machine）；占位接口已稳定 |
