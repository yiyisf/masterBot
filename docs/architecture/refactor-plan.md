# 增量重构执行计划

> **状态：Accepted / Normative**
>
> 当前设计分支：`design/next-architecture`。生产实现禁止直接在 `master` 上修改。

## 1. 交付策略

采用 Walking Skeleton + Vertical Slice：每个 Slice 从最新 `master` 创建短期分支，通过 PR 合入；未完成能力用 Feature Flag 或未挂载路由隔离。当前原型未推广，因此不迁移旧 SQLite 数据、不兼容旧 API/SSE/`ExecutionStep`。

根据 ADR-0042，旧 `src/`、`tests/`、`web/`、`skills/`、`agents/` 在替换期间冻结为只读参考。可复用逻辑复制到新 Workspace 并按新 Interface 与测试重写；新代码不得反向导入 Legacy。

完整分支规则见 [`docs/engineering/refactor-branching.md`](../engineering/refactor-branching.md)。

## 2. Slice 0 — Workspace Foundation

**分支**：`refactor/workspace-foundation`

### 目标

建立可强制执行的 Module、Contract、PostgreSQL 和 CI 护栏，不做全目录搬迁。

### 交付

- npm Workspaces：`apps/server`、`apps/web`、`packages/contracts`、最小 `packages/kernel`
- `packages/README.md` 记录后续 Module 路线；业务 Package 只在有真实 Interface、行为和测试时创建
- Package exports、TypeScript Project References、dependency-cruiser 禁止 deep import、循环依赖和跨 Module 私有访问
- Zod → OpenAPI → openapi-typescript/openapi-fetch 最小 Contract 生成链
- PostgreSQL 17 本地/CI 环境与连接/事务 Smoke；SQLite 仅保留后续开发 Adapter 约定
- Fastify `api|worker|all` 与 Next.js Server Runtime 最小组合根
- 类型安全 Environment Feature Flag，默认关闭
- 架构边界 Fixture、Module Contract 和独立 Workspace CI

### 验收/退出

- 新 package 依赖方向在 CI 中失败可见
- PostgreSQL 测试可重复启动
- 生成 client 可被最小 Web 编译使用
- 旧应用仍可启动；没有批量移动旧代码

## 3. Slice 1 — Run Walking Skeleton

**分支**：`refactor/run-walking-skeleton`

### 目标

使用 Fake/Echo Engine 打通 Browser → API → PostgreSQL → Worker → SSE。

### 交付

- Development Identity、Organization/Principal Request Context
- Conversation/Message 最小 Module
- Run/Invocation/RunEvent 状态与 Repository
- Outbox、PostgreSQL Dispatcher/Lease、API/Worker/all roles
- `POST /api/v1/runs`、Run Query、Command、Replayable SSE
- Run sequence、前端去重和 Snapshot + Event Projection
- 最小 Employee Workspace 页面

### 关键测试

- Run 接受后 API 退出不丢失
- 两 Worker 不同时持有同一有效 Lease
- SSE 断线按 Last-Event-ID 补读，无重复 UI 状态
- Worker 崩溃后 Lease 到期恢复 Fake Run

## 4. Slice 2 — AI SDK Runtime

**分支**：`refactor/ai-sdk-runtime`

### 目标

在既有 Execution Interface 后接入真实模型和默认 AI SDK Agent Engine。

### 交付

- Model Catalog/Router/Gateway
- Vercel AI SDK Model Adapter 与精确版本锁定
- AI SDK Agent Engine Adapter
- Engine-neutral Context/Model/Output 事件映射
- usage、OTel GenAI attributes、受控 Fallback
- AI SDK UI Presenter Adapter（不替代 canonical SSE）
- Smoke/Regression Eval

### 验收/退出

- 切换 Model Adapter 不改变 Run/Conversation Contract
- Provider 错误和部分输出有明确恢复结果
- usage、实际 Model Profile、Trace 与 Run 关联
- AI SDK 类型未出现在 Domain/Persistence/Public canonical events

## 5. Slice 3 — Governed Tool Runtime

**分支**：`refactor/tool-runtime`

### 目标

让所有 Engine 通过同一 Tool Runtime 调用工具。

### 交付

- Tool Catalog/Runtime、ToolDescriptor 和 ToolOutcome
- AI SDK Tool Wrapper
- 进程内 Policy Adapter、Agent Grant/Delegation 检查
- Tool-call Ledger、idempotency/reconciliation 状态
- Interrupt/Approval Command 与 UI Projection
- 2–3 个审查后的 Built-in Tools
- 隔离 Provider Host 骨架；MCP/扩展不进主进程
- Agent Skills 标准 Parser 与 Legacy Adapter 骨架
- Credential Reference 和开发 Broker Adapter

### 验收/退出

- 未授权 Tool 无法因 Engine/子 Agent 变化绕过
- 未知非幂等结果进入 `requires_review`
- Approval 断线、恢复和审计闭环
- Tool Provider 崩溃不退出 API/Worker 主进程

## 6. Slice 4 — Context & Artifacts

**分支**：`refactor/context-artifacts`

### 目标

建立可审计 Context 和可复用工作输出。

### 交付

- Context Builder、Policy、Manifest 和内容 provenance/hash
- Conversation History 选择与摘要派生
- Artifact/Version/Content metadata
- Local content-addressed Adapter、staging/quarantine/derivative/trash
- ToolOutcome → Artifact reference
- Artifact REST/权限/Range read 与 Renderer Registry

### 验收/退出

- 第二个 Run 引用 Message/Context Manifest，不复制历史
- Artifact 重复内容复用 Blob，版本不可覆盖
- Worker 重启不丢已提交 Artifact
- Storage path/key 不进入 Domain、Contract 或 UI

## 7. Slice 5 — Employee Workspace

**分支**：`refactor/employee-workspace`

### 目标

完成第一条员工可用体验。

### 交付

- Employee/Admin 两套导航壳，首期聚焦 Employee
- Conversation list/thread/composer
- Run Timeline、Invocation、Tool Activity、Approval、Artifact
- Query Cache、Streaming Projection、Local UI State 分层
- Tool/Artifact/Run Renderer Registry 与 Fallback
- Design Token、i18n、Light/Dark、WCAG AA
- 桌面完整、移动 Conversation/状态/审批/下载
- 展示执行透明度，不展示 raw chain-of-thought

### 验收/退出

- 长对话流式更新不整树重渲染
- 刷新后 Snapshot + Event 恢复同一 UI
- 键盘、Focus、非颜色状态和 reduced motion 验收
- 未知 Renderer 类型不导致页面崩溃

## 8. Slice 6 — Production Starter

**分支**：`refactor/production-starter`

### 目标

达到单机企业内网试点要求。

### 交付

- Generic/internal OIDC Adapter、HttpOnly Session、CSRF
- Web/API/Worker/PostgreSQL/Artifact Volume 部署
- PostgreSQL + Artifact 协调备份/恢复演练
- Audit、OTel Export、rate limit、安全 Header 和 Secret Reference
- Run/Event/Audit retention job
- Production E2E、Eval Gate、Canary Runbook
- 运维、容量、RPO/RTO 和故障排查文档

### 验收/退出

- 完整首里程碑场景通过
- 100 并发在线/20 并发 Run 基线压测达到目标
- Worker/API 分别重启后 Run 与 SSE 可恢复
- RPO ≤ 24h、RTO ≤ 4h 的恢复演练有证据
- 无明文长期 Credential 进入 Event、Trace 或 Artifact metadata

## 9. 第一里程碑完成定义

员工通过内部身份登录，创建 Conversation 和 Run；Worker 使用 AI SDK Engine，经 Policy 与 Tool Runtime 调用受控 Tool，必要时等待审批，生成 Message/Artifact；页面实时展示并可在刷新/断线后恢复；所有操作关联 Organization、Principal、Run、Audit 和 Trace。

## 10. 后续 Slice

优先顺序在第一里程碑真实反馈后重新评估：

1. Agent Revision + Admin Console + Eval 发布门禁
2. Agent Skills Catalog、安装验证与隔离 Provider 管理
3. Memory/Knowledge ingestion、检索和 Context Policy
4. Task/Workflow/Runbook/Schedule/Webhook 统一自动化
5. 企业 Credential Broker Adapter
6. Claude SDK/Codex/Pi 等更多 Agent Engine
7. HA Profile：多 API/Worker、S3/MinIO、Redis Streams/NATS、Kubernetes/OpenShift

## 11. 每个 PR 的 Definition of Done

- 分支来自最新 `master`，禁止直接主分支开发
- 公开 Interface 小且记录不变量、错误和性能约束
- Domain 不导入框架/SDK/ORM 类型
- Zod Contract、OpenAPI/client 和实现一致
- PostgreSQL Integration 与适用 Adapter Contract tests 通过
- 关键失败路径、权限和恢复测试通过
- 相关 Eval/OTel 更新完成
- 无长期双写、无未说明 deep import、无明文 Secret
- 文档、ADR/CONTEXT（如术语或硬决策改变）同步
- 替代完成后删除旧代码和只验证旧实现细节的测试

## 12. 主要风险与控制

| 风险 | 控制 |
|---|---|
| Module 过度拆分 | 只有真实多实现建立 Port；以深 Interface 为验收 |
| AI SDK 再次贯穿全栈 | 三个独立 Adapter，禁止 SDK 类型越过 Seam |
| API/Worker 事件丢失 | PostgreSQL EventStore + sequence + Outbox；Notify 仅唤醒 |
| Tool 重复副作用 | Ledger、idempotency、reconciliation、requires_review |
| 双数据库行为不一致 | PostgreSQL 定义生产语义；CI 必跑 PostgreSQL |
| UI 被事件细节耦合 | Canonical Event → Presenter → Projection Reducer |
| 长期分支偏离 | 短分支、PR、Feature Flag；不使用 refactor 大合并 |
| 范围再次膨胀 | 第一里程碑明确排除 Workflow、完整 Memory、HA、Vault |

## 13. 暂缓技术选型

ORM/Query Builder、AI SDK 精确版本、向量检索、对象存储、实时 Broker、外部 Policy/Vault、容器平台在对应 Slice 开始时用小型技术 Spike 和 Contract 测试决策，不改变本文领域与 Module 基线。
