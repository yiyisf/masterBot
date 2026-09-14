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

- 仅非生产可用的固定 Development Organization/Employee Principal；身份由 Server 注入，Browser 不声明身份
- `identity`、`agents`、`conversations`、`execution` 四个真实 Module；固定 Development Echo Agent Revision
- Conversation、Employee Message、Run 三步 Command；Message 与 Run 生命周期分离
- Text Message Part、Conversation Message sequence、所有创建 Command 的 `Idempotency-Key`
- Run/Invocation/RunEvent 状态、Outbox、PostgreSQL Dispatcher/Lease 和 Echo Agent Engine
- `pg` 参数化 SQL、Module-owned `node-pg-migrate` Migration、单一 PostgreSQL `public` Schema
- `POST/GET` Conversation、Message、Run、Cancel 与 Replayable SSE v1 Contract
- `LISTEN/NOTIFY` 只唤醒；EventStore Replay 和 2 秒补读保证恢复
- `/workspace` 与 `/workspace/runs/{runId}` 最小 Employee Workspace

### 已确认语义

- Run 状态为 `accepted | queued | running | succeeded | failed | cancelled`
- `invocation.output_ready` 是取消的不可逆边界；取消先提交则不再持久化输出，输出先提交则取消返回 409
- Assistant Message 通过 `(organizationId, sourceRunId)` 幂等追加；失败不创建 Assistant Message
- SSE `id` 使用 Run sequence；首次连接可用 `afterSequence`，自动重连使用 `Last-Event-ID`
- Module 使用同一 PostgreSQL Schema；所有权由 Migration、Repository、依赖规则和测试维护，不提前建立 Schema/Role 隔离

### 关键测试

- Run 接受后 API 退出不丢失
- 两 Worker 不同时持有同一有效 Lease
- SSE 断线按 Last-Event-ID 补读，无重复 UI 状态
- Worker 崩溃后 Lease 到期恢复同一 Run/Invocation
- Cancel 与 `output_ready` 事务竞争结果确定
- Organization 隔离、幂等冲突和 UI sequence Reducer

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

**详细设计**：[`docs/design/slice-3-governed-tool-runtime.html`](../design/slice-3-governed-tool-runtime.html)

**实施追踪**：[#104](https://github.com/yiyisf/masterBot/issues/104)

### 目标

让所有 Engine 通过同一 Tool Runtime 调用工具。

### 交付

- Tool Catalog/Runtime、ToolDescriptor 和 ToolOutcome
- AI SDK Tool Wrapper
- 进程内 Policy Adapter、Agent Grant/Delegation 检查
- Tool-call Ledger、idempotency/reconciliation 状态
- Interrupt/Approval Command 与 UI Projection
- 3 个仅用于验证端到端治理流程的过渡 Built-in Tools：`cmaster.utility.current_time`、`cmaster.utility.text_statistics`、`cmaster.http.fetch`
- 上述 Tool 不是最终产品能力；真实有用的 Tool/Connector 覆盖同等验收后必须按 [#103](https://github.com/yiyisf/masterBot/issues/103) 删除替换
- 不可配置、不可生产启用的隔离 Provider Host 协议/崩溃隔离骨架；MCP/扩展不进主进程
- 完整安装、沙箱、MCP 与 Provider 生命周期管理归入首里程碑后的 Agent Skills & Isolated Provider Management Slice
- Credential Reference 和开发 Broker Adapter

### 验收/退出

- 未授权 Tool 无法因 Engine/子 Agent 变化绕过
- 未知非幂等结果进入 `requires_review`
- Approval 断线、恢复和审计闭环
- Tool Provider 崩溃不退出 API/Worker 主进程

## 6. Slice 4 — Context & Artifacts

**分支**：`refactor/context-artifacts`

**详细设计**：[`docs/design/slice-4-context-artifacts.html`](../design/slice-4-context-artifacts.html)

**实施追踪**：[#109](https://github.com/yiyisf/masterBot/issues/109)

### 目标

建立可审计、可恢复的 Invocation Context 和可复用的 Text/Markdown 工作输出，优先完成 Conversation 第二次 Run → 历史压缩 → Artifact Tool → Assistant Message 引用的主流程。

### 交付

- Context Builder、固定 baseline Context Policy、Context Manifest/Context Summary 和内容 provenance/hash
- 以 Trigger Message sequence 为历史上界；token 阈值、较早连续历史单层摘要、最近完整 Turn 原文
- 新的不可变 Development Agent Revision 与显式 context window/max output Model Profiles
- Artifact/Version/Content metadata，以及 `sourceToolCallId` 幂等恢复
- Local content-addressed Adapter：staging、UTF-8/大小检查、SHA-256、atomic promote、Blob 去重与过期 staging 清理
- 低风险、无需确认的 `cmaster.artifact.create_text`；Harness 确定性把 ToolOutcome Artifact Reference 附加到最终 Assistant Message
- 创建者私有的 Artifact metadata/content REST、单一 byte Range read，以及最小 Text/Markdown/unknown Renderer Registry
- `invocation.context_built` 与 `artifact.created` 安全 Run Events；正文、hash 和 storage key 不进入 Browser Event/Trace

### 验收/退出

- 第二个 Run 只使用截至 Trigger Message 的历史，引用 Message/Context Manifest 而不复制正文；恢复复用同一 Manifest 和 Summary
- 超预算历史产生结构化 Context Summary + 最近完整 Turn；Trigger Message 不截断，无法容纳时明确失败
- Artifact 重复内容在同 Organization 内复用 Blob，Version 不可覆盖，Message 固定引用确切 Version
- Artifact 提交后、ToolOutcome 前崩溃不重复创建；Worker 重启不丢已提交 Artifact 或最终 Message 引用
- 创建者可完整/Range 读取；同 Organization 其他 Principal 不可读取
- Storage path/key、Prompt、Summary/Artifact 正文不进入 Domain、Contract、Run Event、UI metadata 或普通遥测

### 明确延后

- 文件上传与 quarantine、预览 derivative、删除/trash/完整 GC
- 二进制 Artifact、PDF/Office/图片处理、分块或流式创建、多区间 Range
- 跨 Organization 去重语义、共享/管理员访问、在线编辑和版本 UI
- 语义检索、递归/分块/滚动摘要、执行中 Tool Result 压缩、Provider 服务端压缩、精确 tokenizer
- 完整 Artifact 列表与正式员工体验；由 Slice 5 完成

## 7. Slice 5 — Employee Workspace

**详细设计**：[`docs/design/slice-5-employee-workspace.html`](../design/slice-5-employee-workspace.html)

**实施追踪**：[#118](https://github.com/yiyisf/masterBot/issues/118)

**交付方式**：一个 Parent Spec 与多个 blockers-first 短期垂直分支/PR；不建立长期总集成分支。

### 目标

完成第一条以 Conversation 为中心、可恢复、可访问的员工可用体验。Run、Tool、Approval 与 Artifact 是 Conversation 内的执行透明度和工作输出，不成为平铺的平台导航。

### 交付

- 独立 Workspace 首页，Conversation list/thread/composer，首条 Message 确定性标题和 rename
- Conversation 默认创建者私有；同 Organization 跨 Principal 的 Conversation/Message/Run/Projection 使用 not-found 语义
- Conversation 下可寻址 Run Detail；Message→Run 分阶段幂等恢复和明确的新 Run attempts
- TanStack Query Server State、CMaster-owned Run UI Projection Snapshot/sequence stream、Local UI State 分层
- Assistant Draft 与最终 Message 分离；Timeline、Tool Activity、Confirmation、Uncertain Outcome 和 Cancel 交互
- “待处理”Presentation 聚合，不创建新领域实体或第二写路径
- private Artifact Library、exact Version route、按需 Text/Markdown preview、安全 download disposition 和未知 Fallback
- AI Elements + shadcn/ui 薄适配；框架类型停留在 Experience 层，不接管 Message/Run/Approval/Artifact 状态
- System/Light/Dark、zh-CN/en-US、自然非机器化文案、WCAG 2.2 AA
- 桌面完整三栏；移动交付 Conversation/Run/处理/Artifact 下载最小核心
- same-origin `/api/v1` 与开发 rewrite；业务写操作只走生成 Contract Client，不使用 Next.js Server Actions
- 临时 `CMASTER_EMPLOYEE_WORKSPACE_ENABLED`，显式依赖 Slice 4；Filesystem Workspace 替换完成后删除该 UI Flag，其余迁移 Flags 在 Production Starter 完成后统一删除

### 验收/退出

- 两次 Conversation Run、流式 Draft、Tool、Artifact exact Version、预览/下载形成生产形状 Browser 闭环
- Message 已保存但 Run 未启动、SSE gap/刷新、retryable failure 新 attempt 均确定性恢复且不重复事实
- Confirmation 与 Uncertain Outcome 严格区分；取消不承诺撤销 Tool effect
- 长对话流式更新不整树重渲染；1,000 Message 与 2,000 Timeline Fixture 通过防回归门禁
- Snapshot + sequence 恢复相同 Draft、Timeline、Interrupt 和最终 Message
- Playwright + axe 覆盖桌面完整与移动核心；键盘、Focus、非颜色状态和 reduced motion 通过
- zh-CN/en-US 与 Light/Dark 的核心流程通过；未知 Renderer/Projection 类型不导致页面崩溃
- Contract drift、Module boundaries、PostgreSQL/HTTP privacy 和完整 Browser E2E 通过

## 8. Slice 6 — Filesystem Workspace

**详细设计**：[`docs/design/filesystem-workspace.html`](../design/filesystem-workspace.html)

**实施顺序**：[`docs/architecture/filesystem-workspace-slice.md`](./filesystem-workspace-slice.md)

### 目标

交付真实的 private, server-managed filesystem Workspace 权限边界，并将 Slice 5 的 Workspace-less 对话壳替换为 Balanced Workspace Employee Experience。Employee 在 Conversation 前选择 Workspace/Working Root；Run 固定 Workspace Revision 并只在隔离 Sandbox 内通过 Workspace Change Set 操作文件。

### 交付

- 新增 `packages/workspaces` 深 Module 与唯一 PostgreSQL/Content Storage 写路径
- empty/Git Workspace provisioning、一个 Repository、多 Worktree、archive/delete 生命周期
- Workspace Revision、`.cmasterignore`、受治理 list/search/read 与可跨 Worker恢复的 Sandbox
- Observe/Edit with Confirmation/Trusted Automation 与所有写入统一 Change Set
- Conversation/Run/Agent/Artifact/Pending 的 Workspace/Working Root scope
- Apply/Commit/Push/PR/Merge 分离和 unknown external effect 恢复
- `/workspaces/{workspaceId}/worktrees/{worktreeId}/...` versioned Contract/route
- AI Elements + shadcn/ui + Tailwind + Lucide 的 Balanced Workspace Employee Experience
- 完整替换后删除旧 `/workspace/*` UI、旧 Employee Workspace Flag 和被替代写路径

### 验收/退出

- 空 Workspace 与 deterministic Git remote 均完成 provision、多个 Worktree、多 Conversation 与 restart recovery
- Run 只读取固定 Revision 和一个 Working Root；host path、symlink、hook、subprocess 与 network escape 被拒绝
- Change Set 批准前不写文件；Trusted Automation 仍保留 Change Set；并发 overlap 不盲目覆盖
- Git Apply/Commit/Push/PR/Merge identity 分离；Push uncertain outcome 不盲重试
- Workspace File/Artifact Version、global/local Pending、archive/delete 与 Worktree history 语义完整
- Balanced Workspace 完成 desktop/mobile、i18n/theme、keyboard/Focus/axe 与 bounded long-list gates
- 只有 Workspace-aware 权威写路径保留，不迁移原型数据，不长期双写

## 9. Slice 7 — Production Starter

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

## 10. 第一里程碑完成定义

员工通过内部身份登录，选择私有 Workspace/Working Root，创建 Conversation 和 Run；Worker 使用 AI SDK Engine，经 Policy 与 Tool Runtime 调用受控 Tool，必要时等待审批，生成 Message/Artifact；页面实时展示并可在刷新/断线后恢复；所有操作关联 Organization、Principal、Run、Audit 和 Trace。

## 11. 后续 Slice

优先顺序在第一里程碑真实反馈后重新评估：

1. Agent Revision + Admin Console + Eval 发布门禁
2. Agent Skills & Isolated Provider Management：Agent Skills Parser、Catalog、安装/升级验证、Legacy Skill Adapter/迁移、MCP Adapter、Provider 生命周期，以及文件系统/网络/资源/Credential 隔离；在此之前生产仅运行仓库内审查的 Built-in Tools
3. Memory/Knowledge ingestion、检索和 Context Policy
4. Task/Workflow/Runbook/Schedule/Webhook 统一自动化
5. 企业 Credential Broker Adapter
6. Claude SDK/Codex/Pi 等更多 Agent Engine
7. HA Profile：多 API/Worker、S3/MinIO、Redis Streams/NATS、Kubernetes/OpenShift

## 12. 每个 PR 的 Definition of Done

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

## 13. 主要风险与控制

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

## 14. 暂缓技术选型

ORM/Query Builder、AI SDK 精确版本、向量检索、对象存储、实时 Broker、外部 Policy/Vault、容器平台在对应 Slice 开始时用小型技术 Spike 和 Contract 测试决策，不改变本文领域与 Module 基线。
