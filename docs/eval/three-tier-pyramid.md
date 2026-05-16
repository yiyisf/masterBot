# 三层评估金字塔

CMaster Bot 的评估体系分为三层，从"离线测试"到"在线灰度"形成完整的质量保障闭环。

```
         ┌──────────────┐
         │   Tier 3     │  Canary（渐进式灰度发布）
         │  5%→100%     │  生产流量，实时监控 error rate
         └──────┬───────┘
                │
         ┌──────▼───────┐
         │   Tier 2     │  Shadow Traffic（影子流量对比）
         │  10% 采样    │  双写对比，量化行为差异
         └──────┬───────┘
                │
         ┌──────▼───────┐
         │   Tier 1     │  Capability Eval + Golden Set
         │  120+ cases  │  离线评测，CI 自动运行
         └──────────────┘
```

---

## Tier 1 — 能力评测套件

### 目的

在 CI 环境中对每个 PR/commit 自动执行结构合法性验证和离线断言，防止
能力退化（regression）。

### 评测套件

| 文件 | 用例数 | 主要覆盖 |
|------|--------|---------|
| `tests/evals/capability/basic-conversation.yaml` | ≥ 30 | 基础问答、指令遵循、格式化输出、多语言、边界情况 |
| `tests/evals/capability/tool-calling.yaml` | ≥ 30 | 工具选择、错误处理、链式调用、条件调用、输出解析 |
| `tests/evals/capability/multi-turn-context.yaml` | ≥ 30 | 上下文追踪、信息累积、角色一致性、话题切换 |
| `tests/evals/capability/permission-and-safety.yaml` | ≥ 30 | 危险命令拒绝、权限边界、信息安全、合规场景 |
| `tests/evals/golden/golden-set.yaml` | ≥ 50 | 关键必答场景，覆盖 7 大类 |

### 触发时机

- 每次 `push` 到 `refactor/v3` 分支
- 每个 PR 的目标分支为 `refactor/v3`
- 本地开发：`npx vitest run tests/evals/eval-runner.test.ts`

### 工具

- `tests/evals/run-evals.ts` — 套件加载器、断言引擎
- `tests/evals/eval-runner.test.ts` — Vitest 测试，包含：
  - 用例数量检查
  - 全局 ID 唯一性验证
  - case 结构合法性
  - 断言引擎单元测试
- `scripts/generate-eval-report.ts` — 报告生成器，输出 `eval-results/report.json`

### 关键阈值

- 每套 capability 套件：≥ 30 条
- golden-set：≥ 50 条
- 全局 ID 重复：0

---

## Tier 2 — Shadow Traffic（影子流量）

### 目的

在生产环境中，对 10% 的真实流量同时运行新旧两个版本的处理逻辑，
对比结果差异，量化行为变化。

### 工作原理

```
用户请求 ──┬──► 原始逻辑（v_current）── 返回用户
           │
           └──► shadow 逻辑（v_new）── 结果存储到日志
                                        ▲
                                   按 djb2(requestId) 采样
```

1. `ShadowTrafficService.shouldSample(requestId)` 基于 djb2 hash 决定是否采样
2. 同时运行 `originalFn` 和 `shadowFn`，shadow 有独立超时（默认 5000ms）
3. 计算 `diff`：
   - `toolsDiff` — 工具调用集合的差异（+new_tool / -removed_tool）
   - `lengthDelta` — 答案长度绝对差
   - `diverged` — 工具集不同，或长度偏差 > 50%
4. 统计 `total / sampled / diverged`

### 触发时机

- 每次生产 chat 请求（按采样率决定是否触发）
- 新版本灰度上线前，建议先跑 Shadow 确认 diverged < 5%

### 关键阈值

| 指标 | 正常范围 | 告警阈值 |
|------|---------|---------|
| 采样率 | 默认 10% | 可调 0-100% |
| diverged rate | < 5% | > 10% 需关注 |
| shadow 超时率 | < 1% | > 5% 需调查 |

---

## Tier 3 — Canary（渐进式灰度发布）

### 目的

将新功能或新模型按比例逐步推送给真实用户，在每个阶段观察
error_rate 和用户满意度，满足条件后再晋级，否则自动回滚。

### 发布阶段

```
5% → 24h 观察 → (正常) → 25% → 24h → (正常) → 50% → 24h → (正常) → 100%
                          ↑                        ↑
                     (error_rate > 5% 自动回滚)  (同上)
```

### 关键指标

| 指标 | 触发动作 |
|------|---------|
| `error_rate > error_rate_threshold (默认5%)` | 自动回滚 |
| `satisfaction_rate < 80%` | 建议人工审查 |

### 数据表

- `canary_flags` — flag 配置与状态
- `canary_metrics` — 每个 stage 的聚合指标

### API

| 端点 | 描述 |
|------|------|
| `GET /api/admin/canary` | 列出所有 flags |
| `POST /api/admin/canary` | 创建 flag |
| `POST /api/admin/canary/:name/promote` | 晋级到下一 stage |
| `POST /api/admin/canary/:name/rollback` | 降级到上一 stage |
| `GET /api/admin/canary/:name/metrics` | 查看指标 |

---

## 整体运营流程

```
1. 开发新功能
   ↓
2. 在 Tier 1 中补充/更新 eval cases
   ↓
3. 本地运行 eval-runner.test.ts 确认通过
   ↓
4. 提 PR → CI 自动运行 eval-suite job
   ↓
5. 合并后，在 Tier 2 Shadow Traffic 中验证行为差异 < 5%
   ↓
6. 创建 Canary Flag（默认 5% 开始）
   ↓
7. 观察 24h：error_rate 正常 → 手动 promote 或等自动晋级
   ↓
8. 依次通过 25% / 50% / 100% 阶段
   ↓
9. 标记 completed，功能全量发布
```
