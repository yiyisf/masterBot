# 领域数据模型

> 本文描述领域所有权和关系，不等同于最终 PostgreSQL DDL。物理表、索引、ORM 与分区策略在对应 Slice 设计，但不得破坏本文件不变量。

![领域数据模型](./diagrams/data-model.svg)

## 1. 模型分离

同一个概念有三种表示，禁止复用单一 TypeScript 类型贯穿全栈：

- **Domain Model**：业务语义、不变量和状态转换
- **Persistence Model**：表、外键、索引、JSONB 和 Adapter key
- **Contract Model**：HTTP/SSE/UI 的版本化序列化

映射集中在 Module 内或 Transport Adapter；Provider/ORM 类型不得进入 Domain。

## 2. Identity 与所有权

### Organization

所有企业数据、Policy 和管理操作的隔离范围。核心业务记录必须显式拥有 `organizationId`；首版虽为单 Organization 部署，也不省略该字段。

### Principal

认证后的 Employee 或 Service Principal。Run 保存 initiating Principal；自动化不能伪造 Employee Message。

### Delegation

Invocation 保存执行 Agent 和父 Invocation；有效权限由 Principal 权限、Agent Grant、Policy 和 Invocation 限制取交集，子级不能扩权。

## 3. Filesystem Workspace

```text
Employee Principal 1 ── * Workspace
Workspace 0..1 ── 1 Repository Binding
Workspace 1 ── * Working Root
Git Working Root 1 ── 1 Git Worktree
Working Root 1 ── * Workspace Revision
Workspace Revision 1 ── * Workspace File state
Workspace Revision 1 ── * proposed Workspace Change Set
Workspace 1 ── * Conversation
Workspace 1 ── * Artifact
```

- Workspace 由一个 Employee Principal 私有拥有且不可跨 Principal 分享；Organization scope 仍显式保存。Workspace 状态至少区分 `provisioning | ready | failed | archived | deleting`。
- Workspace 来源为 `empty | git`。Git 来源最多一个 Repository Binding；它保存受信任 Connector/Credential reference、remote identity 和默认 Branch，不保存 Credential 或 Browser 提交的 Server path。
- 空 Workspace 有一个 stable default Working Root；Git Workspace 可有多个 Worktree。Conversation 固定一个 Working Root，Run 不跨 Root。
- Workspace Revision 是一个 Working Root 的一致不可变状态 identity，不等于 Git Commit。Workspace File content 存共享持久 Workspace Content Storage；PostgreSQL 保存 owner、路径、media/size/hash、Revision 关系和 Adapter opaque reference。
- Change Set 固定 source Run、Working Root、base Revision、request hash、文件 create/modify/move/delete entries、Approval reference 与 `proposed | approved | rejected | applying | applied | conflicted | failed` 状态。调整创建新 Change Set，不修改旧 Subject。
- Apply 以 current Revision 比较 base；确定性证明不重叠时可重放到新 base，重叠或未知时进入 conflict。成功应用原子产生一个新 Revision 和 receipt。
- Workspace Operation Mode 为 `observe | edit_with_confirmation | trusted_automation`。Run 保存启动时最大模式；当前 Workspace/Policy 收缩可立即限制后续 Tool Call，提升不改变现有 Run。
- Archive 可恢复且禁止新工作；Delete 受 active Run、dirty Worktree、未解决 Change Set 和 Retention 约束，不自动修改 Git Remote。

## 4. Conversation 与执行

### Conversation / Message

```text
Workspace 1 ── * Conversation
Working Root 1 ── * Conversation
Conversation 1 ── * Message
```

- Message 是员工可见内容的不可变事实。
- Conversation 固定 `workspaceId + workingRootId` 并继承 Workspace owner 私有边界；不存在 Membership 或跨 Principal共享授权。scope 不匹配、跨 Principal 与不存在使用相同 not-found 语义。
- Conversation 可包含多次 Run 的输入与输出。
- Employee 外部输入仍只有 Text Part；Slice 4 的 Assistant Message 可包含 Text Part 和指向确切 Artifact Version 的 Artifact Reference Part，旧 Message 不随 Artifact 新版本变化。
- 后一次 Run 的 Context Manifest 引用历史 Message ID，不复制 Message 内容到 Run；Message Trigger 的 sequence 是该 Run 可见历史的固定上界。
- Slice 5 的 Conversation title 在首条 Employee Message 后确定性初始化一次并可显式重命名；它不是 Context Summary。Conversation list preview 是查询派生值，不单独持久化；archive/delete/read receipt 不进入首版状态模型。

### Run / Trigger

Run 是一次被 Principal 授权的工作尝试。Trigger 是带类型的来源：

```text
message | task | webhook | schedule | api | parent_run
```

`conversationId` 可空；Message Trigger 时必须存在并属于同一 Organization 且 initiating Principal 必须可访问对应 Conversation。同一 Message 可以触发多个明确的 Run attempts；网络恢复以相同 Command ID 收敛到原 Run，只有新的 Employee 意图才创建新 attempt。

建议持久化字段组：

```text
Run
├── id / organizationId / initiatingPrincipalId
├── status / triggerType / triggerRef
├── conversationId?
├── workspaceId? / workingRootId? / baseWorkspaceRevisionId?
├── maxWorkspaceOperationMode?
├── agentId / agentRevisionId
├── resolvedEngineProfileId / resolvedModelProfileId
├── resolvedPolicyRevisionIds
├── startedAt / completedAt / failure
└── lastSequence / currentCheckpointId? / contextManifestId?
```

Slice 2 的 Run 状态为：

```text
accepted | queued | running | succeeded | failed | cancelled
```

Slice 3 增加非终态 `waiting`；等待原因由 active Interrupt 表达，Invocation 状态为 `interrupted`，等待期间不持有 Worker Lease。`invocation.output_ready` 是当前 Run 的取消边界：取消事务先提交时后续输出被丢弃；输出先持久化时取消返回 `run_cancellation_too_late`，并继续幂等交付最终 Assistant Message。Tool Provider in-flight 期间 cancellation 暂时返回 409，Tool boundary 完成后恢复可取消。不引入 `cancelling` 或 `completing` 状态。

### Invocation

```text
Run 1 ── * Invocation
Invocation 0..1 parent ── * child Invocation
```

Invocation 是一个 Agent 在 Run 内的参与。它固定 Agent Revision、Engine Adapter/version 和可选 Engine Session reference；Engine Session 不充当 Run ID。

### ModelCall / ToolCall

一个 Invocation 可产生多次 ModelCall 和 ToolCall。

模型输出的是无执行权限的 Model Tool Request；只有 Tool Runtime 校验、授权并持久接受后才成为 ToolCall。ToolCall 是恢复 Ledger，至少记录：

```text
id / invocationId / capabilityId / toolRevisionId
status / idempotencyKey / effect / recovery / risk annotations
requestHash / private bounded requestPayload / safe requestSummary
dispatchAttempts / externalOperationId?
private bounded outcomePayload / safe outcomeSummary / uncertainty
approvalId? / startedAt / completedAt
```

一个 ToolCall 可以有多个带有限 Lease 的 Dispatch Attempt，但 request、Tool Revision 和 idempotency key 不变。Attempt Lease 到期后，`retry_same_call`/`idempotency_key` 可建立 fenced 重试 Attempt，`reconcile` 只能建立查询外部状态的 Attempt；迟到结果不能覆盖新 Attempt。未知非幂等或 reconciliation 无法确认的副作用使用 `requires_review`，不得自动假定成功或失败；Employee 只能带着不确定性继续或取消 Run，不能改写审计事实或直接重试原 ToolCall。

## 5. Event、Checkpoint 与一致性

### RunEvent

```text
runId + sequence  唯一且单调递增
```

Event 信封包含 `eventId/schemaVersion/type/timestamp/payload/causationId/correlationId`。历史 Event append-only，通过 upcaster 读取旧版本。

### OutputDelta

高频生成内容是独立 Streaming 模型，可按批聚合；最终 Message/Artifact 是权威输出。除非策略要求，不逐 token 永久保留。

### Checkpoint

Checkpoint 保存安全恢复所需 Working State、Engine Adapter/version、Context Manifest reference 和已完成副作用边界。Slice 3 在 Tool 完成、创建 Interrupt 前和 Confirmation 解决后的安全点保存 Provider-neutral transcript、已完成 ToolCall ID、剩余 Model Tool Request、执行计数和 output generation；恢复不得重新生成已确认请求或重复已完成 ToolCall。Slice 4 后，Manifest 是基础 Invocation Context 的唯一恢复入口；Checkpoint 只保存 `contextManifestId` 与 Invocation 开始后的模型/Tool 增量，不复制 Manifest 引用的 Message 或 Artifact 内容。`output_ready` 同时固定最终 Text 和按完成顺序去重的 Artifact References。

### ContextManifest / ContextSummary

ContextManifest 是一次 Invocation 实际 Context 选择的不可变、Organization-scoped 记录，`(organizationId, invocationId)` 唯一。Workspace File 来源同时固定 Workspace/Working Root/Revision/path。Manifest 保存 Trigger Message sequence、Context Policy version、预算/估算用量，以及有序来源项的 source ID/sequence、content hash、分类与 `verbatim | summary` 纳入方式；不复制 Message、Workspace File 或 Artifact 正文。

ContextSummary 是对一个明确连续来源区间的有损派生内容。首版使用固定的 Employee Goal、Explicit Constraints、Established Facts、Decisions and Commitments、Relevant Artifacts、Unresolved Items 结构；它不是 Message、Memory 或 Knowledge，也不能提升来源内容的指令权限。恢复通过 Manifest 重新读取权威来源并校验 hash；已完成 Manifest 不重新选择或摘要。

### UI Projection

Slice 5 的 Run UI Projection Snapshot 与 sequence stream 是从 Run 状态、Interrupt 和 Run Event 派生的 Presentation Model，不是新的业务事实。首版按需构造并对 Timeline 分页，不增加物化 Projection 表；Assistant Draft 只包含当前 output generation，最终 Assistant Message 仍是 Conversation 权威事实。

### Outbox 与状态表

当前状态表是查询权威；RunEvent 是时间线权威。应用事务同时写状态、Event 和 Outbox，不采用完整 Event Sourcing。Context/Execution 和 Artifact/Tools 的跨 Module 提交不使用分布式事务，分别以稳定 invocationId 与 sourceToolCallId 幂等收敛。

## 6. Agent、Model 与 Policy 版本

### Agent / AgentRevision

```text
Agent 1 ── * AgentRevision
Agent.activeRevisionId → published AgentRevision
```

Published Revision 不可修改，保存 instructions、capability requirement、Tool Grant、Context/Execution/Outcome Policy reference。Credential 和运行状态不进入 Revision。

### ModelProfile / ModelCall

Organization 批准的 ModelProfile 描述 Provider reference、能力、成本级别和数据策略。Slice 2 每个 Organization 恰有一个 active Primary 和至多一个 active Fallback；Profile ID 代表不可变配置，Credential 只保存 opaque `credentialRef`。

ModelCall 保存每次实际尝试的 Profile、route role、attempt number、purpose、是否产生输出、安全失败分类、usage 和 trace/span ID，不只保存“默认模型”。Slice 4 的 purpose 至少区分 `agent_execution | context_summary`。Models 拥有这些记录；Execution 只在 Run 保存最终解析的 Profile/display name、Fallback 标记和 usage 快照。为保持 Module 所有权，ModelCall 的 Run/Invocation ID 是相关标识而非跨 Module 外键。

Slice 4 使用新 Profile ID 固定 `contextWindowTokens` 与 `maxOutputTokens`，不修改已使用 Profile。有效输入预算取 Context Policy、Primary 及可用 Fallback 中最严格的限制，并扣除输出及安全余量；AI SDK Adapter 实际施加 max output，不只在 Context Builder 中预留。

### PolicyRevision / Approval

Decision 保存实际 Policy Revision 与 obligation。Run 固定关键 Revision 以支持审计；ToolRuntime 每次调用仍重新评估动态条件。Slice 3 的 Approval 绑定不可变 ToolCall Subject，由 initiating Employee 一次性确认或拒绝；Confirmation 不冻结授权，恢复时重新检查 Principal Entitlement、Agent Grant、Invocation restriction 和 Policy 后才可签发 Credential Lease。Approval 属于 Governance，Execution Interrupt 只保存相关 Approval ID，不建立跨 Module FK。

### EvalSuite / EvalEvidence

Evidence 固定 Suite、Case、Candidate Revision、Model/Tool/Policy/Data set 与 evaluator 版本，支持发布门禁和 Canary 对比。

## 7. Tool、Skill 与 Connector

```text
ToolProvider 1 ── * Tool
Skill * ── * required Tool
Connector 1 ── * contributed Tool
```

- Tool Capability ID 与 major Contract 稳定，不包含 Provider 实现细节；不可变 Tool Revision 保存具体 Provider binding 与 effect/recovery/risk。
- Tool Grant 与不可变 Agent Revision 显式绑定并指向 Capability major；Invocation 解析并固定实际 Revision，兼容实现修复不要求重发 Agent Revision。
- Skill Revision 保存标准 Agent Skills 内容、资源引用和 Tool requirement；Skill 不拥有 Tool 执行代码。
- Connector 保存系统配置和 `credentialRef`，不保存领域可见明文 Secret。
- Slice 3 不建设本地逐 Principal/逐 Tool RBAC；Principal Entitlement 来自可信 Identity/Policy 输入。

## 8. Artifact

```text
Artifact 1 ── * ArtifactVersion
ArtifactVersion * ── 1 ArtifactContent
```

Artifact 保存 `workspaceId`、种类、标题、访问 Policy、`createdForPrincipalId` 和当前版本；Version 保存 provenance、`createdByInvocationId/sourceToolCallId`、可选 source Working Root/Workspace Revision/path 与 `contentId`；Content 保存 Organization、storage adapter、opaque key、SHA-256、media type、size 和状态。Artifact 随 Workspace 存续而不随 source Worktree 删除；跨 Workspace copy 创建新 Artifact identity。

- Version 不可原地覆盖；Message 固定引用确切 Version，而不是可变化的 current version。
- `(organizationId, sourceToolCallId)` 唯一并关联 request hash；同一 ToolCall 恢复返回原 Artifact，不同内容产生幂等冲突。
- 多个 Version 可引用同一 Content；Slice 4 在同 Organization、相同 bytes 与 media type 时复用 Content/Blob，跨 Organization 去重不定义为 Contract。
- Slice 4 数据库只提交已正式可用 Content：staging → check/hash → atomic promote 完成后，ArtifactContent/Artifact/Version 在同一事务提交。
- Storage migration 只改变 Content location，不改变 Artifact/Version identity。
- Blob 在无引用后由 GC 延迟清理；quarantine、derivative、trash 和完整 GC 在有上传、预览、删除调用者后实现。

## 9. Task 与 Workflow

```text
Workflow 1 ── * WorkflowRevision
WorkflowRevision 1 ── * WorkflowExecution
WorkflowExecution 1 ── * Task
Task * ── * dependency Task
Task 1 ── * attempt Run
```

Plan 不是持久 Task。Schedule/Webhook 只产生 Trigger。Runbook 是带风险、审批、证据和补偿要求的 Workflow Revision，不使用第二套引擎。

## 10. 推荐 Schema 所有权

| Module | 代表性表/集合 |
|---|---|
| identity | organizations, principals, external_identities, sessions |
| workspaces | workspaces, repository_bindings, workspace_roots, git_worktrees, workspace_revisions, workspace_file_entries, workspace_change_sets, workspace_change_entries, workspace_operation_receipts |
| conversations | conversations, messages |
| execution | runs, invocations, run_events, checkpoints, interrupts, run_dispatch, outbox |
| agents | agents, agent_revisions, agent_drafts, eval_suites, eval_evidence |
| models | model_profiles, model_calls, model_usage |
| tools | tools, tool_providers, tool_calls, tool_grants, connectors, skills, skill_revisions |
| context | context_manifests, context_manifest_items, context_summaries, memories, knowledge_sources/references |
| artifacts | artifacts, artifact_versions, artifact_contents, derivatives |
| automation | tasks, task_dependencies, workflows, workflow_revisions, workflow_executions, schedules |
| governance | policy_revisions, approvals, audit_records, credential_references |

表名只是建议；关键约束是所有权。跨 Module 查询通过 Interface 或专用 Projection，不直接 JOIN 私有表。

首个模块化单体使用同一 PostgreSQL `public` Schema，不按 Module 拆分 Schema 或数据库 Role。Migration 和 Repository 留在所属 Package；同 Module 建立完整 FK，跨 Module FK 只沿单向依赖建立。只有真实权限隔离或独立部署需求出现后，才重新评估多 Schema。

## 11. 索引与保留基线

必须支持的访问路径：

- Organization + Principal 的 Workspace list 与 lifecycle status
- Workspace + Working Root 的 Conversation 最近列表
- Working Root current Revision、Change Set status/base Revision 与 file path
- Repository Binding provisioning、Worktree Branch/status 与 cleanup eligibility
- Run by ID、status、Trigger、created time
- RunEvent by `(run_id, sequence)`
- Worker 可租约的 pending Run 与 lease expiry
- Invocation parent tree
- ToolCall uncertainty/idempotency lookup
- Artifact by Organization/kind/created time
- Task readiness 和 Workflow Execution status

Run Event 默认保留 90 天、Audit 默认 1 年；清理流程必须尊重 Legal Hold、Artifact 引用和 Organization Policy。
