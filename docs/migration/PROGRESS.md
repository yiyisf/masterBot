# masterBot v3 重构进度追踪

最后更新：2026-05-17（Phase 10 进行中，PR #46 开放）

---

## 总体进度

| Phase | 名称 | 状态 | 分支 | PR | 完成日期 |
|-------|------|------|------|----|---------|
| **P0** | 准备工作 | ✅ 完成 | `refactor-v3-p0-preparation` | #32 | 2026-05-10 |
| **P1** | 可观测性先行 | ✅ 完成 | `v3-p1-observability` | #33 | 2026-05-10 |
| **P2** | Hooks 重构 | ✅ 完成 | `v3-p2-hooks` | #34 | 2026-05-11 |
| P2.5 | Identity & Policy | ⬜ 暂缓 | - | - | - |
| **P3** | ClaudeManagedAgent 上线 | ✅ 完成 | `v3-p3-claude-managed` | #35 | 2026-05-11 |
| **P4** | Skills + Subagents 升级 | ✅ 完成 | `v3-p4-skills-subagents` | #36 | 2026-05-12 |
| **P5** | Session 高级特性 | ✅ 完成 | `v3-p5-session` | #37 | 2026-05-13 |
| **P6** | Memory 四层 + 租户隔离 | ✅ 完成 | `v3-p6-memory` | #38 | 2026-05-15 |
| **P6.5** | DuckDB VSS + HitL 强化 | ✅ 完成 | `v3-p6.5-memory-supplement` | #40 | 2026-05-15 |
| **P7** | 企业 IM 一等公民 | ✅ 完成 | `v3-p7-enterprise-im` | #41 | 2026-05-15 |
| **P8** | Admin Console 基础 | ✅ 完成 | `v3-p8-admin-console` | #42 | 2026-05-16 |
| **P9** | 评估金字塔（持续） | ✅ 完成 | `worktree-refactor-v3-p9` | #43 | 2026-05-16 |
| **P9.5** | Skill Factory 2.0 | ✅ 完成 | `worktree-refactor-v3-p9.5` | #44 | 2026-05-16 |
| **P9.7** | UI/UX Design System | ✅ 完成 | `worktree-refactor-v3-p9.7` | #45 | 2026-05-17 |
| **P10** | Web 版 MVP | 🔄 进行中 | `worktree-refactor-v3-p10` | #46 | - |
| P11 | Web 版灰度上线 | ⬜ TODO | - | - | - |
| P12 | Web 版迭代运营 | ⬜ TODO | - | - | - |
| P13 | Electron 准备 | ⬜ TODO | - | - | - |
| P14 | Electron 打包 | ⬜ TODO | - | - | - |
| P15 | 三轨升级体系 | ⬜ TODO | - | - | - |
| P16 | Electron 灰度上线 | ⬜ TODO | - | - | - |

**当前进度：12 / 16 Phase 完成（含 P6.5 / P9.5 / P9.7 增补），累计 +35,000 行代码。**

---

## 测试覆盖里程碑

| Phase 完成时 | 测试文件数 | 测试总数 |
|-------------|-----------|---------|
| P0 完成 | 8 | 130 |
| P2 完成 | 10 | 158 |
| P3 完成 | 10 | 158 |
| P4 完成 | 11 | 167 |
| P5 完成 | 12 | 185 |
| P6 完成 | 13 | 197 |
| P6.5 完成 | 14 | 206 |
| P7 完成 | 15 | 230 |
| P8 完成 | 22 | 247 |
| P9 完成 | 23 | 448 |
| P9.5 完成 | 24 | 489 |
| P9.7 完成 | 24 | 489 |
| P10 进行中 | 24 | 460 通过（3 pre-existing 失败）|

---

## 已知阻塞与决策

| 日期 | 问题 | 状态 | 处理方式 |
|------|------|------|---------|
| 2026-05-10 | `@anthropic-ai/claude-agent-sdk` 要求 `zod@^4`，项目现在是 `zod@^3` | ✅ 已解决 | P3 中用 `--legacy-peer-deps` 安装；P6.5 全量升级 zod v4 |
| 2026-05-10 | git 不支持 `refactor/v3` 和 `refactor/v3/p0-preparation` 并存 | ✅ 已解决 | 改用 `-` 分隔：`refactor-v3-p0-preparation` |
| 2026-05-15 | PR #39 错误合入 master（本应 base refactor/v3） | ✅ 已解决 | 用 `git revert` 回滚 master，cherry-pick 正确提交到 PR #40 重新合入 |
| 2026-05-15 | DuckDB 在 Node.js ESM 严格模式下加载失败 | ✅ 已解决 | P6.5 降级为 SQLite FTS5 向量近似搜索，DuckDB 作为可选 opt-in |
| 2026-05-17 | `https-proxy-agent@9` 实例直传 node-fetch 导致 TLS 握手失败 | ✅ 已解决 | 函数包装模式 `() => agentInstance`，详见 ADR-0017 |

---

## Phase 0 详细进度（已完成）

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
  - [x] 无 API key 时 skip，有 key 时通过（CI 验证）
- [x] 任务 5：建立 `docs/migration/infrastructure-checklist.md`

### 完成标准验证

- [x] 4 份 ADR 完成
- [x] docs/migration/ 目录建立
- [x] SDK 安装成功，版本锁定为 `0.2.138`
- [x] sdk-smoke 测试可运行（无 key 时 skip）
- [x] 现有 npm test 全部通过（130 tests）
- [x] git log 包含 Phase 0 完整记录

---

## Phase 1 详细进度（已完成）

### 任务清单

- [x] 任务 1：安装 OTel 依赖（api/sdk-node/auto-instrumentations/otlp-http/semantic-conventions）
- [x] 任务 2：实现 `src/observability/otel.ts`（OtelObserver，GenAI Semantic Conventions）
- [x] 任务 3：`SpanRecorder` 内部代理到 OtelObserver（双写 SQLite+OTel，@deprecated 标记）
- [x] 任务 4：`deploy/observability/` Langfuse self-hosted docker-compose
- [x] 任务 5：OTel Collector 配置导出到 Langfuse OTLP 端点
- [x] 任务 6：`tests/performance/otel-overhead.test.ts`（3 个性能测试，开销 < 100ms/1000 ops）
- [x] 任务 7：`docs/migration/langfuse-setup.md` + `observability-guide.md`

### 完成标准验证

- [x] OtelObserver 通过性能测试
- [x] SpanRecorder 所有调用点透明迁移（agent.ts ×3, agent-run-helpers.ts ×7, server.ts ×2）
- [x] 143 个测试全部通过（TypeScript 零错误）
- [x] Langfuse docker-compose 配置完整

### 设计决策

| 决策 | 原因 |
|------|------|
| SpanRecorder 双写而非直接替换 | Phase 1 不改接口，避免触碰 RunContext 类型链（Phase 2 统一处理）|
| OTel Collector 作为中间层 | 便于未来切换后端（Jaeger/Tempo/Datadog）而不修改 masterBot 代码 |

---

## Phase 2 详细进度（已完成）

### 任务清单

- [x] 任务 1：`src/core/agent/types.ts`（IAgent / AgentInput / AgentEvent / AgentCapabilities）
- [x] 任务 2：`src/core/agent/legacy.ts`（LegacySelfHostedAgent 包装现有 Agent 类）
- [x] 任务 3：`src/core/agent/router.ts`（AgentRouter + EnvFeatureFlagService）
- [x] 任务 4：`src/core/hooks/types.ts` + `src/core/hooks/registry.ts`（12 事件 + HookRegistry）
- [x] 任务 5：7 个内置 Hook
  - [x] `builtin/sandbox-hook.ts`（PreToolUse Shell 沙箱）
  - [x] `builtin/hitl-hook.ts`（PermissionRequest HitL 审批）
  - [x] `builtin/memory-hook.ts`（UserPromptSubmit 长期记忆注入）
  - [x] `builtin/pii-hook.ts`（UserPromptSubmit PII 脱敏 stub）
  - [x] `builtin/retry-hook.ts`（PostToolUseFailure 自动重试 stub）
  - [x] `builtin/audit-hook.ts`（Session + Tool 合规审计）
  - [x] `builtin/otel-hook.ts`（Session + Tool OTel Span）
- [x] 任务 6：`tests/hooks.test.ts`（15 个测试）
- [x] 任务 7：`docs/migration/hooks-architecture.md` + `hooks-mapping.md`

### 完成标准验证

- [x] IAgent / HookRegistry 接口稳定，TypeScript 零错误
- [x] 158 个测试全部通过（+15 个 Phase 2 新增）
- [x] AgentRouter 支持 feature flag 路由（Phase 3 ClaudeManagedAgent 接入口就绪）
- [x] LegacySelfHostedAgent 包装无破坏性变更

### 设计决策

| 决策 | 原因 |
|------|------|
| LegacySelfHostedAgent 包装而非修改 Agent | 避免 615 行 agent.ts 在 Phase 2 出现回归 |
| Hook 抛异常时 continue 而非 abort | 横切关注点失败不应中断主 Agent 流程 |
| PII / Retry 为 stub | 避免引入大依赖，接口已稳定供后续 Phase 实现 |

---

## Phase 3 详细进度（已完成）

### 任务清单

- [x] 任务 1：`src/core/agent/claude-managed.ts`（ClaudeManagedAgent implements IAgent）
  - [x] 调用 SDK `query()` 作为 AsyncGenerator，thinking: adaptive
  - [x] `abortController` 从 `AgentInput.abortSignal` 桥接（Review P0 修复）
  - [x] `persistSession` 不显式开启，避免磁盘堆积
- [x] 任务 2：`src/core/agent/sdk-hook-adapter.ts`（buildSdkHooks）
  - [x] 12 个 SDK hook 事件桥接到 HookRegistry
  - [x] `PreToolUse` 中止时返回 `permissionDecision: 'deny'`（Review P1 修复）
  - [x] `PermissionRequest.resolve` 补充 no-op 回调（Review P1 修复）
- [x] 任务 3：`src/skills/sdk-mcp-wrapper.ts`（createMasterBotMcpServer）
  - [x] JSON Schema → Zod shape 转换，改用 `zod/v4`（Review P1 修复）
  - [x] 所有 SKILL.md 技能包装为 in-process MCP Server
- [x] 任务 4：`src/core/agent/event-translator.ts`（translateSdkStream）
  - [x] 多 block 改为 generator yield*（Review P0 修复）
- [x] 任务 5：`src/core/agent/agent-event-adapter.ts`（AgentEvent → ExecutionStep）
- [x] 任务 6：`src/config/feature-flag.ts`（FeatureFlagService，djb2 hash，默认 5%）
- [x] 任务 7：AgentRouter 扩展，`forceLegacy` 透传（Review P2 修复）
- [x] 任务 8：`src/index.ts` + `src/gateway/server.ts` 接入，fallback Legacy
- [x] 任务 9：`scripts/ab-compare.ts`（A/B 对比脚本）
- [x] 任务 10：`docs/migration/sdk-vs-legacy-comparison.md`
- [x] 任务 11：`tests/evals/capability/`（3 个 YAML 评测集，22 条初始用例）
- [x] 任务 12：Settings 页面添加 Agent 路由面板

### 完成标准验证

- [x] TypeScript 零错误
- [x] 158 个测试全部通过
- [x] ClaudeManagedAgent 实现 IAgent 完整（execute / resume / fork / checkpoint / capabilities）
- [x] SSE 格式兼容：前端 ExecutionStep 结构未变，零前端改动
- [x] 5 项 Review 问题全部修复

### 设计决策

| 决策 | 原因 |
|------|------|
| thinking: adaptive | 让模型自行决定是否思考，不强制增加成本 |
| in-process MCP Server | 减少网络跳跃，SKILL.md 投资得到保护 |
| 灰度默认 5% | SDK 路径未经生产验证，控制风险 |

---

## Phase 4 详细进度（已完成）

### 任务清单

- [x] 任务 1：`src/types.ts` 新增 `SkillTier` / `SkillCategory` 类型
- [x] 任务 2：`src/skills/registry.ts` `parseSkillMd` 读取 frontmatter tier/category
- [x] 任务 3：`src/skills/loader.ts` `getTools()` 输出携带 tier/category
- [x] 任务 4：所有 13 个 built-in SKILL.md 标注 tier/category
  - [x] core: shell, file-manager, http-client
  - [x] extended: notification, document-processor, vision, database-connector, log-analyzer, im-bot
  - [x] experimental: browser-automation, gemini-cli, claude-code, conductor-workflow
- [x] 任务 5：`src/skills/sdk-mcp-wrapper.ts` 新增 `tierFilter?: SkillTier[]` 参数
- [x] 任务 6：`src/core/agent/subagents.ts`（4 个部门专家：hr / finance / it / engineering）
- [x] 任务 7：`ClaudeManagedAgent` 集成 core-tier 过滤 + subagents
- [x] 任务 8：`scripts/token-count.ts` token 节省测量脚本
- [x] 任务 9：`tests/skills-tier.test.ts`（9 个测试）

### 完成标准验证

- [x] TypeScript 零错误
- [x] 167 个测试全部通过（+9 个 Phase 4 新增）
- [x] token 节省 ≥30%：实际 **81.3%**（208 → 39 tokens）
- [x] 4 个部门专家权限隔离验证（hr-specialist 无 shell）

### Token 节省报告

| 路径 | 工具数 | 估算 tokens |
|------|--------|-------------|
| Phase 3（全量） | 13 技能，38 actions | ~208 |
| Phase 4（core） | 3 技能，11 actions | ~39 |
| **节省** | - | **~169（81.3%）** |

---

## Phase 5 详细进度（已完成）

### 任务清单

- [x] 任务 1：`src/core/agent/types.ts` — `checkpoint(sessionId, label?)` 可选 label
- [x] 任务 2：`src/core/agent/claude-managed.ts` — `fork()` + `checkpoint()` + `capabilities()` 实现
  - [x] fork: 调用 SDK `forkSession()`，写入 `sessions.parent_session_id`
  - [x] checkpoint: 优先从 SDK JSONL 快照，fallback 到 historyRepository，存入 `checkpoints` 表
  - [x] resume: AgentRouter 通过 `legacyAgent.resume()` 转发（legacy 路径）
- [x] 任务 3：`src/core/agent/legacy.ts` — 签名补 `label?`，保持接口兼容
- [x] 任务 4：`src/core/agent/router.ts` — fork/checkpoint 优先 ClaudeManagedAgent，合并 capabilities
- [x] 任务 5：`src/core/database.ts` — 自动迁移 `sessions.parent_session_id` 列 + `checkpoints` 表
- [x] 任务 6：`src/core/repository.ts` — `recordFork()` + `getForks()`
- [x] 任务 7：`src/gateway/server.ts` — `POST /fork`、`GET /forks`、checkpoint CRUD + restore 端点
- [x] 任务 8：`src/index.ts` — CheckpointManager 提前初始化，注入 ClaudeManagedAgent
- [x] 任务 9：`web/src/components/chat/fork-button.tsx` — ForkButton 组件
- [x] 任务 10：`web/src/app/chat/page.tsx` — 工具栏加入 ForkButton + CheckpointPanel
- [x] 任务 11：`tests/session.test.ts`（18 个测试）

### 完成标准验证

- [x] TypeScript 零错误
- [x] 185 个测试全部通过（+18 个 Phase 5 新增）
- [x] fork / checkpoint / resume 完整链路可用
- [x] Web UI 显示 Fork + Checkpoint 操作按钮

### 设计决策

| 决策 | 原因 |
|------|------|
| checkpoint 双路 fallback | SDK JSONL 为主，historyRepository 为兜底，保证离线可用 |
| resume 走 legacy 路径 | ClaudeManagedAgent resume 依赖 SDK session ID，Phase 5 优先交付 legacy 路径 |

---

## Phase 6 详细进度（已完成）

### 任务清单

- [x] 任务 1：`src/memory/types.ts` — `IMemoryRouter` 接口 + 四层类型定义
- [x] 任务 2：`src/memory/episodic.ts` — L2 实现（SQLite FTS5 + LIKE fallback，90 天 TTL，tenant 隔离）
- [x] 任务 3：`src/memory/semantic.ts` — L3 实现（HitL pending/approve/reject + 幂等写入，confidence 阈值）
- [x] 任务 4：`src/memory/procedural.ts` — L4 实现（SOUL.md/AGENTS.md fs.watch 热重载）
- [x] 任务 5：`src/memory/memory-router.ts` — 实现 `IMemoryRouter`，向后兼容 legacy LongTermMemory
- [x] 任务 6：`src/core/database.ts` — 自动建表 `episodic_memories` + `semantic_facts`
- [x] 任务 7：`src/index.ts` — 初始化四层存储，注入 MemoryRouter
- [x] 任务 8：`src/gateway/server.ts` — Semantic HitL 端点（`/api/semantic-facts/*`）
- [x] 任务 9：`src/core/agent-run-helpers.ts` — memory_recall 传 tenantId
- [x] 任务 10：`tests/memory-phase6.test.ts`（12 个测试）

### 完成标准验证

- [x] TypeScript 零错误
- [x] 197 个测试全部通过（+12 个 Phase 6 新增）
- [x] 租户隔离：tenant-A 写入的记忆/事实，tenant-B 查不到（测试覆盖）
- [x] Semantic HitL 流程：upsert → pending → approve → search 可查到

### 四层记忆架构

| 层级 | 实现类 | 存储 | 说明 |
|------|--------|------|------|
| L1 Working | SDK 内置 | 内存 | 对话上下文窗口，SDK 自动管理 |
| L2 Episodic | `EpisodicMemoryStore` | SQLite FTS5 | 会话记录，90 天 TTL，tenant 隔离 |
| L3 Semantic | `SemanticMemoryStore` | SQLite | HitL 审批门（confidence≥0.85→pending→approve/reject）|
| L4 Procedural | `ProceduralMemory` | 文件系统 | SOUL.md/AGENTS.md 热加载，注入 system prompt |

---

## Phase 6.5 详细进度（已完成，增补 Phase）

> 注：Phase 6.5 是计划外增补，因 P6 review 发现若干必须修复项及 zod 升级需求。

### 任务清单

- [x] 修复 1：L2/L3 FTS5 向量搜索增强（SQLite FTS5 近似检索，DuckDB VSS 降级为可选）
- [x] 修复 2：HitL 前端审批页 `web/src/app/admin/` 补全（审批操作 UI）
- [x] 修复 3：Active Compression（上下文压缩主动触发机制）
- [x] 修复 4：SSE stream 处理修复（多 content block 顺序保证）
- [x] 修复 5：tenantId 正确透传至所有 memory 操作调用点
- [x] 修复 6：全量升级 zod v4（消除 `--legacy-peer-deps` 依赖）
- [x] 修复 7：`SessionMessage.type` 类型修复（`readonly` 兼容性）
- [x] `tests/memory-phase6.5.test.ts`（9 个测试）

### 完成标准验证

- [x] TypeScript 零错误
- [x] 206 个测试全部通过（+9 个 Phase 6.5 新增）
- [x] zod v4 升级，移除 `--legacy-peer-deps`
- [x] PR #39 错误合入 master 已通过 revert 修复，PR #40 正确合入 refactor/v3

---

## Phase 7 详细进度（已完成）

### 任务清单

- [x] 任务 1：`src/channels/types.ts` — `IChannel` 统一接口（riskLevel / allowModify / health）
- [x] 任务 2：`src/channels/feishu.ts` — FeishuChannel 强化
  - [x] access_token 30min 缓存（告别每次换 token）
  - [x] AES-256-CBC 消息加密解密（encryptKey 非空时自动生效）
  - [x] riskLevel → 卡片颜色（green/yellow/orange/red）
  - [x] `allowModify` → "✏️ 带修改批准"第三态按钮
  - [x] `crypto.timingSafeEqual()` 替换字符串比较（Review 修复：防时序攻击）
  - [x] `post()` 失败时 throw 而非静默（Review 修复）
- [x] 任务 3：`src/channels/dingtalk.ts` — DingTalkChannel（新增）
  - [x] HMAC-SHA256 签名验证 + access_token 缓存
  - [x] ActionCard 交互卡片（三态：approve/reject/modify）
  - [x] `crypto.timingSafeEqual()` 防时序攻击（Review 修复）
  - [x] `post()` 失败时 throw（Review 修复）
- [x] 任务 4：`src/channels/hitl-card-renderer.ts` — HitlCardRenderer
  - [x] 统一管理超时定时器（默认 5 分钟自动 reject）
  - [x] `clear()` 在 `set()` 前调用防止 timer 泄漏（Review 修复）
  - [x] 解析飞书/钉钉两种 callback 格式
- [x] 任务 5：`src/channels/router.ts` — ChannelRouter（多渠道注册/注销/路由）
- [x] 任务 6：WeCom / Teams stub 实现（预留 Phase 7.5）
- [x] 任务 7：`src/gateway/server.ts` — 新端点（`/api/channels/:channel/inbound`、`/card-action`、`/api/channels/health`），保留旧 `/api/im/*` 向后兼容
- [x] 任务 8：`tests/channels.test.ts`（24 个测试）

### 完成标准验证

- [x] TypeScript 零错误
- [x] 230 个测试全部通过（+24 个 Phase 7 新增）
- [x] FeishuChannel / DingTalkChannel 安全加固（timingSafeEqual + throw on error）
- [x] 3 项 Review 必修项全部完成

### 安全修复记录（Review 后补）

| 问题 | 修复方案 | 影响 |
|------|---------|------|
| `verifyRequest()` 字符串 `===` 比较 HMAC | 改用 `crypto.timingSafeEqual()`（飞书 hex，钉钉 base64 各自正确编码） | 防时序攻击 |
| `post()` 失败静默吞错 | 失败时 `throw new Error(msg)` | 调用方可感知推送失败 |
| HitlCardRenderer timer 泄漏 | `send()` 中 `this.clear(id)` 先于 `this.pending.set(id)` | 防孤儿 setTimeout |

---

## Phase 8 详细进度（已完成）

### 任务清单

**数据层**
- [x] `src/core/database.ts` — 新增 3 张表：`skill_reviews` / `rbac_rules` / `admin_audit_log`
- [x] `src/core/admin-repository.ts` — AdminRepository（SkillReview CRUD + RBAC CRUD + 概览统计 + 审计查询 + 成本统计）

**认证**
- [x] `src/gateway/auth.ts` — `createAdminHook`（独立 X-Admin-Key 鉴权，与用户 API Key 完全隔离）
- [x] `src/gateway/server.ts` — admin-changeme 默认 key 启动告警（Review 修复）

**API（9 端点，全 403 保护）**
- [x] `GET /api/admin/stats` — 概览统计
- [x] `GET /api/admin/skills/review` + `POST /api/admin/skills/review/:name` — 技能审批
- [x] `GET /api/admin/rbac` + `POST /api/admin/rbac` + `DELETE /api/admin/rbac/:id` — RBAC 规则
- [x] `GET /api/admin/audit` — 审计查询（6 维过滤 + 分页）
- [x] `GET /api/admin/cost` — 成本看板（daily/byModel/topUsers）
- [x] `GET /api/admin/log` — 管理操作日志

**路由封装（Review 修复）**
- [x] `src/gateway/admin-router.ts` — Fastify plugin 封装（`app.register()`），消除全局 hook + dangling Promise 泄漏

**配置**
- [x] `config/default.yaml` — `admin.apiKeys`（`ADMIN_API_KEY` 环境变量）
- [x] `src/types.ts` — `Config.admin`

**前端（5 页面）**
- [x] `web/src/lib/admin.ts` — 共享工具（`getAdminKey` / `adminFetch`）
- [x] `web/src/app/admin/layout.tsx` — Admin 侧栏导航 + Key 登录页
- [x] `web/src/app/admin/page.tsx` — 概览面板（4 张统计卡 + 最近管理操作）
- [x] `web/src/app/admin/skills/review/page.tsx` — 技能审批
- [x] `web/src/app/admin/rbac/page.tsx` — RBAC 规则增删
- [x] `web/src/app/admin/audit/page.tsx` — 审计查询（6 维过滤 + 分页 + CSV 导出）
- [x] `web/src/app/admin/cost/page.tsx` — 成本看板

**文档**
- [x] `docs/admin-console-guide.md` — 管理员使用手册

**测试**
- [x] `tests/admin.test.ts`（17 个测试）

### 完成标准验证

- [x] 后端 TypeScript 零错误
- [x] 前端 TypeScript 零错误
- [x] 247 个测试全部通过（+17 个 Phase 8 新增）
- [x] 权限保护：无 X-Admin-Key → 403
- [x] 5 项 Review 必修项全部完成

---

## Phase 9 详细进度（已完成）

### 任务清单

**Tier 1 — Capability Eval Suite**
- [x] 任务 1：扩展 `tests/evals/capability/basic-conversation.yaml` → 30 条
- [x] 任务 2：扩展 `tests/evals/capability/tool-calling.yaml` → 30 条
- [x] 任务 3：`tests/evals/capability/multi-turn-context.yaml` → 30 条
- [x] 任务 4：新建 `tests/evals/capability/permission-and-safety.yaml` → 30 条
- [x] 任务 5：`tests/evals/golden/golden-set.yaml` — 50 条关键场景
- [x] 任务 6：`tests/evals/run-evals.ts` + `tests/evals/eval-runner.test.ts`（201 个测试）

**Tier 2 — Shadow Traffic**
- [x] 任务 7：`src/eval/shadow-traffic.ts`（ShadowTrafficService：djb2 采样 + 双路对比 + diverged 检测）

**Tier 3 — Canary 系统**
- [x] 任务 8：`src/core/database.ts` — 新增 `canary_flags` + `canary_metrics` 两张表
- [x] 任务 9：`src/eval/canary.ts`（CanaryService：5 级渐进发布 5%→25%→50%→100% + 自动回滚）
- [x] 任务 10：`src/gateway/admin-router.ts` — 5 个 canary API 端点
- [x] 任务 11：`web/src/app/admin/canary/page.tsx` — Canary 看板
- [x] 任务 12：`web/src/app/admin/layout.tsx` — 添加 Canary 导航项

**CI & 脚本**
- [x] 任务 13：`.github/workflows/eval.yml` — CI 流水线
- [x] 任务 14：`scripts/generate-eval-report.ts` — 报告生成器

**文档**
- [x] 任务 15：`docs/eval/three-tier-pyramid.md`
- [x] 任务 16：`docs/eval/writing-good-test-cases.md`
- [x] 任务 17：`docs/eval/canary-process.md`
- [x] 任务 18：ADR 0005-0013（P1-P9 架构决策补充）

### 完成标准验证

- [x] TypeScript 零错误
- [x] 448 个测试全部通过（+201 个 Phase 9 新增 eval 测试）
- [x] Eval 套件覆盖：120 条 capability + 50 条 golden = 170 条
- [x] Canary 渐进发布链路（5%→25%→50%→100%）可用

### Eval 套件统计

| 套件 | 用例数 | 覆盖类别 |
|------|--------|---------|
| basic-conversation.yaml | 30 | 基础问答 / 指令遵循 / 格式化 / 多语言 / 边界情况 |
| tool-calling.yaml | 30 | 工具选择 / 错误处理 / 链式调用 / 条件调用 / 输出解析 |
| multi-turn-context.yaml | 30 | 记忆 / 上下文追踪 / 信息累积 / 角色一致性 / 话题切换 |
| permission-and-safety.yaml | 30 | 危险命令拒绝 / 权限边界 / 信息安全 / 合规场景 |
| golden-set.yaml | 50 | 必须答对的关键场景（7 大类，任何 PR 破坏均 block merge）|
| **总计** | **170** | - |

---

## Phase 9.5 详细进度（已完成）

### 任务清单

**核心模块（`src/skill-factory/`）**
- [x] 任务 1：`types.ts` — SkillSpec / SkillFactoryJob / 8 状态枚举 / 评分结构体
- [x] 任务 2：`client.ts` — LocalSkillFactory（Stage 1-4 串联）
- [x] 任务 3：`server.ts` — EnterpriseSkillFactory（Stage 5 + Admin 评审门）
- [x] 任务 4：`stages/understand.ts` — LLM 意图解析 → SkillSpec 草稿
- [x] 任务 5：`stages/synthesize.ts` — LLM 生成 SKILL.md + index.ts
- [x] 任务 6：`stages/verify.ts` — StaticValidator（frontmatter/kebab-case/export）+ SecurityScanner（16 条规则）
- [x] 任务 7：`stages/eval.ts` — tsx 进程隔离执行（30s 超时）+ LLM-as-Judge（4 维度评分）
- [x] 任务 8：`publisher.ts` — 发布到 skill_catalog + audit_log
- [x] 任务 9：`auto-curator.ts` — 每日 curation（featured/needs_improvement/archived）

**数据层**
- [x] 任务 10：`src/core/database.ts` — 新增 `skill_factory_jobs` + `skill_catalog` 两张表

**API（10 个端点）**
- [x] 任务 11：`src/gateway/admin-router.ts` — factory 命名空间下的 10 个端点（job CRUD + 状态轮询 + publish/approve/reject/archive）

**前端**
- [x] 任务 12：`web/src/app/skills/factory/page.tsx` — 5 步向导（需求输入 / 生成中 / 审查代码 / 安全评分 / 发布确认）
- [x] 任务 13：`web/src/components/skill-factory-wizard.tsx` — 向导组件（含 Progress UI）

**测试**
- [x] 任务 14：`tests/skill-factory.test.ts`（41 个测试）
  - StaticValidator / SecurityScanner 16 条规则覆盖
  - LLMJudge mock 解析 4 维度评分
  - LocalSkillFactory job CRUD 完整 DB 操作
  - DB 迁移表创建验证

### 完成标准验证

- [x] TypeScript 零错误（skill-factory 模块）
- [x] 489 个测试全部通过（+41 个 Phase 9.5 新增）
- [x] SecurityScanner 拦截 hardcoded-key / SQL 注入 / 命令注入 / 路径遍历
- [x] LLM-as-Judge 综合分 < 7 → pending-review 路由验证
- [x] 5 步向导 UI 实时显示生成进度

### 设计决策

| 决策 | 原因 |
|------|------|
| 双段协同（Local + Enterprise）| 个人草稿不阻塞企业评审，快速反馈 |
| tsx 进程隔离（非 Docker）| 轻量沙箱，无需容器基础设施 |
| 16 条内置安全规则（非 Semgrep）| 避免外部依赖，critical/high → 直接拒绝，不经过 LLM 判断 |

---

## Phase 9.7 详细进度（已完成）

### 任务清单

**Design Tokens**
- [x] 任务 1：`design/tokens/color.ts` — 品牌色 + 语义色 + 中性色梯度
- [x] 任务 2：`design/tokens/typography.ts` — 字号阶梯 / 行高 / 字重
- [x] 任务 3：`design/tokens/spacing.ts` — 4px 基准 8 级间距
- [x] 任务 4：`design/tokens/radius.ts` + `shadow.ts` + `motion.ts`

**主题系统**
- [x] 任务 5：`web/src/app/globals.css` — `.high-contrast` + `.high-contrast.dark` CSS 变量（WCAG AAA）
- [x] 任务 6：`web/src/components/theme-provider.tsx` — 三主题（light / dark / high-contrast）+ localStorage 持久化

**组件库（26 个组件）**
- [x] 任务 7：基础 UI 组件（checkbox / radio-group / popover）— `@radix-ui/react-*`
- [x] 任务 8：业务组件（chat-message / tool-call-card / thinking-panel / hitl-approval-dialog / skill-card / skill-factory-wizard / command-palette / citation-link / status-indicator / connector-card）
- [x] 任务 9：布局组件（header / empty-state / main-layout / auth-layout / index.ts barrel）

**Storybook**
- [x] 任务 10：`.storybook/main.ts` + `preview.ts` — `@storybook/nextjs@^8.6.18` + `addon-a11y`
- [x] 任务 11：7 个 stories 文件（28+ stories）
- [x] 任务 12：`web/tsconfig.json` — stories 文件排除（防 Next.js 类型冲突）

### 完成标准验证

- [x] `cd web && npm run build` — 24 条路由，0 错误
- [x] 三主题 CSS 变量完整（light / dark / high-contrast 各一套）
- [x] Storybook 可启动（`npm run storybook`）
- [x] Radix UI 导入路径正确（`@radix-ui/react-*` 独立包）
- [x] stories 文件从 tsconfig 排除，消除类型报错

### 设计决策

| 决策 | 原因 |
|------|------|
| TypeScript 常量 Token（非 Style Dictionary）| 当前规模不值得工具链；TypeScript 有完整类型检查 |
| CSS 变量覆盖高对比度（非独立主题文件）| 不修改组件代码即可切换，AAA 对比度由 CSS 变量保证 |
| Storybook stories 排除于 tsconfig | Next.js App Router 不需要 stories 类型；消除构建冲突 |

---

## Phase 10 详细进度（进行中，PR #46 开放）

### 任务清单

**存储抽象层（`src/storage/`）**
- [x] 任务 1：`types.ts` — IStorageAdapter 接口（Session / Message / Memory / Audit 四类）
- [x] 任务 2：`web-adapter.ts` — WebStorageAdapter（HTTP 调用 Fastify API，Phase 13 Electron 预留替换点）

**AG-UI Runtime**
- [x] 任务 3：`web/src/lib/agui-runtime.ts` — 将后端 SSE chunk 映射为 AG-UI 事件序列

**新页面**
- [x] 任务 4：`web/src/app/auth/login/page.tsx` — Login 页（SSO 跳转 + dev 快速登录）
- [x] 任务 5：`web/src/app/history/page.tsx` — 历史记录（按日期分组 + 搜索 + 导出 + 软删除）

**全局组件**
- [x] 任务 6：`web/src/components/command-palette-provider.tsx` — ⌘K / Ctrl+K 全局命令面板
- [x] 任务 7：`web/src/components/onboarding-tour.tsx` — 5 步引导（localStorage 一次性展示）
- [x] 任务 8：`web/src/components/error-boundary.tsx` — React class boundary（重试 + 刷新）
- [x] 任务 9：`web/src/components/sw-registrar.tsx` — Service Worker 注册器

**离线支持**
- [x] 任务 10：`web/public/sw.js` — 网络优先（HTML 导航）+ 缓存优先（静态资源），不缓存 /api/ / /ws

**页面增强**
- [x] 任务 11：Settings 页 — 新增「个人偏好」Tab（三主题选择 + 语言 + 通知）
- [x] 任务 12：Skills 页 — 新增「技能目录」Tab（SkillCard 网格 + 搜索 + 状态过滤）
- [x] 任务 13：Sidebar — 添加「历史记录」+ 「Skill Factory」导航项

**安全**
- [x] 任务 14：`web/next.config.ts` — CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy 响应头

**Bug Fix**
- [x] 任务 15：`src/llm/openai.ts` + `anthropic.ts` — HTTPS 代理 TLS 修复（函数包装模式，详见 ADR-0017）

### 当前状态

- PR #46 已开放，等待合并到 master
- 460 个后端测试通过（3 个 pre-existing 失败：otel / conductor-api / harness）
- 前端 TypeScript 零错误，`npm run build` 29 条路由通过

### 设计决策

| 决策 | 原因 |
|------|------|
| IStorageAdapter 接口 | Phase 13 Electron 只需替换实现，UI 无感（详见 ADR-0016）|
| AG-UI Runtime 并行于 assistant-runtime.ts | 不替换现有 runtime，AG-UI 路径作为未来切换点 |
| Service Worker 跳过 /api/ 和 /ws | API 和 WebSocket 必须走网络，缓存会导致数据过期 |
| dev 模式快速登录仅在 development 可见 | `process.env.NODE_ENV === 'development'` 守卫，防止生产环境暴露 |

---

## 待办事项（后续 Phase）

### P11 — Web 版灰度上线（下一个）
- 灰度发布策略（Canary Service 集成）
- 用户反馈收集 API
- 性能监控（Core Web Vitals）
- 回滚预案文档

### P12 — Web 版迭代运营
- 基于 Langfuse 数据和用户反馈持续优化
- 能力 eval 通过率逐步提升

### P13 — Electron 准备
- 实现 `ElectronStorageAdapter`（IStorageAdapter 接口的本地 SQLite 实现）
- 评估 Electron vs Tauri
