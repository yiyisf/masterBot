# masterBot v3 重构进度追踪

最后更新：2026-05-11（Phase 4 完成）

---

## 总体进度

| Phase | 名称 | 状态 | 分支 | PR | 完成日期 |
|-------|------|------|------|----|---------|
| **P0** | 准备工作 | ✅ 完成 | `refactor-v3-p0-preparation` | #32 | 2026-05-10 |
| **P1** | 可观测性先行 | ✅ 完成 | `v3-p1-observability` | - | 2026-05-10 |
| **P2** | Hooks 重构 | ✅ 完成 | `v3-p2-hooks` | - | 2026-05-10 |
| P2.5 | Identity & Policy | ⬜ TODO | - | - | - |
| **P3** | ClaudeManagedAgent 上线 | ✅ 完成 | `v3-p3-claude-managed` | #35 | 2026-05-11 |
| **P4** | Skills + Subagents 升级 | 🔄 进行中 | `v3-p4-skills-subagents` | #36 | - |
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

---

## Phase 3 详细进度（已完成）

### 任务清单

- [x] 任务 1：`src/core/agent/claude-managed.ts`（ClaudeManagedAgent implements IAgent）
  - [x] 调用 SDK `query()` 作为 AsyncGenerator
  - [x] `thinking: { type: 'adaptive' }` 开启自适应思考
  - [x] `abortController` 从 `AgentInput.abortSignal` 桥接（Review 后修复）
  - [x] `persistSession` 不显式开启，避免 `~/.claude/projects/` 磁盘堆积
- [x] 任务 2：`src/core/agent/sdk-hook-adapter.ts`（buildSdkHooks）
  - [x] 12 个 SDK hook 事件桥接到 HookRegistry
  - [x] `PreToolUse` 中止时返回 `permissionDecision: 'deny'`
  - [x] `PermissionRequest.resolve` 补充 no-op 回调（Review 后修复）
- [x] 任务 3：`src/skills/sdk-mcp-wrapper.ts`（createMasterBotMcpServer）
  - [x] JSON Schema → Zod shape 转换（string/number/boolean/array/object）
  - [x] 改用 `zod/v4` 与 SDK 对齐（Review 后修复）
  - [x] `z.record(z.string(), z.unknown())` 适配 v4 两参数签名（Review 后修复）
  - [x] 所有 SKILL.md 技能包装为 in-process MCP Server
- [x] 任务 4：`src/core/agent/event-translator.ts`（translateSdkStream）
  - [x] SDKMessage → AgentEvent 翻译层
  - [x] 多 block（thinking+text）改为 generator yield*，消除内容丢失（Review 后修复）
- [x] 任务 5：`src/core/agent/agent-event-adapter.ts`（agentEventToExecutionStep）
  - [x] AgentEvent → ExecutionStep 适配，前端 SSE 格式零改动
- [x] 任务 6：`src/config/feature-flag.ts`（EnvFeatureFlagService）
  - [x] djb2 hash 确定性分流，默认灰度 5%
  - [x] 环境变量 `CLAUDE_MANAGED_AGENT_ROLLOUT_PERCENT` 控制比例
- [x] 任务 7：`src/core/agent/router.ts` 扩展 AgentRouter
  - [x] `claudeFactory` 注入 ClaudeManagedAgent
  - [x] `forceLegacy` 强制走 Legacy（调试/回滚用）
- [x] 任务 8：`src/index.ts` + `src/gateway/server.ts` 接入
  - [x] index.ts 构造 agentRouter 并注入 GatewayServer
  - [x] server.ts `/api/chat/stream` 优先走 agentRouter，fallback Legacy
  - [x] `abortSignal` + `forceLegacy` 正确透传（Review 后修复）
- [x] 任务 9：`scripts/ab-compare.ts`（A/B 对比脚本）
- [x] 任务 10：`docs/migration/sdk-vs-legacy-comparison.md`（灰度放量决策模板）
- [x] 任务 11：`tests/evals/capability/`（3 个 YAML 评测集）
  - [x] `basic-conversation.yaml`（10 个基础对话用例）
  - [x] `tool-calling.yaml`（7 个工具调用用例）
  - [x] `multi-turn.yaml`（5 个多轮对话用例）
- [x] 任务 12：`web/src/app/settings/page.tsx` 添加 Agent 路由面板

### 完成标准验证

- [x] TypeScript 零错误（`npx tsc --noEmit`）
- [x] 158 个测试全部通过（+0 个 Phase 3 新增，Phase 2 已含 hooks 测试）
- [x] ClaudeManagedAgent 实现 IAgent 接口完整（execute / resume / fork / checkpoint / capabilities）
- [x] AgentRouter 灰度路由逻辑覆盖：forceLegacy / provider ≠ anthropic / feature flag 未开启 → Legacy
- [x] SSE 格式兼容：前端 ExecutionStep 结构未变，零前端改动
- [x] Review P0/P1 问题全部修复（commit 82c43b7）

### Review 修复记录（commit 82c43b7）

| 级别 | 问题 | 修复方案 |
|------|------|---------|
| P0 | `translateAssistant` 只取第一个 content block，thinking+text 消息丢失 text | 改为 `translateAssistantBlocks` async generator，每个 block 单独 yield |
| P0 | `AgentInput` 缺少 `abortSignal`，客户端断连后 SDK query 无法取消 | 添加 `abortSignal?: AbortSignal`，ClaudeManagedAgent 桥接为 SDK `abortController`，Legacy 直接透传 |
| P1 | `PermissionRequest` 事件缺少 `resolve` 回调，hitl-hook 调用时运行时崩溃 | 补充 no-op `resolve`，实际决策通过 `SyncHookJSONOutput` 返回值传递 |
| P1 | `sdk-mcp-wrapper.ts` 用 zod v3，SDK 期望 zod v4，运行时 schema 验证可能异常 | 改用 `zod/v4` import；`z.record()` 补充 key type 参数适配 v4 API |
| P2 | `server.ts` agentRouter 路径未读取 `forceLegacy` 字段，A/B 脚本无法强制 Legacy | `request.body` 中读取并透传 `forceLegacy` |

### 设计决策

| 决策 | 原因 |
|------|------|
| SDK query() 不设 `persistSession: false` | 默认行为即不写磁盘，Phase 5 再评估 session 持久化策略 |
| thinking: adaptive 而非 extended | adaptive 让模型自行决定是否思考，不强制增加成本 |
| in-process MCP Server 而非外部 MCP | 减少网络跳跃，SKILL.md 投资得到保护，Phase 4 再评估外部 MCP 需求 |
| AgentEvent → ExecutionStep 中间层 | 解耦 SDK 消息格式与前端 SSE 协议，SDK 升级时只需改适配层 |
| 灰度默认 5% | SDK 路径未经生产验证，5% 足够收集指标同时控制风险 |
| hitl HiTL PermissionRequest 为 no-op | SDK hook 是同步返回值模型，异步 IM 审批流程推迟到 Phase 7 IM 一等公民阶段实现 |

---

## Phase 4 详细进度（进行中）

### 任务清单

- [x] 任务 1：`src/types.ts` 新增 `SkillTier` / `SkillCategory` 类型，`ToolDefinition` 携带 tier/category
- [x] 任务 2：`src/skills/registry.ts` `parseSkillMd` 读取 frontmatter tier/category
- [x] 任务 3：`src/skills/loader.ts` `getTools()` 输出携带 tier/category
- [x] 任务 4：所有 13 个 built-in SKILL.md 标注 tier/category
  - [x] core: shell, file-manager, http-client
  - [x] extended: notification, document-processor, vision, database-connector, log-analyzer, im-bot
  - [x] experimental: browser-automation, gemini-cli, claude-code, conductor-workflow
- [x] 任务 5：`src/skills/sdk-mcp-wrapper.ts` 新增 `tierFilter?: SkillTier[]` 参数
- [x] 任务 6：`src/core/agent/subagents.ts` 实现 `buildSubagentDefs()`（4 个部门专家）
- [x] 任务 7：`src/core/agent/claude-managed.ts` 集成 core-tier 过滤 + subagents
- [x] 任务 8：`scripts/token-count.ts` token 节省测量脚本
- [x] 任务 9：`tests/skills-tier.test.ts`（9 个测试）

### 完成标准验证

- [x] TypeScript 零错误（`npx tsc --noEmit`）
- [x] 167 个测试全部通过（+9 个 Phase 4 新增）
- [x] token 节省 ≥30%：实际 **81.3%**（208 → 39 tokens）
- [x] 4 个部门专家 Subagent：hr-specialist / finance-analyst / it-support / engineering-assistant
- [x] 权限隔离验证：hr-specialist 无 shell，it-support 有 shell
- [x] PR #36 已提交（base: refactor/v3）

### Token 节省报告

| 路径 | 工具数 | 估算 tokens | 备注 |
|------|--------|-------------|------|
| Phase 3（全量） | 13 技能，38 actions | ~208 | 所有工具注入主 Agent |
| Phase 4（core） | 3 技能，11 actions | ~39 | 仅 shell/file-manager/http-client |
| **节省** | - | **~169 (81.3%)** | ✅ 超额完成 ≥30% 目标 |

### 设计决策

| 决策 | 原因 |
|------|------|
| core tier 只含 3 个技能 | shell/file/http 是绝大多数任务的基础工具，其余通过 Subagent 委派获取 |
| Subagent tools 用 `skill.action` 格式 | 与 LocalSkillSource 的命名约定一致，便于 MCP wrapper 路由 |
| hr-specialist 无 shell 权限 | 最小权限原则：HR 任务不需要任意代码执行能力 |
| it-support maxTurns=30 | 运维任务可能需要多步骤诊断，给予更多轮次空间 |
| ToolDefinition 携带 tier 字段 | 避免额外索引查询，过滤逻辑在 MCP wrapper 层一次完成 |
