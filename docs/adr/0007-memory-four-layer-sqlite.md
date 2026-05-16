# ADR 0007: 四层记忆架构 — SQLite FTS5 替代 PostgreSQL + pgvector

**Status**: Accepted  
**Date**: 2026-05-15  
**Phase**: P6 — Memory 四层 + 租户隔离  
**Deciders**: yiyisf  

---

## Context

Phase 6 目标是实现 Working / Episodic / Semantic / Procedural 四层记忆架构，原计划引入 PostgreSQL + pgvector 提供向量检索能力（L3 Semantic 层需要语义相似度搜索）。

**评估过程中发现**：
- 引入 PostgreSQL 意味着部署从"单二进制"变为"需要 PG 服务"，违背 ADR 0002 Local-First 原则
- pgvector 在 macOS 开发环境安装摩擦较大（需要 Postgres 扩展编译）
- 项目已有 SQLite FTS5（全文检索扩展），可提供近似向量检索（cosine 余弦降级）
- Semantic 层的 HitL 审批流程（confidence 阈值门）可用 SQL 精确匹配替代向量相似度

**租户隔离需求**：所有记忆操作必须携带 `tenant_id`，不同租户数据严格隔离。

---

## Decision

**全量使用 SQLite 实现四层记忆，不引入 PostgreSQL**：

| 层级 | 类 | 存储 | 检索方式 |
|------|----|------|---------|
| L1 Working | SDK 内置 | 内存（prompt context window）| SDK 自动管理，无接口 |
| L2 Episodic | `EpisodicMemoryStore` | SQLite FTS5 | FTS5 全文检索 + LIKE fallback，90 天 TTL |
| L3 Semantic | `SemanticMemoryStore` | SQLite | HitL 审批门（confidence≥0.85→pending），SQL 精确匹配 |
| L4 Procedural | `ProceduralMemory` | 文件系统 | SOUL.md / AGENTS.md fs.watch 热重载，注入 system prompt |

**统一接口**：`IMemoryRouter` 提供 `remember()` / `recall()` 两个方法，向后兼容旧 `LongTermMemory`。

**租户隔离**：所有 SQL 查询强制携带 `WHERE tenant_id = ?`，`IMemoryRouter` 接口强制传递 `tenantId` 参数。

---

## Consequences

**正面影响**：
- 部署仍为单二进制（SQLite 内置于 Node 22），符合 Local-First 原则
- FTS5 在企业日常场景（<10 万条记忆）性能足够
- HitL 审批门提供人工质量保障，部分补偿向量语义搜索的缺失

**负面影响**：
- FTS5 不支持真正的向量相似度，语义召回质量低于 pgvector + embedding
- 规模到百万条记忆时 FTS5 全表扫描性能下降，届时需迁移到 Turso / libSQL / pgvector
- Semantic L3 的 confidence 阈值需人工标定，无法自动学习

---

## Alternatives Considered

1. **PostgreSQL + pgvector**：向量质量最高，但引入运维复杂度，违背 Local-First。拒绝。
2. **DuckDB + VSS 插件**：DuckDB 在 Node.js ESM strict 模式下加载失败（native binding 问题），Phase 6.5 降级为可选 opt-in。暂缓。
3. **SQLite + 纯 JS 余弦相似度**：对每条记忆做 embedding + 存储向量，检索时 JS 层计算余弦。性能差（无法利用 DB 索引），Phase 6 规模不值得引入 embedding 成本。拒绝。
4. **完全不做 Semantic 层**：HitL 门是企业合规需求（知识库写入前需人工审批），不可省略。拒绝。

---

## Future Migration Path

当 Episodic 记忆条数超过 50 万或语义召回质量成为用户痛点时：
1. 将 L2/L3 迁移到 Turso（libSQL 云端，兼容 SQLite API）+ 外置 embedding 服务
2. 或引入 pgvector（Phase 10+ 企业版独立部署时）
3. `IMemoryRouter` 接口不变，只替换底层实现

---

## References

- [ADR 0002 Local-First 分发](0002-local-first-distribution.md)
- `src/memory/episodic.ts`、`src/memory/semantic.ts`、`src/memory/procedural.ts`
- `src/memory/types.ts`（IMemoryRouter 接口定义）
