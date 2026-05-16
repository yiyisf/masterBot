# ADR 0010: Skills 分层分类 — core / extended / experimental 三层

**Status**: Accepted  
**Date**: 2026-05-12  
**Phase**: P4 — Skills + Subagents 升级  
**Deciders**: yiyisf  

---

## Context

Phase 4 前，所有 13 个 built-in 技能（shell、file-manager、http-client、notification、document-processor、vision 等）在每次 Agent 调用时全量注入 Tool 列表。

**实测问题**：
- 全量注入 38 个 action 约消耗 ~208 tokens（仅工具定义部分）
- 多数任务只需 shell/file/http 三个基础工具，其余 10 个技能是噪声
- Claude 在工具列表过长时存在"工具选择质量下降"现象（选错工具或遗漏）

---

## Decision

**三层 tier 分类 + ClaudeManagedAgent 默认只加载 `core` tier**：

| Tier | 技能 | 默认加载 | 说明 |
|------|------|---------|------|
| `core` | shell, file-manager, http-client | ✅ 主 Agent | 绝大多数任务的基础工具 |
| `extended` | notification, document-processor, vision, database-connector, log-analyzer, im-bot | ❌ 按需 | 通过 Subagent 委派，或用户明确请求 |
| `experimental` | browser-automation, gemini-cli, claude-code, conductor-workflow | ❌ 需要明确启用 | 功能不稳定或有外部依赖 |

**Subagent 作为 extended tier 的访问入口**：

```typescript
// 4 个部门专家 Subagent，各自拥有精确的权限集合
hr-specialist:     extended（notification, document-processor）
finance-analyst:   extended（document-processor, database-connector）
it-support:        core + extended（shell, log-analyzer）
engineering-assistant: core + experimental（shell, claude-code）
```

---

## Consequences

**正面影响**：
- Token 节省：全量 208 → core 39 tokens，**节省 81.3%**（远超 ≥30% 目标）
- 工具选择质量提升：工具列表精简，模型选择更准确
- 最小权限：hr-specialist 无 shell 权限，无法执行任意命令

**负面影响**：
- 主 Agent 无法直接使用 extended tier 工具，需通过 Subagent 委派（增加一跳）
- `extended` / `experimental` 的边界主观，未来新增技能时需明确分类决策
- `tierFilter` 参数在 `sdk-mcp-wrapper.ts` 中以字符串过滤实现，非强类型枚举

---

## Alternatives Considered

1. **动态推断（根据用户意图选工具）**：需要额外 LLM 调用分类用户意图，增加延迟和成本。拒绝。
2. **全量注入但按 tier 排序**（核心工具靠前）：工具数量不变，Claude 关注度仍均摊。拒绝。
3. **两层（basic / advanced）**：边界更粗，无法精确控制 experimental 技能的启用条件。拒绝。

---

## References

- `src/types.ts`（SkillTier / SkillCategory 类型定义）
- `src/core/agent/subagents.ts`（4 个部门专家 Subagent 定义）
- `src/skills/sdk-mcp-wrapper.ts`（tierFilter 参数实现）
- `scripts/token-count.ts`（Token 节省测量脚本）
