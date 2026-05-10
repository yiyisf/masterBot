# Phase 2: 现有逻辑 → Hook 事件映射

本文档说明哪些现有实现已经通过 Hook 接口抽象，哪些是 Phase 2 新增的接入点。

## 已映射

| 现有逻辑 | 文件位置 | 对应 Hook 事件 | Hook 实现 |
|----------|----------|---------------|-----------|
| `CommandSandbox.validate()` | `src/skills/sandbox.ts` | `PreToolUse` | `builtin/sandbox-hook.ts` |
| `waitForApproval()` | `src/core/interrupt-coordinator.ts` | `PermissionRequest` | `builtin/hitl-hook.ts` |
| `longTermMemory.search()` 注入 | `src/core/agent.ts:145-155` | `UserPromptSubmit` | `builtin/memory-hook.ts` |
| `auditRepository.createExecution()` | `src/core/audit-repository.ts` | `SessionStart/End`, `PostToolUse*` | `builtin/audit-hook.ts` |
| `otelObserver.startAgentSpan()` | `src/observability/otel.ts` | `SessionStart/End`, `PostToolUse*` | `builtin/otel-hook.ts` |

## 未映射（Phase 2 stub）

| 关注点 | 计划 Phase | 说明 |
|--------|-----------|------|
| PII 脱敏 | Phase 6 | `UserPromptSubmit` hook 已占位，等待 Presidio/AWS Comprehend 集成 |
| Tool 自动重试状态机 | Phase 4 | `PostToolUseFailure` hook 已占位，日志记录 retryable 错误 |
| SubagentStart/Stop | Phase 4 | multi-agent 委托时触发，当前预留 |
| PreCompact | Phase 5 | 上下文压缩前通知，当前预留 |
| Stop | Phase 3 | ClaudeManagedAgent 停止事件，当前预留 |
| Notification | Phase 7 | IM 通知集成，当前预留 |

## 注意：Legacy Agent 仍然保留自己的内部实现

`LegacySelfHostedAgent` 包装 `Agent` 类，后者内部已有：
- `longTermMemory.search()` 注入（agent.ts:145-155）
- `spanRecorder` 追踪（agent.ts）

Phase 2 的内置 Hook 是为 **ClaudeManagedAgent**（Phase 3）设计的接入点，
不会与 Legacy 内部实现冲突。Phase 3 完成后将统一迁移。
