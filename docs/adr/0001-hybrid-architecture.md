# ADR 0001: Hybrid Agent Architecture — Claude SDK + Legacy Dual Engine

**Status**: Accepted  
**Date**: 2026-05-10  
**Deciders**: yiyisf  

---

## Context

masterBot 自 Phase 1–23 以来已独立实现了一套完整的 ReAct Agent Loop（`src/core/agent.ts`），覆盖流式输出、DAG 任务编排、多 Agent 协作、ContextManager 压缩等能力。

2026 年 Anthropic 正式发布 `@anthropic-ai/claude-agent-sdk`，提供托管的 Agent Loop，内置：
- 自动 prompt caching 和 server-side compaction（减少 ~84% token 消耗）
- Extended thinking（`budget_tokens` 控制）
- Session resume / fork / checkpoint
- Subagent context isolation
- 标准 Hooks 体系（12 个生命周期事件）

**核心问题**：是否用 SDK 替换自研 Agent Loop？如何在保留多 LLM 支持的同时享受 SDK 的能力？

---

## Decision

**采用 Hybrid 架构**：

```
if (provider === 'anthropic')  → ClaudeManagedAgent  (SDK query())
else                           → LegacySelfHostedAgent (自研 ReAct)
```

通过 `AgentRouter` 抽象层在运行时路由，两条路径共享同一套 Tool/Skill/Hook 协议。

---

## Consequences

**正面影响**：
- Anthropic provider 立即获得 caching/compaction/subagent isolation，token 成本显著降低
- 不放弃 OpenAI / Gemini / Ollama 用户（LegacySelfHostedAgent 永不下线）
- SDK 封装最小（IAgent 接口约 50 行），代码库保持 95% 可控
- 将来 SDK 出 breaking change，只需改 ClaudeManagedAgent，不影响 Legacy 路径

**负面影响**：
- `@anthropic-ai/claude-agent-sdk` 是 proprietary license（非 MIT），作为依赖引入需法务确认
- 两套路径需同步维护测试覆盖（使用同一套 capability eval 套件验证行为一致性）
- AgentRouter 引入一层抽象，新人需要理解路由逻辑

---

## Alternatives Considered

1. **全量切换到 SDK**：放弃多 LLM 支持，对使用 OpenAI/Ollama 的用户造成破坏。拒绝。
2. **继续 100% 自研**：维护成本持续上升，永远落后 SDK 新特性 6–12 月。拒绝。
3. **仅抄 SDK 协议，不依赖 SDK runtime**：无法获得 caching/compaction/subagent isolation 等托管能力。拒绝。

---

## References

- [Phase 0 重构计划](../refactor-plan/masterBot_重构计划.md)
- [优化方案 v3 最终版](../refactor-plan/masterBot优化方案_v3_最终版.md) §第 6 章
