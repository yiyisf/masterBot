# Canary 发布流程

## 概述

Canary 发布（金丝雀发布）是一种将新功能按比例逐步推送给真实用户的发布策略。
CMaster Bot 的 Canary 系统支持 4 个默认阶段：

```
5% → 25% → 50% → 100%
```

每个阶段有观察期（默认 24h），并在错误率超过阈值时自动回滚。

---

## 发布流程

### 阶段 1：创建 Flag（5%）

```bash
# 通过 API 创建
curl -X POST http://localhost:3000/api/admin/canary \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"flagName": "my-feature-v2"}'
```

或通过 Admin Console：`/admin/canary` → 填写 Flag 名称 → 点击"创建"。

创建后，Flag 自动处于 `running` 状态，当前阶段 = 0（5%）。

---

### 阶段 2：观察期

在 5% 流量阶段，应关注：

| 指标 | 健康值 | 告警值 |
|------|--------|--------|
| error_rate | < 3% | > 5% |
| satisfaction_rate | > 80% | < 60% |
| p95 latency | 同基准 ±10% | > +30% |

通过 API 查看指标：

```bash
curl http://localhost:3000/api/admin/canary/my-feature-v2/metrics \
  -H "X-Admin-Key: $ADMIN_KEY"
```

响应：

```json
[
  {
    "stage": 0,
    "error_rate": 0.02,
    "satisfaction_rate": 0.85,
    "total_tokens": 15000
  }
]
```

---

### 阶段 3：手动提级

观察期结束，指标正常后，手动提级：

```bash
curl -X POST http://localhost:3000/api/admin/canary/my-feature-v2/promote \
  -H "X-Admin-Key: $ADMIN_KEY"
```

或在 Admin Console 点击"提级"按钮。

提级顺序：stage 0 (5%) → stage 1 (25%) → stage 2 (50%) → stage 3 (100%)。
当 stage 3 (100%) 提级后，Flag 状态变为 `completed`。

---

### 自动回滚触发条件

系统在每次 `recordMetric` 后（如果启用了 `auto_rollback`）检查：

```
error_count / (error_count + success_count) > error_rate_threshold
```

默认阈值：`error_rate_threshold = 0.05`（5%）。

触发自动回滚时，Flag 降级到上一个 stage。若已在 stage 0（5%），则直接标记为 `rolled_back`。

示例日志：

```
[canary] auto-rollback triggered for "my-feature-v2": error_rate=0.087 > threshold=0.05
[canary] flag "my-feature-v2" rolled back to stage 0 (5%)
```

---

### 手动回滚

```bash
curl -X POST http://localhost:3000/api/admin/canary/my-feature-v2/rollback \
  -H "X-Admin-Key: $ADMIN_KEY"
```

---

## 如何接入新功能

### 方案 1：与 FeatureFlagService 集成

```typescript
import { CanaryService } from '@/eval/canary.js';
import type { DatabaseSync } from 'node:sqlite';

// 在 agent 或 router 中检查当前百分比
const pct = canaryService.getCurrentPercent('my-feature-v2');
const userId = 'user-123';
const bucket = djb2(userId) % 100;

if (bucket < pct) {
    // 使用新功能
} else {
    // 使用旧功能
}
```

### 方案 2：与现有 FeatureFlagService 联动

Canary 可作为 FeatureFlagService 的后端，通过 `rolloutPercent` 动态注入：

```typescript
const pct = canaryService.getCurrentPercent('claude-managed-agent-v2');
featureFlagService.updateFlag('claude-managed-agent-v2', {
    enabled: pct > 0,
    rolloutPercent: pct,
});
```

### 记录指标

每次请求结束后，记录执行结果到指标表：

```typescript
// 成功
canaryService.recordMetric('my-feature-v2', currentStage, { success: true, tokens: 1500 });

// 失败
canaryService.recordMetric('my-feature-v2', currentStage, { error: true });

// 用户反馈
canaryService.recordMetric('my-feature-v2', currentStage, { thumbsUp: true });

// 检查自动回滚
const wasRolledBack = canaryService.checkAutoRollback('my-feature-v2');
if (wasRolledBack) {
    logger.warn('Canary automatically rolled back!');
}
```

---

## Admin Console 操作指南

1. 访问 `http://localhost:3000/admin/canary`（需要 Admin Key）

2. **查看现有 Flag：**
   - 每张卡片显示 flag 名称、当前阶段进度条、状态 badge
   - 进度条：绿色 = 已完成阶段，蓝色 = 当前阶段，灰色 = 未开始

3. **新建 Flag：**
   - 在顶部表单输入 Flag 名称
   - 点击"创建"（使用默认参数：5/25/50/100%，24h 观察期，5% 错误阈值）

4. **提级 / 降级：**
   - 在运行中的 Flag 卡片底部，点击"提级"或"降级"

5. **查看指标：**
   - 点击卡片下方的"查看指标"，展开每个阶段的 error_rate 和满意度数据
   - 红色高亮 = error_rate 超过 5% 阈值

---

## 自定义 Canary 参数

```bash
curl -X POST http://localhost:3000/api/admin/canary \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "flagName": "aggressive-rollout",
    "stages": [1, 10, 50, 100],
    "observeHours": 4,
    "errorRateThreshold": 0.02
  }'
```

参数说明：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `stages` | `[5, 25, 50, 100]` | 各阶段百分比（升序） |
| `observeHours` | `24` | 每阶段观察时间（小时） |
| `errorRateThreshold` | `0.05` | 自动回滚触发阈值（0-1） |

---

## 状态机

```
              create
  (none) ──────────────► running
                            │
              promote       │  rollback (stage > 0)
  ┌─────────────────────────┘  ◄─────────────────────────┐
  │                                                       │
  ▼                                                       │
running (stage N) ──────── promote ──────────► running (stage N+1)
                                                    │
                                             (last stage)
                                                    │
                                                    ▼
                                               completed
  running ──── rollback (stage == 0) ──────► rolled_back
```
