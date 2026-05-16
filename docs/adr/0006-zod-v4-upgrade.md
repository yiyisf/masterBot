# ADR 0006: Zod v3 → v4 全量升级

**Status**: Accepted（Supersedes ADR-0004 Action Item）  
**Date**: 2026-05-15  
**Phase**: P6.5 — Memory 增补  
**Deciders**: yiyisf  

---

## Context

ADR 0004 将 zod v4 升级列为 Action Item，计划在 Phase 2 处理，实际推迟至 Phase 6.5 执行。

**触发原因**：
- Phase 3 中 `sdk-mcp-wrapper.ts` 已局部使用 `zod/v4` import（`import { z } from 'zod/v4'`），与项目其余部分的 `zod@3` 并存，形成双版本混用状态
- Phase 6.5 review 发现：`SessionMessage.type` 的 `readonly` 字段在 zod v3 中被推断为 `string`，在 v4 中正确推断为 literal union，导致类型不精确
- `npm install` 持续需要 `--legacy-peer-deps`，CI 配置维护成本累积

**zod v3 → v4 主要 breaking changes**：
- `z.record()` 由单参数改为双参数（`z.record(z.string(), valueSchema)`）
- `z.object().partial()` 返回类型变化
- 部分 `.parse()` 错误信息格式改变

---

## Decision

**Phase 6.5 执行 zod 全量升级至 v4**：

1. 将所有 `import { z } from 'zod'` 统一迁移，`sdk-mcp-wrapper.ts` 中的 `zod/v4` 子路径改回标准 `zod`
2. 修复所有 `z.record()` 调用点（补充 key type 参数）
3. 移除 `npm install` 的 `--legacy-peer-deps` 约束
4. 更新 ADR 0004 状态为 `Superseded by ADR-0006`

---

## Consequences

**正面影响**：
- 消除 zod 双版本混用，`SessionMessage.type` 类型推断精确
- `npm ci` 无需 `--legacy-peer-deps`，CI 配置简化
- 与 Claude Agent SDK 依赖要求对齐，无 peer 冲突

**负面影响**：
- 升级时需全量扫描 `z.record()` / `.partial()` 等 breaking API，改动面较广
- 第三方插件若依赖 zod v3 会产生新的 peer conflict（当前无此问题）

---

## Alternatives Considered

1. **继续用 `--legacy-peer-deps`**：能运行但技术债持续积累，CI 配置需长期维护特殊 flag。拒绝。
2. **保持 zod v3，修改 sdk-mcp-wrapper.ts 避免 `zod/v4`**：根本原因是 SDK 要求 v4，局部绕过无法彻底解决。拒绝。

---

## References

- [ADR 0004 SDK 版本锁定策略](0004-sdk-version-lock.md)（Action Item 原文）
- `src/skills/sdk-mcp-wrapper.ts`（修改前用 `zod/v4` 子路径）
