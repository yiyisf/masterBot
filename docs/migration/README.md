# masterBot v3 重构迁移文档

本目录记录 masterBot v3 重构的全过程：设计决策、进度追踪、基础设施清单。

---

## 文件导航

| 文件 | 用途 |
|------|------|
| [PHASES.md](PHASES.md) | 所有 Phase 的总览（目标、分支、完成标准） |
| [PROGRESS.md](PROGRESS.md) | 进度追踪表（实时更新） |
| [infrastructure-checklist.md](infrastructure-checklist.md) | 后续 Phase 需要的基础设施清单 |

## ADR 目录

架构决策记录（Architecture Decision Records）位于 [../adr/](../adr/)。

| ADR | 状态 | Phase | 主题 |
|-----|------|-------|------|
| [0001](../adr/0001-hybrid-architecture.md) | Accepted | P0 | Hybrid 架构 — Claude SDK + Legacy 双引擎 |
| [0002](../adr/0002-local-first-distribution.md) | Accepted | P0 | Local-First 本地分发模式 |
| [0003](../adr/0003-tech-stack-baseline.md) | Accepted | P0 | 技术栈基线（Node 22 / TypeScript / Fastify / SQLite）|
| [0004](../adr/0004-sdk-version-lock.md) | Superseded | P0 | Claude Agent SDK 版本锁定 + zod v3 暂缓升级 |
| [0005](../adr/0005-hook-system-design.md) | Accepted | P2 | Hook 系统设计 — Registry 模式 + 12 生命周期事件 |
| [0006](../adr/0006-zod-v4-upgrade.md) | Accepted | P6.5 | Zod v3 → v4 全量升级 |
| [0007](../adr/0007-memory-four-layer-sqlite.md) | Accepted | P6 | 四层记忆架构 — SQLite FTS5 替代 PostgreSQL + pgvector |
| [0008](../adr/0008-ichannel-unified-abstraction.md) | Accepted | P7 | IChannel 统一 IM 渠道抽象 |
| [0009](../adr/0009-admin-key-auth-isolation.md) | Accepted | P8 | Admin Console 独立鉴权 — X-Admin-Key 与用户 Key 分离 |
| [0010](../adr/0010-skills-tier-classification.md) | Accepted | P4 | Skills 分层分类 — core / extended / experimental 三层 |
| [0011](../adr/0011-session-checkpoint-strategy.md) | Accepted | P5 | Session Fork/Checkpoint 存储策略 |
| [0012](../adr/0012-otel-spanrecorder-dual-write.md) | Accepted | P1 | 可观测性 — SpanRecorder 双写模式（SQLite + OTel）|
| [0013](../adr/0013-evaluation-pyramid.md) | Accepted | P9 | 评估金字塔三层架构 — Vitest + Shadow Traffic + Canary |

---

## 分支策略

```
master                         ← 生产分支，重构完成前不合并
  │
  └── refactor-v3              ← 重构主分支（汇集所有 Phase 成果）
        │
        ├── refactor-v3-p0-preparation   (Phase 0，当前)
        ├── refactor-v3-p1-observability (Phase 1)
        ├── refactor-v3-p2-hooks         (Phase 2)
        └── ...
```

> **注意**：git 不允许同一前缀同时存在分支和目录（如 `refactor/v3` 和 `refactor/v3/p0-preparation`），
> 因此使用 `-` 代替 `/` 作为层级分隔符。

---

## Commit 规范

```
[refactor-v3/p<N>] <type>: <subject>

Refs: #issue-<num>
```

示例：
```
[refactor-v3/p0] docs: add ADR 0001 hybrid architecture decision
[refactor-v3/p0] feat: add Claude Agent SDK dependency v0.2.138
```
