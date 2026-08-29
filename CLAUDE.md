# CLAUDE.md

本文件为在 CMaster Bot 仓库中工作的 Claude Code 提供强制指引。

## 1. 先读规范

开始设计或实现前，按顺序阅读：

1. [`CONTEXT.md`](./CONTEXT.md) — 领域术语与禁止混用的名称
2. [`docs/architecture/README.md`](./docs/architecture/README.md) — 下一代架构规范入口
3. [`docs/architecture/target-architecture.md`](./docs/architecture/target-architecture.md)
4. [`docs/architecture/module-interfaces.md`](./docs/architecture/module-interfaces.md)
5. [`docs/architecture/data-model.md`](./docs/architecture/data-model.md)
6. [`docs/architecture/refactor-plan.md`](./docs/architecture/refactor-plan.md)
7. 与当前改动相关的 [`docs/adr/`](./docs/adr/) 决策

上述文档是未来实施的规范基线。旧的 Phase 路线图、Harness patch、能力差距报告和 v3/v3.1 重构方案已移除，不得从 Git 历史中的旧文档恢复设计约束。

## Agent skills

### Issue tracker

Issues and PRDs are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context layout with `CONTEXT.md` and system-wide ADRs under `docs/adr/`. See `docs/agents/domain.md`.

## 2. 项目状态

CMaster Bot 正从本地技术验证原型增量重构为企业内网 Web-first Enterprise Assistant。

当前 `src/`、`web/`、SQLite、`ExecutionStep`、自研 ReAct 和旧 SkillRegistry 仍代表**现有原型实现**；目标架构尚未全部落地。不要把当前目录结构误认为目标结构，也不要为旧 API、旧 SQLite 数据或旧 Session 模型增加兼容成本。

目标方向：

- 模块化单体，npm Workspaces
- `apps/server` 支持 `api | worker | all` 运行角色
- `apps/web` 提供 Employee Workspace 与 Admin Console
- PostgreSQL 为生产 System of Record；SQLite 仅用于开发调试 Adapter
- Conversation / Message / Run / Invocation 分离
- Provider-neutral Harness
- Vercel AI SDK 分别作为 Model、Agent Engine、UI Stream Adapter
- Tool Catalog / Tool Runtime 与 Skill/Connector/MCP 来源分离
- Agent Skills 为首选外部 Skill 格式
- 版本化 REST/SSE Contract、Run Event、Checkpoint、Outbox
- OIDC、Organization、Principal、Policy 和受限 Delegation
- Artifact 一等对象与可替换内容存储

## 3. 分支管理（强制）

- 禁止直接在 `master` 上修改、提交或推送。
- 每个 Slice 从最新 `master` 创建短期分支。
- 只通过 PR + CI + Review 合入。
- 当前设计文档分支为 `design/next-architecture`，不承载生产实现。
- 第一实施分支为 `refactor/workspace-foundation`，必须在设计 PR 合入后创建。
- 不建立持续数月的总重构分支，不做最终一次性大合并。
- 详细规则见 [`docs/engineering/refactor-branching.md`](./docs/engineering/refactor-branching.md)。

操作前始终执行：

```bash
git branch --show-current
git status --short
```

工作区存在无关修改时，不得覆盖、清理或纳入当前提交。

## 4. 增量实施规则

- 按 [`docs/engineering/first-milestone-sequence.md`](./docs/engineering/first-milestone-sequence.md) 实施 Walking Skeleton。
- 每个 PR 只覆盖一个可验证 Slice 或基础决策。
- 未完成能力通过 Feature Flag 或不挂载路由隔离。
- 每类权威数据只能有一个写路径；禁止长期双写。
- 不先做全目录移动；行为被新 Module 替换时再迁移代码。
- 替代完成后删除旧代码和只验证旧实现细节的测试。
- 不开发旧 SQLite 数据迁移、旧 API 兼容或旧 Harness 恢复。
- `src/`、`tests/`、`web/`、`skills/`、`agents/` 属于冻结的 Legacy，只读参考；新代码不得导入它们。
- 可复用逻辑必须复制到新 Workspace，按新 Interface 重写并添加新测试；只有紧急安全/数据完整性修复可走独立 `legacy-fix/*` 分支。

## 5. Module 与依赖纪律

目标 Workspace：

```text
apps/server
apps/web
packages/contracts
packages/kernel
packages/identity
packages/conversations
packages/execution
packages/agents
packages/models
packages/tools
packages/context
packages/artifacts
packages/automation
packages/governance
```

规则：

- Module 只通过 package root 的公开 Interface 使用另一个 Module。
- 禁止 deep import、跨 Module 直查表和共享可变实体。
- Domain 不导入 Fastify、Next.js、React、AI SDK、MCP SDK、数据库或 OTel 类型。
- Domain Model、Persistence Model、Contract Model 必须分离。
- Adapter 放在拥有该行为的 Module 内，保持修改局部性。
- 只有存在真实多实现时才建立 Port；禁止制造大量浅接口。
- `packages/kernel` 必须极小，禁止演变为新的 `core`。

## 6. 核心语义约束

- Conversation 保存完整 Message 历史；Run 引用 Message，不复制历史。
- Run 是一次被 Principal 授权的工作尝试；可由 Message、Task、Webhook、Schedule、API 或 parent Run 触发。
- 子 Agent 默认创建 child Invocation，不创建新 Conversation/Run。
- Agent 配置使用不可变 Agent Revision；Run 固定实际 Revision/Engine/Model/Policy 版本。
- Run Event 是可重放执行事实；Output Delta 和 UI Projection 是不同模型。
- 状态表用于查询，Run Event append-only，Checkpoint 用于恢复，不采用完整 Event Sourcing。
- Tool 副作用不承诺 exactly-once；未知非幂等结果进入人工/对账恢复，禁止盲重试。
- Skill 不等于 Tool；MCP 是 Tool Provider 协议。
- 员工 UI 展示结构化执行透明度，不展示原始 Chain-of-Thought。

## 7. Contract、UI 与安全

- 外部接口使用 Zod Contract-first，生成 OpenAPI 与 Typed Client。
- API 路径版本化；SSE Event 带 `schemaVersion/eventId/runId/sequence`。
- Browser 使用 HTTP Command + 可恢复 SSE；轮询仅降级。
- 前端按 Feature 组织，区分 Server State、Streaming Projection 和 Local UI State。
- Tool/Artifact/Run UI 通过 Renderer Registry 扩展，未知类型必须有 Fallback。
- 所有数据显式 Organization-scoped；API 不信任客户端传入 Principal/Organization。
- 员工认证基线是内部 OIDC + HttpOnly Session Cookie。
- ToolRuntime 统一执行 Policy、Credential、校验、超时、脱敏与审计。
- 扩展 Tool 默认隔离执行；只有审查后的 Built-in Tool 可进入主进程。
- Prompt、Tool 参数、Artifact 内容和 Diagnostic Trace 默认不进入遥测。

## 8. 测试与质量

测试面优先级：

1. Domain invariant
2. Module public Interface
3. Adapter Contract
4. PostgreSQL Integration
5. UI Projection/Component
6. Browser E2E
7. Agent Eval

要求：

- CI 必须验证真实 PostgreSQL 语义。
- SQLite Adapter 运行适用的 Repository Contract，但不定义生产行为。
- SSE 覆盖重连、重复、顺序和断流。
- Worker 覆盖 Lease 过期、Checkpoint 恢复和未知 Tool 副作用。
- 真实付费模型测试可以默认 skip，但发布前相关 Eval 必须运行。
- 依赖精确锁定；升级经 Contract/Integration/Eval/Canary，不做生产服务器自动更新。

## 9. 当前原型命令

目标 Workspace 尚未落地前，继续使用现有命令：

```bash
# 后端（仓库根目录）
npm run dev
npm run build
npm run test:run
npm run lint

# 前端
cd web
npm run dev
npm run build
npm run lint

# 架构状态模型原型
npm run prototype:architecture
```

Node.js 要求以根 `package.json` 为准，当前为 Node.js >= 22。

Workspace 落地后应同步更新本文件和 `AGENTS.md`，不得保留失效命令。

## 10. 文档维护

- 领域术语改变：立即更新 `CONTEXT.md`。
- 难以逆转、存在真实权衡且不解释会令人困惑的决定：新增 ADR。
- 目标架构或实施顺序改变：更新 `docs/architecture/`。
- 普通 Adapter/库替换通常不新增领域术语，也不需要 ADR。
- 本仓库的两份编码 Agent 指引必须同步维护。
