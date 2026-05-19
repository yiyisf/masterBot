# ADR 0014: Skill Factory 2.0 — 五阶段流水线 + 双段协同

**Status**: Accepted  
**Date**: 2026-05-16  
**Phase**: P9.5 — Skill Factory 2.0  
**Deciders**: yiyisf  

---

## Context

Phase 8 为技能审批构建了 `skill_reviews` 表和 Admin API，但写入端缺失——只有消费端，没有完整的技能生产生命周期。现有 `SkillGenerator`（`src/core/skill-generator.ts`）仅能生成代码草稿，无沙箱测试、安全扫描、评审或发布机制，无法作为企业员工自助工具使用。

核心问题：
1. 技能生成后没有验证流程，直接写磁盘有安全风险
2. 个人草稿和企业发布没有分离，多租户场景下会互相污染
3. 没有技能生命周期状态机（废弃、归档、隔离无法表达）

---

## Decision

**五阶段流水线 + 双段协同架构**：

```
员工输入需求
      │
      ▼
[Stage 1: UNDERSTAND]  — LLM 解析意图，生成 SkillSpec 草稿
      │
      ▼
[Stage 2: SYNTHESIZE]  — LLM 生成 SKILL.md + index.ts 代码
      │
      ▼
[Stage 3: VERIFY]      — StaticValidator（frontmatter/kebab-case/export 检查）
                         + SecurityScanner（16条规则，含 SQL注入/命令注入/路径遍历）
      │
      ▼
[Stage 4: EVAL]        — tsx 进程隔离执行（30s 超时）
                         + LLM-as-Judge（4维度评分：实用性/健壮性/安全/文档）
      │
      ▼
[Stage 5: PUBLISH]     — LocalSkillFactory 立即写 skills/local/
                       ├─ EnterpriseSkillFactory（综合分 < 7）→ pending-review
                       └─ EnterpriseSkillFactory（综合分 ≥ 7）→ skill_catalog
```

**双段分离**：
- `LocalSkillFactory`（客户端）：Stage 1-4，草稿立即可用于个人调试
- `EnterpriseSkillFactory`（服务端）：Stage 5 + Admin 评审门，控制企业范围发布

**8 状态生命周期**：
```
drafting → synthesizing → local-tested → pending-review
                                                │
                        ┌───────────────────────┤
                        ▼                       ▼
                     approved              rejected
                        │
                     active → deprecated → archived
                                │
                             quarantined（安全违规强制隔离）
```

---

## Consequences

**正面影响**：
- 安全扫描前置（Stage 3），hardcoded key / SQL 注入 / 命令注入在代码生成后立即拦截，不进入运行环境
- LocalSkillFactory 不阻塞等待 Admin 评审，员工草稿快速可用
- `skill_reviews` 表（Phase 8 已建）现在有了完整的写入端
- Auto-Curator 每日分析使用率，自动 featured/archive，降低运营负担

**负面影响**：
- 五阶段串行执行，技能生成端到端约 30-60s（受 LLM 响应时间影响）
- LLM-as-Judge 评分依赖模型能力，可能在复杂技能场景出现误判
- tsx 进程隔离执行在 Windows 路径中需额外处理（已有 `cross-spawn` 兜底）

---

## Alternatives Considered

1. **直接扩展现有 SkillGenerator**：现有代码为单步生成，加入五阶段会导致单文件过大（>1000行），难以测试每个 Stage。拒绝，改为独立 `src/skill-factory/` 模块。

2. **使用 Docker 沙箱而非 tsx 进程隔离**：Docker 提供更强隔离，但引入新基础设施依赖，企业部署复杂度增加。选择 tsx 进程隔离（30s 超时）作为轻量替代。

3. **去掉 LLM-as-Judge**，仅用静态分析：静态分析无法判断技能的"实用性"和"文档质量"。保留 LLM-as-Judge，综合分 < 7 触发人工评审，而非直接拒绝，降低误判损失。

4. **一阶段（生成即发布）**：开发迭代快，但安全风险不可控。已有 SkillGenerator 就是这个模式，证明不适合企业场景。

---

## References

- `src/skill-factory/types.ts` — SkillSpec / SkillFactoryJob / 8 状态枚举
- `src/skill-factory/client.ts` — LocalSkillFactory（Stage 1-4）
- `src/skill-factory/server.ts` — EnterpriseSkillFactory（Stage 5 + 评审）
- `src/skill-factory/publisher.ts` — 发布到 skill_catalog + audit_log
- `src/skill-factory/auto-curator.ts` — 每日 curation 任务
- `src/core/database.ts` — skill_factory_jobs + skill_catalog 两张表
- `tests/skill-factory.test.ts` — 41 个测试
- ADR-0010（Skills 分层分类）— 本 ADR 发布流程与 tier 分类一致
