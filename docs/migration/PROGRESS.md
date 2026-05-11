# masterBot v3 重构进度追踪

最后更新：2026-05-11（Phase 3 完成）

---

## 总体进度

| Phase | 名称 | 状态 | 分支 | PR | 完成日期 |
|-------|------|------|------|----|---------|
| **P0** | 准备工作 | ✅ 完成 | `refactor-v3-p0-preparation` | #32 | 2026-05-10 |
| **P1** | 可观测性先行 | ✅ 完成 | `v3-p1-observability` | - | 2026-05-10 |
| **P2** | Hooks 重构 | ✅ 完成 | `v3-p2-hooks` | - | 2026-05-10 |
| P2.5 | Identity & Policy | ⬜ TODO | - | - | - |
| **P3** | ClaudeManagedAgent 上线 | ✅ 完成 | `v3-p3-claude-managed` | - | 2026-05-11 |
| P4 | Skills + Subagents 升级 | ⬜ TODO | - | - | - |
| P5 | Session 高级特性 | ⬜ TODO | - | - | - |
| P6 | Memory 四层 + 租户隔离 | ⬜ TODO | - | - | - |
| P7 | 企业 IM 一等公民 | ⬜ TODO | - | - | - |
| P8 | Admin Console 基础 | ⬜ TODO | - | - | - |
| P9 | 评估金字塔 | ⬜ TODO | - | - | - |
| P9.5 | Skill Factory 2.0 | ⬜ TODO | - | - | - |
| P9.7 | UI/UX Design System | ⬜ TODO | - | - | - |
| P10 | Web 版 MVP | ⬜ TODO | - | - | - |
| P11 | Web 版灰度上线 | ⬜ TODO | - | - | - |
| P12 | Web 版迭代运营 | ⬜ TODO | - | - | - |
| P13 | Electron 准备 | ⬜ TODO | - | - | - |
| P14 | Electron 打包 | ⬜ TODO | - | - | - |
| P15 | 三轨升级体系 | ⬜ TODO | - | - | - |
| P16 | Electron 灰度上线 | ⬜ TODO | - | - | - |

---

## Phase 0 详细进度（进行中）

### 任务清单

- [x] 任务 1：建立 `docs/adr/` 目录与 4 份 ADR
  - [x] `0001-hybrid-architecture.md`
  - [x] `0002-local-first-distribution.md`
  - [x] `0003-tech-stack-baseline.md`
  - [x] `0004-sdk-version-lock.md`
- [x] 任务 2：建立 `docs/migration/` 目录
  - [x] `README.md`
  - [x] `PHASES.md`
  - [x] `PROGRESS.md`（本文件）
- [x] 任务 3：添加 `@anthropic-ai/claude-agent-sdk` 依赖
  - [x] 安装 v0.2.138
  - [x] 锁定精确版本（去掉 `^`）
  - [x] ADR 0004 记录锁定原因
- [x] 任务 4：创建 `tests/integration/sdk-smoke.test.ts`
  - [ ] 有 API key 时实际运行通过（CI 中验证）
- [x] 任务 5：建立 `docs/migration/infrastructure-checklist.md`

### 完成标准验证

- [x] 4 份 ADR 完成
- [x] docs/migration/ 目录建立
- [x] SDK 安装成功，版本锁定为 `0.2.138`
- [ ] sdk-smoke 测试运行成功（需 ANTHROPIC_API_KEY，CI 中验证）
- [x] 现有 npm test 验证：130 tests passed（task-repository.test.ts 的并行锁冲突为既有问题，单独运行通过）
- [x] git log 包含 Phase 0 完整记录

---

## 已知阻塞与决策

| 日期 | 问题 | 状态 | 处理方式 |
|------|------|------|---------|
| 2026-05-10 | `@anthropic-ai/claude-agent-sdk` 要求 `zod@^4`，项目现在是 `zod@^3` | 记录 | 用 `--legacy-peer-deps` 安装，Phase 2 升级 zod |
| 2026-05-10 | git 不支持 `refactor/v3` 和 `refactor/v3/p0-preparation` 并存 | 记录 | 改用 `-` 分隔：`refactor-v3-p0-preparation` |

---

## Phase 1 详细进度（已完成）

### 任务清单

- [x] 任务 1：安装 OTel 依赖（api/sdk-node/auto-instrumentations/otlp-http/semantic-conventions）
- [x] 任务 2：实现 `src/observability/otel.ts`（OtelObserver，GenAI Semantic Conventions）
- [x] 任务 3：`SpanRecorder` 内部代理到 OtelObserver（双写 SQLite+OTel，@deprecated 标记）
- [x] 任务 4：`deploy/observability/` Langfuse self-hosted docker-compose
- [x] 任务 5：OTel Collector 配置导出到 Langfuse OTLP 端点
- [x] 任务 6：`tests/performance/otel-overhead.test.ts`（3 个性能测试全通过，开销 < 100ms/1000 ops）
- [x] 任务 7：`docs/migration/langfuse-setup.md` + `observability-guide.md`

### 完成标准验证

- [x] OtelObserver 通过性能测试
- [x] SpanRecorder 所有调用点透明迁移（agent.ts x3, agent-run-helpers.ts x7, server.ts x2）
- [x] 143 个测试全部通过（TypeScript 零错误）
- [x] Langfuse docker-compose 配置完整

### 设计决策

| 决策 | 原因 |
|------|------|
| SpanRecorder 双写而非直接替换 | Phase 1 不改接口，避免触碰 RunContext 类型链（Phase 2 统一处理）|
| OTel Collector 作为中间层 | 便于未来切换后端（Jaeger/Tempo/Datadog）而不修改 masterBot 代码 |
| `--legacy-peer-deps` | OTel 某些包也与 zod v3 有间接依赖冲突，Phase 2 升级 zod 后解决 |

---

## Phase 2 详细进度（已完成）

### 任务清单

- [x] 任务 1：`src/core/agent/types.ts`（IAgent / AgentInput / AgentEvent / AgentCapabilities）
- [x] 任务 2：`src/core/agent/legacy.ts`（LegacySelfHostedAgent 包装现有 Agent 类）
- [x] 任务 3：`src/core/agent/router.ts`（AgentRouter + EnvFeatureFlagService）
- [x] 任务 4：`src/core/hooks/types.ts` + `src/core/hooks/registry.ts`（12 事件 + HookRegistry）
- [x] 任务 5a：`builtin/sandbox-hook.ts`（PreToolUse Shell 沙箱）
- [x] 任务 5b：`builtin/hitl-hook.ts`（PermissionRequest HitL 审批）
- [x] 任务 5c：`builtin/memory-hook.ts`（UserPromptSubmit 长期记忆注入）
- [x] 任务 5d：`builtin/pii-hook.ts`（UserPromptSubmit PII 脱敏 stub）
- [x] 任务 5e：`builtin/retry-hook.ts`（PostToolUseFailure 自动重试 stub）
- [x] 任务 5f：`builtin/audit-hook.ts`（Session + Tool 合规审计）
- [x] 任务 5g：`builtin/otel-hook.ts`（Session + Tool OTel Span）
- [x] 任务 6：`tests/hooks.test.ts`（15 个测试，全通过）
- [x] 任务 7：`docs/migration/hooks-architecture.md` + `hooks-mapping.md` + 更新 PROGRESS.md

### 完成标准验证

- [x] IAgent / HookRegistry 接口稳定，TypeScript 零错误
- [x] 158 个测试全部通过（+15 个 Phase 2 新增）
- [x] AgentRouter 支持 feature flag 路由（Phase 3 ClaudeManagedAgent 接入口就绪）
- [x] 7 个内置 Hook 均有对应文档和测试覆盖
- [x] LegacySelfHostedAgent 包装无破坏性变更（现有 Agent 类未修改）

### 设计决策

| 决策 | 原因 |
|------|------|
| LegacySelfHostedAgent 包装而非修改 Agent | 避免 615 行 agent.ts 在 Phase 2 出现回归；Phase 3 再统一迁移 |
| Hook 抛异常时 continue 而非 abort | 横切关注点失败不应中断主 Agent 流程 |
| PII / Retry 为 stub | 避免引入大依赖（presidio/stateMachine），接口已稳定供 Phase 4/6 实现 |
| EnvFeatureFlagService 读环境变量 | 无需数据库，Phase 8 Admin Console 替换时接口不变 |
