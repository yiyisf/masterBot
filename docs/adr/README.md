# Architecture Decision Records

本目录存放 masterBot v3 重构的架构决策记录（ADR），格式基于 [MADR](https://adr.github.io/madr/)。

## 索引

| ADR | 状态 | 主题 |
|-----|------|------|
| [0001](0001-hybrid-architecture.md) | Accepted | Hybrid 架构 — Claude SDK + Legacy 双引擎 |
| [0002](0002-local-first-distribution.md) | Accepted | Local-First 本地分发模式 |
| [0003](0003-tech-stack-baseline.md) | Accepted | 技术栈基线（Node 22 / TypeScript / Fastify / SQLite）|
| [0004](0004-sdk-version-lock.md) | Accepted | Claude Agent SDK 版本锁定策略 |

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
