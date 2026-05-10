# ADR 0003: Tech Stack Baseline — 技术栈基线

**Status**: Accepted  
**Date**: 2026-05-10  
**Deciders**: yiyisf  

---

## Context

v3 重构需明确锁定技术栈基线，避免重构过程中引入无关技术债务，同时为后续 Phase 的技术选型提供决策锚点。

---

## Decision

以下技术栈作为 v3 整个周期的基线，**非 P0 紧急需求不得替换**：

### 后端

| 技术 | 版本 | 理由 |
|------|------|------|
| **Node.js** | ≥ 22 LTS | 内置 `node:sqlite` DatabaseSync，避免 better-sqlite3 native binding 问题 |
| **TypeScript** | 5.x，strict 模式 | 项目一致性；strict 模式强制类型安全 |
| **Fastify** | 5.x | 高性能 HTTP/WS/SSE；schema-based validation |
| **node:sqlite** | Node 22 built-in | 零外部依赖，WAL 模式，同步 API |
| **tsx / tsup** | latest | 开发热重载 / 生产构建 |
| **Vitest** | 4.x | ESM 原生支持，`node:sqlite` 兼容 |

### 前端

| 技术 | 版本 | 理由 |
|------|------|------|
| **Next.js** | 16（App Router） | 项目现有栈，SSR + SPA 统一 |
| **React** | 19 | Server Components + Actions |
| **Tailwind CSS** | 4.x | 设计系统基础 |
| **shadcn/ui** | latest | 无样式组件库，与 Tailwind 深度集成 |
| **@assistant-ui/react** | latest | 聊天 UI 原语（Phase 9.7 引入 AG-UI 前保留）|

### 数据层

| 技术 | 用途 | 说明 |
|------|------|------|
| **node:sqlite (WAL)** | 本地主存储 | 会话/消息/任务/审计/记忆，17 张表 |
| **SQLite FTS5** | 全文检索 | 跨平台，无额外服务 |
| **余弦相似度（LIKE 降级）** | 向量检索 | Phase 6 升级 pgvector 时替换 |

### 新增（v3 引入）

| 技术 | 用途 | 引入 Phase |
|------|------|-----------|
| **@anthropic-ai/claude-agent-sdk** | Claude Managed Agent 路径 | Phase 0 |
| **OpenTelemetry SDK** | 标准追踪 | Phase 1 |
| **Langfuse（self-hosted）** | OTel 可观测性后端 | Phase 1 |
| **AG-UI 协议** | 前端事件协议 | Phase 9.7 |

---

## Consequences

**正面影响**：
- 技术栈连续性高，现有 23 个 Phase 的代码资产 90% 可保留
- Node 22 LTS 在 2026 年进入 Active LTS，长期稳定
- 严格 TypeScript 避免类型逃逸问题

**负面影响**：
- `node:sqlite` 的同步 API 在高并发场景有阻塞风险（后续 Phase 评估迁移 Turso/libSQL）
- Next.js 16 App Router 仍有部分社区生态不成熟

---

## References

- [优化方案 v3 最终版](../refactor-plan/masterBot优化方案_v3_最终版.md) §第 3 章
- [CLAUDE.md 技术栈说明](../../CLAUDE.md)
