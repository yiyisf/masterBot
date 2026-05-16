# ADR 0013: 评估金字塔三层架构 — Vitest + Shadow Traffic + Canary

**Status**: Accepted  
**Date**: 2026-05-16  
**Phase**: P9 — 评估金字塔（持续 Phase）  
**Deciders**: yiyisf  

---

## Context

Phase 9 前，agent 行为变化缺乏量化评估：
- 新 feature 合并后无法知晓是否引入回归
- 模型版本升级（如 claude-haiku-4-5 → claude-sonnet-4-6）的影响不可知
- 渐进发布（灰度）无自动化指标监控，依赖人工观察

需要一套评估基础设施，覆盖"离线测试 → 在线对比 → 生产灰度"全链路。

**工具选型问题**：重构计划指定 promptfoo 作为 capability eval 框架，但 promptfoo 是 CLI 工具，需要真实 LLM API Key 才能运行，无法作为 CI 结构验证工具。

---

## Decision

**三层评估金字塔**，每层工具和触发时机不同：

```
Tier 3 Production Canary    ← 每次发布，渐进 5%→25%→50%→100%
        │
Tier 2 Shadow Traffic       ← 持续运行，10% 真实流量双写对比
        │
Tier 1 Offline Eval         ← 每个 PR，结构验证 + 未来 LLM-as-Judge
```

### Tier 1 — Vitest 替代 promptfoo（结构验证）

**决策**：用 Vitest 实现 eval runner，不引入 promptfoo CLI。

- Phase 9 的 Tier 1 目标是"用例库建设 + CI 验证结构合法性"，不是真实 LLM 打分
- Vitest 已在项目中，无新工具链；promptfoo 需要 LLM API Key 才能运行，CI 中无法执行
- LLM-as-Judge（claude-haiku-4-5 当 judge）作为未来扩展，在 CI secrets 配置就绪后接入

**Eval 套件结构**：
- `tests/evals/capability/`：4 个 YAML 套件，各 30 条（共 120 条）
- `tests/evals/golden/golden-set.yaml`：50 条"必须答对"关键场景（block merge 门槛）

### Tier 2 — Shadow Traffic（djb2 采样）

- `ShadowTrafficService`：按 `requestId` djb2 hash 做确定性采样（默认 10%）
- 对比维度：工具调用集合 diff、回答长度偏差、延迟/Token/成本
- Shadow 结果写内存统计（生产部署时接 Langfuse Dataset）

### Tier 3 — CanaryService（渐进发布）

- 4 个 stage：5% → 25% → 50% → 100%，每 stage 默认 24h 观察期
- 自动回滚条件：错误率超 `error_rate_threshold`（默认 5%）
- 存储：`canary_flags` + `canary_metrics` 两张 SQLite 表
- Admin Console `/admin/canary` 页面可手动提级/降级

---

## Consequences

**正面影响**：
- Tier 1 结构验证在 CI 中可靠运行（无 LLM API 依赖），201 个测试全通过
- Tier 3 Canary 将 feature flag 的"灰度比例"与"自动回滚"联动，减少人工干预
- Golden Set 作为质量底线，任何 PR break 一条即 block merge

**负面影响**：
- Tier 1 暂无真实 LLM 打分（只验证结构），eval 质量评估依赖人工 review
- Tier 2 Shadow Traffic 结果写内存，重启丢失（需接 Langfuse Dataset 才能持久化）
- Tier 3 错误率计算依赖 `canary_metrics` 主动上报，若调用方不记录指标则无法触发自动回滚

---

## Alternatives Considered

1. **promptfoo**：功能全面（支持 LLM-as-Judge、多模型对比），但需要 LLM API Key 才能运行，CI 中无法作为结构验证工具；且引入新 CLI 工具链。推迟（未来 LLM-as-Judge 阶段评估接入）。
2. **Langfuse Datasets 直接接 Tier 1**：需要 Langfuse 实例在 CI 中可访问，增加 CI 基础设施依赖。推迟。
3. **仅 Canary，无 Shadow Traffic**：缺少上线前的隐性行为对比，Canary 发现问题时已影响用户。拒绝。
4. **自动回滚阈值设置为 1%**：过于敏感，正常波动会触发频繁回滚。默认 5% 是业界常见阈值。

---

## References

- `src/eval/shadow-traffic.ts`（ShadowTrafficService 实现）
- `src/eval/canary.ts`（CanaryService 实现）
- `tests/evals/eval-runner.test.ts`（201 个结构验证测试）
- `tests/evals/golden/golden-set.yaml`（50 条关键场景）
- `.github/workflows/eval.yml`（CI 流水线）
- `docs/eval/three-tier-pyramid.md`
- `docs/eval/canary-process.md`
