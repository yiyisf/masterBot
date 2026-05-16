# ADR 0004: Claude Agent SDK 版本锁定策略

**Status**: Superseded by [ADR-0006](0006-zod-v4-upgrade.md)（zod v4 升级已于 Phase 6.5 完成）  
**Date**: 2026-05-10  
**Deciders**: yiyisf  

---

## Context

`@anthropic-ai/claude-agent-sdk` 安装时发现以下 peer dependency 冲突：

- SDK `0.2.138` 要求 `zod@^4.0.0` 作为 peer dependency
- 项目现有依赖为 `zod@^3.24.1`（v3 与 v4 有 breaking changes）

安装时使用了 `--legacy-peer-deps` 绕过冲突，SDK 功能可正常使用，但 zod 版本不匹配存在潜在运行时风险（若 SDK 内部用 zod 4 API 验证类型）。

---

## Decision

1. **锁定 SDK 到精确版本 `0.2.138`（去掉 `^` 前缀）**
   - 理由：SDK 是 proprietary library，breaking changes 无法预知，精确锁定确保行为一致性
   - 每次升级 SDK 必须创建新的 ADR 记录变更原因

2. **暂不升级 zod 到 v4**
   - Phase 0 约束：不修改任何现有 `src/` 代码
   - zod v4 与 v3 的 API 变更需要全量扫描，计划在 Phase 2（Hooks 重构）中一并处理
   - Phase 2 任务清单中新增：`升级 zod 3 → 4，修复所有调用点`

3. **安装方式记录**：`npm install @anthropic-ai/claude-agent-sdk --legacy-peer-deps`

---

## Consequences

**正面影响**：
- SDK 版本稳定可控，避免自动升级引入回归
- Phase 0 smoke test 可正常运行

**负面影响**：
- `zod@^4` peer dependency 冲突未彻底解决，`npm install` 需加 `--legacy-peer-deps`
- 后续 CI 中 `npm ci` 需同步加此 flag，直到 Phase 2 升级 zod

---

## Action Items

- [x] ~~Phase 2 引入 `IAgent` 接口时，一并升级 zod 3 → 4~~ → 推迟到 Phase 6.5 执行（见 ADR-0006）
- [x] ~~升级后更新本 ADR 状态为 `Superseded`~~ → 已完成，见本文件头部 Status
- [x] ~~CI 配置中临时添加 `--legacy-peer-deps`~~ → Phase 6.5 升级 zod v4 后已移除

---

## References

- [ADR 0001 Hybrid Architecture](0001-hybrid-architecture.md)
- npm install log: zod@3.25.76 实际安装版本，SDK peer 要求 zod@^4.0.0
