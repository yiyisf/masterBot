# masterBot 可观测性指南

Phase 1 引入 OpenTelemetry + Langfuse，替代原有的 SpanRecorder SQLite 自研方案。

---

## 架构概览

```
masterBot (src/observability/otel.ts)
    │
    │ OTLP/HTTP  :4318
    ▼
OTel Collector (deploy/observability/)
    │
    │ OTLP/HTTP
    ▼
Langfuse (http://localhost:3001)
    │
    ├── Traces 页面（全链路可视化）
    ├── Token 成本统计（按 session/user/model）
    └── LLM-as-judge 评估（Phase 9）
```

## 核心文件

| 文件 | 用途 |
|------|------|
| `src/observability/otel.ts` | OtelObserver 实现 + SDK 初始化 |
| `src/core/trace.ts` | SpanRecorder（@deprecated，内部代理到 OTel）|
| `deploy/observability/docker-compose.yml` | Langfuse + OTel Collector 容器编排 |
| `deploy/observability/otel-collector-config.yml` | Collector 管道配置 |

## OtelObserver API

```typescript
import { otelObserver } from './src/observability/otel.js';
import { initOtel } from './src/observability/otel.js';

// 初始化（在 index.ts 中调用一次）
initOtel({ serviceName: 'masterbot' });

// Agent 级别 root span
const agentSpan = otelObserver.startAgentSpan({
    sessionId: 'sess-123',
    userId: 'user-456',
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
});

// Tool 子 span（自动挂载到 agentSpan）
const toolSpan = otelObserver.startToolSpan('shell__execute', agentSpan);

// 记录 token 使用（GenAI Semantic Conventions）
otelObserver.recordModelUsage(agentSpan, {
    inputTokens: 1234,
    outputTokens: 567,
    cacheReadInputTokens: 890,
});

// 结束 span
otelObserver.endSpan(toolSpan, { result: 'exit code 0' });
otelObserver.endSpan(agentSpan);
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OTEL_ENABLED` | `true` | 设为 `false` 禁用 OTel（不影响 SpanRecorder SQLite）|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP 端点 |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | 逗号分隔的 `key=value` 认证头 |

## 迁移状态（Phase 1）

| 模块 | 状态 | 说明 |
|------|------|------|
| `SpanRecorder` | ⚠️ @deprecated | 内部双写 SQLite + OTel，保持 API 兼容 |
| `agent.ts` | ✅ 透明迁移 | 通过 SpanRecorder 代理到 OTel |
| `agent-run-helpers.ts` | ✅ 透明迁移 | 同上 |
| `gateway/server.ts` | ✅ 透明迁移 | /api/traces 仍从 SQLite 读取 |

Phase 2 将直接在 `AgentRouter` 中使用 `OtelObserver`，届时移除 SpanRecorder。

## 快速部署

见 [langfuse-setup.md](langfuse-setup.md)。
