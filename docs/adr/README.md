# Architecture Decision Records

本目录存放 masterBot v3 重构的架构决策记录（ADR），格式基于 [MADR](https://adr.github.io/madr/)。

## 索引

| ADR | 状态 | Phase | 主题 |
|-----|------|-------|------|
| [0001](0001-hybrid-architecture.md) | Accepted | P0 | Hybrid 架构 — Claude SDK + Legacy 双引擎 |
| [0002](0002-local-first-distribution.md) | Accepted | P0 | Local-First 本地分发模式 |
| [0003](0003-tech-stack-baseline.md) | Accepted | P0 | 技术栈基线（Node 22 / TypeScript / Fastify / SQLite）|
| [0004](0004-sdk-version-lock.md) | Superseded by ADR-0006 | P0 | Claude Agent SDK 版本锁定 + zod v3 暂缓升级 |
| [0005](0005-hook-system-design.md) | Accepted | P2 | Hook 系统设计 — Registry 模式 + 12 生命周期事件 |
| [0006](0006-zod-v4-upgrade.md) | Accepted | P6.5 | Zod v3 → v4 全量升级（supersedes ADR-0004 Action Item）|
| [0007](0007-memory-four-layer-sqlite.md) | Accepted | P6 | 四层记忆架构 — SQLite FTS5 替代 PostgreSQL + pgvector |
| [0008](0008-ichannel-unified-abstraction.md) | Accepted | P7 | IChannel 统一 IM 渠道抽象 |
| [0009](0009-admin-key-auth-isolation.md) | Accepted | P8 | Admin Console 独立鉴权 — X-Admin-Key 与用户 Key 分离 |
| [0010](0010-skills-tier-classification.md) | Accepted | P4 | Skills 分层分类 — core / extended / experimental 三层 |
| [0011](0011-session-checkpoint-strategy.md) | Accepted | P5 | Session Fork/Checkpoint 存储策略 — SDK JSONL 优先 + SQLite Fallback |
| [0012](0012-otel-spanrecorder-dual-write.md) | Accepted | P1 | 可观测性 — SpanRecorder 双写模式（SQLite + OTel）|
| [0013](0013-evaluation-pyramid.md) | Accepted | P9 | 评估金字塔三层架构 — Vitest + Shadow Traffic + Canary |

## 状态说明

- `Proposed` — 提议中，待决策
- `Accepted` — 已接受，当前执行
- `Deprecated` — 已废弃（有更新的 ADR 替代）
- `Superseded by ADR-XXXX` — 被新 ADR 取代

## 新增 ADR 流程

1. 复制现有 ADR 作为模板
2. 编号递增（下一个为 `0005`）
3. 填写 Context / Decision / Consequences / Alternatives
4. 更新本 README 索引
5. 在 PR 描述中说明 ADR 编号
