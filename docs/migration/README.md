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

| ADR | 主题 |
|-----|------|
| [0001](../adr/0001-hybrid-architecture.md) | Hybrid 架构 — Claude SDK + Legacy 双引擎 |
| [0002](../adr/0002-local-first-distribution.md) | Local-First 本地分发模式 |
| [0003](../adr/0003-tech-stack-baseline.md) | 技术栈基线 |
| [0004](../adr/0004-sdk-version-lock.md) | Claude Agent SDK 版本锁定策略 |

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
