# SDK vs Legacy 对比报告模板

> 本文档在每次灰度放量前更新，记录两条路径的关键指标。
> 数据来源：Langfuse dashboard + A/B 脚本（`npx tsx scripts/ab-compare.ts`）

---

## 对比时间

| 字段 | 值 |
|------|-----|
| 报告时间 | _填写_ |
| SDK 灰度比例 | _5%_ |
| 观察时长 | _7 天_ |
| 样本量（SDK） | _填写_ |
| 样本量（Legacy） | _填写_ |

---

## 核心指标对比

| 指标 | Legacy | SDK | Delta |
|------|--------|-----|-------|
| 成功率 | - | - | - |
| 平均首字节时间 (ms) | - | - | - |
| 平均总响应时间 (ms) | - | - | - |
| 平均 input tokens | - | - | - |
| 平均 output tokens | - | - | - |
| 平均成本 (USD/request) | - | - | - |
| 工具调用成功率 | - | - | - |

---

## Langfuse Tag 说明

- Legacy 路径 trace：`agent.path=legacy`
- SDK 路径 trace：`agent.path=sdk`

查询命令：
```
# Langfuse 过滤器
tag: agent.path=sdk
date: last 7 days
```

---

## 错误分布（SDK 路径）

| 错误类型 | 次数 | 占比 | 处理方式 |
|----------|------|------|---------|
| rate_limit | - | - | 已有重试 |
| authentication_failed | - | - | 检查 API key |
| server_error | - | - | 自动回退 Legacy |
| max_output_tokens | - | - | 调整 maxTurns |

---

## 灰度放量决策标准

满足以下所有条件可放量至下一档（5% → 20% → 50% → 100%）：

- [ ] SDK 成功率 ≥ Legacy 成功率 × 0.99（允许 1% 容差）
- [ ] SDK 平均响应时间 ≤ Legacy × 1.5（允许 50% 慢，因首次缓存加载）
- [ ] 连续 7 天无严重错误（P0/P1 事件）
- [ ] Langfuse 中 SDK trace 可正常查询和回溯
- [ ] A/B 脚本跑通，报告已存档

---

## 回滚触发条件

出现以下任一情况立即回滚（设置 `CLAUDE_MANAGED_AGENT_ROLLOUT_PERCENT=0` 并重启）：

- SDK 成功率连续 1 小时低于 Legacy 成功率 90%
- 任何 `authentication_failed` 批量出现（超过 5 次/分钟）
- 响应时间 P99 超过 30 秒
- 出现用户数据泄露或安全事件
