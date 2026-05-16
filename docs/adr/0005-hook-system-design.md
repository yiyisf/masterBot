# ADR 0005: Hook 系统设计 — Registry 模式 + 12 生命周期事件

**Status**: Accepted  
**Date**: 2026-05-11  
**Phase**: P2 — Hooks 重构  
**Deciders**: yiyisf  

---

## Context

Phase 2 在 `IAgent` 接口稳定后，需要为 Agent 生命周期关注点（沙箱校验、HitL 审批、PII 脱敏、审计日志、OTel Span）提供一套扩展机制。

**核心问题**：
- 这些横切关注点在旧代码中散落在 `agent.ts`（615 行）各处，导致主流程可读性差
- SDK 自带 12 个生命周期 hook（`PreToolUse`、`PostToolUse` 等），需要与自研 Hook 体系兼容
- 业务团队需要能独立注册/注销 Hook，而不修改主 Agent 代码

---

## Decision

**实现 HookRegistry 注册中心 + 12 标准事件**，Hook 以插件形式注册，主流程通过 `registry.emit(event, payload)` 触发：

```
HookRegistry
  ├── UserPromptSubmit   → memory-hook（记忆注入）, pii-hook（PII 脱敏）
  ├── PreToolUse         → sandbox-hook（命令校验）, hitl-hook（高危审批）
  ├── PostToolUse        → audit-hook（合规记录）, otel-hook（Span 采集）
  ├── PostToolUseFailure → retry-hook（自动重试）
  ├── PermissionRequest  → hitl-hook（人机交互审批）
  └── SessionStart/End   → audit-hook, otel-hook
```

**关键设计**：
1. Hook 抛异常时主流程 `continue`（横切关注点失败不中断 Agent）
2. `PreToolUse` 通过返回值 `{ permissionDecision: 'deny' }` 实现中止语义
3. SDK Hook 通过 `sdk-hook-adapter.ts` 桥接到同一个 HookRegistry

---

## Consequences

**正面影响**：
- 主 Agent 流程从 615 行减至可读的核心逻辑，横切关注点独立文件
- 新增 Hook 无需修改已有代码（开闭原则）
- SDK 路径和 Legacy 路径共享同一套 Hook 注册，行为一致

**负面影响**：
- Hook 失败静默吞错，需要通过 OTel Span 和日志补充观测
- 12 个事件足够但不完整，未来如需细粒度事件（如 `PreStream`）需扩展枚举

---

## Alternatives Considered

1. **Middleware Chain（Express 风格）**：`next()` 模式，但同步/异步混用时 next 传递易错；Hook Registry 更接近 SDK 协议。拒绝。
2. **EventEmitter 内置**：Node.js `EventEmitter` 无类型保证，无法在 TypeScript 中安全约束 payload 类型。拒绝。
3. **在主 Agent 流程中 if-else**：最简单但违反开闭原则，每个新能力都要改 agent.ts。拒绝。

---

## References

- [ADR 0001 Hybrid Architecture](0001-hybrid-architecture.md)
- `src/core/hooks/registry.ts`
- `src/core/hooks/builtin/`
- `docs/migration/hooks-architecture.md`
