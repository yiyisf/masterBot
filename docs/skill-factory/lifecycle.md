# Skill Factory 2.0 — 技能生命周期

## 状态机（8 个状态）

```
                    ┌──────────┐
              ─────▶│ drafting │◀─────────────────────────────┐
             │      └────┬─────┘                              │
             │           │ runStage1/2 开始                   │
             │           ▼                                    │
             │    ┌─────────────┐                            │
             │    │synthesizing │                            │
             │    └──────┬──────┘                            │
             │           │ Stage 2 完成                       │
             │           ▼                                    │
             │    ┌──────────────┐                            │
             │    │ local-tested │  Stage 3+4 全部通过         │
             │    └──────┬───────┘                           │ reject()
             │           │ submitForReview()                  │
             │           ▼                                    │
             │    ┌────────────────┐                          │
             │    │ pending-review │ 等待人工评审              │
             │    └──────┬─────────┘                         │
             │           │ approveAndPublish()                │
             │           ▼                                    │
             │    ┌──────────┐                                │
             │    │ approved │ 评审通过                        │
             │    └────┬─────┘                                │
             │         │ SkillPublisher.publish()             │
             │         ▼                                      │
             │    ┌────────┐      deprecated      ┌──────────┐│
             │    │ active │ ──────────────────▶ │deprecated ││
             │    └────────┘                      └─────┬─────┘│
             │         │ quarantine                     │ archive
             │         ▼                                ▼      │
             │  ┌─────────────┐               ┌──────────┐    │
             └──│ quarantined │               │ archived │    │
                └─────────────┘               └──────────┘    │
                                                              ─┘
```

## 状态说明

| 状态 | 含义 | 允许操作 |
|------|------|---------|
| `drafting` | Stage 1-2 进行中或等待开始 | runStage1, runStage2 |
| `synthesizing` | Stage 2 代码生成中 | — (自动过渡) |
| `local-tested` | Stage 3+4 通过，可提交或安装 | installAsDraft, submitForReview |
| `pending-review` | 已提交企业评审，等待人工批准 | approve, reject |
| `approved` | 评审通过，Publisher 写入文件系统 | publish (自动) |
| `active` | 已发布，线上运行 | deprecate, quarantine |
| `deprecated` | 标记废弃，仍可调用 | archive |
| `archived` | 归档，不再对外暴露 | — |
| `quarantined` | 发现安全问题，强制下线 | — |

## 状态转换触发条件

```
drafting ─────────────────────────────▶ drafting
  (runStage1 调用，设置 skill_name 和 spec_json)

drafting ─────────────────────────────▶ synthesizing
  (runStage2 调用开始时)

synthesizing ─────────────────────────▶ local-tested
  (runStage4 完成时，sandbox + judge 结果写入)

local-tested ─────────────────────────▶ pending-review
  (submitForReview() 写入 skill_reviews 表)

pending-review ───────────────────────▶ approved
  (EnterpriseSkillFactory.approveAndPublish() 调用)

pending-review ───────────────────────▶ drafting
  (EnterpriseSkillFactory.reject() 调用，附带拒绝原因)

approved ─────────────────────────────▶ active
  (SkillPublisher.publish() 写入文件系统后自动)

active ────────────────────────────────▶ deprecated
  (管理员手动标记，或 AutoCurator needs_improvement 超期)

deprecated ───────────────────────────▶ archived
  (AutoCurator 检测到 needs_improvement 超 7 天无改善)

active ────────────────────────────────▶ quarantined
  (安全事件触发，管理员操作)
```

## AutoCurator 策展规则

每日执行 `AutoCurator.runDailyCuration()`：

| 条件 | 动作 |
|------|------|
| 30 天调用次数 > 100 | `curation_status = 'featured'` |
| 存在 30+ 天 && 30 天调用次数 < 5 | `curation_status = 'needs_improvement'` |
| 已标记 needs_improvement && 存在 37+ 天 (即 7 天未改善) | `state = 'deprecated'`, `curation_status = 'archived'` |
