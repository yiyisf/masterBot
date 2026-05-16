# ADR 0012: 可观测性 — SpanRecorder 双写模式（SQLite + OTel）

**Status**: Accepted  
**Date**: 2026-05-10  
**Phase**: P1 — 可观测性先行  
**Deciders**: yiyisf  

---

## Context

Phase 1 目标是引入 OpenTelemetry 标准追踪，最终将 trace 导出到 Langfuse self-hosted 实例。

**现有状态**：
- `SpanRecorder` 类将 span 写入 SQLite `agent_spans` 表（12 个调用点：agent.ts ×3, agent-run-helpers.ts ×7, server.ts ×2）
- 所有调用点依赖 `SpanRecorder` 接口，直接替换会触动 615 行 agent.ts

**核心问题**：Phase 1 约束是"不改现有接口"（避免触碰 RunContext 类型链，Phase 2 统一处理），如何在不修改 12 个调用点的前提下接入 OTel？

---

## Decision

**SpanRecorder 内部代理（双写）**：保留 `SpanRecorder` 接口不变，内部同时写 SQLite + OTel Span：

```typescript
class SpanRecorder {
    startSpan(name: string, attrs: Attributes): Span {
        this.otelTracer.startSpan(name, { attributes: attrs }); // OTel
        this.db.prepare('INSERT INTO agent_spans ...').run(...); // SQLite（保留）
        return { end: () => { otelSpan.end(); } };
    }
}
```

**OTel 架构**：
```
masterBot → OTel SDK → OTel Collector (本地) → Langfuse OTLP 端点
```

OTel Collector 作为中间层，便于未来切换后端（Jaeger/Tempo/Datadog）而不修改 masterBot 代码。

**性能基线**：`tests/performance/otel-overhead.test.ts` 验证 OTel 额外开销 < 100ms/1000 ops。

---

## Consequences

**正面影响**：
- 12 个调用点零修改（接口完全向后兼容）
- Phase 1 完成后，所有 span 同时在 SQLite（本地查询）和 Langfuse（可视化分析）可见
- OTel Collector 中间层使 Langfuse 可替换（切换后端只改 Collector 配置）

**负面影响**：
- 双写引入冗余存储，SQLite `agent_spans` 表在 OTel 成熟后可弃用
- `@deprecated` 标记加在 SpanRecorder 上，Phase 2 需做清理（移除直接 SQLite 写入路径）

---

## Alternatives Considered

1. **直接替换 SpanRecorder 为 OTel**：需修改 12 个调用点，风险高；Phase 1 目标是"不改现有代码"。拒绝。
2. **OpenTelemetry Auto-Instrumentation**：覆盖 HTTP/gRPC 自动埋点，但无法捕获业务语义 span（Agent Loop 各阶段）。补充使用（已引入），无法替代手动 span。
3. **直接导出到 Langfuse（不经 Collector）**：可行，但绑定到 Langfuse，将来换后端需改 SDK 配置。拒绝。

---

## References

- `src/core/trace.ts`（SpanRecorder 实现，已加 @deprecated）
- `src/observability/otel.ts`（OtelObserver 实现）
- `deploy/observability/docker-compose.yml`（Langfuse self-hosted）
- `deploy/observability/otel-collector-config.yml`
- `docs/migration/langfuse-setup.md`
- `docs/migration/observability-guide.md`
