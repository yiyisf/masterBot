# Module 接口清单

> 本文定义 Seam 和调用者必须知道的 Interface；代码签名是目标形状，不是要求逐字实现。接口还包括不变量、顺序、错误和性能约束。

## 1. Workspace 与依赖规则

```text
apps/server             API/Worker/all 组合根
apps/web                Web 组合根
packages/contracts      外部版本化 DTO/Event
packages/kernel         极少量 ID/Clock/Result 原语
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

每个业务 Module 只从其 package root 导出公开 Interface。Adapter 与持久化映射留在所属 Module 内；禁止 deep import、跨表读取和共享可变实体。

## 2. Identity

**拥有**：Organization、Principal、Employee、Service Principal、外部身份映射与 Session。

```ts
interface IdentityModule {
  resolveSession(session: SessionCredential): Promise<RequestIdentity>;
  getPrincipal(query: GetPrincipal): Promise<PrincipalView>;
  revokeSession(command: RevokeSession): Promise<void>;
}
```

- `RequestIdentity` 只能由可信 Adapter 创建。
- OIDC、开发身份和未来 SCIM 是 Adapter。
- 不负责 Tool/Artifact/Agent 授权；授权属于 Governance。

## 3. Conversations

**拥有**：Conversation、Message 和员工可见历史。

```ts
interface ConversationModule {
  create(command: CreateConversation): Promise<Conversation>;
  append(command: AppendMessage): Promise<Message>;
  get(query: GetConversation): Promise<ConversationView>;
  list(query: ListConversations): Promise<Page<ConversationSummary>>;
}
```

- Message 追加后不可修改；修订通过新 Message 或显式元数据表达。
- Run 只引用 Message，不由 Conversation Module 执行。
- Context Builder 通过受控读接口获取历史，不能直查表。
- Slice 1 的 Browser Command 明确拆分为创建 Conversation、追加 Employee Message、以 Message Trigger 创建 Run；不提供重新耦合三者的 `/chat` Command。
- Message 使用 Conversation 内严格递增 sequence；外部暂只接受一个 Provider-neutral Text Part。

## 4. Execution

**拥有**：Run、Trigger、Invocation、Run Event、Checkpoint、Interrupt、Dispatcher 状态和 Harness。

```ts
interface RunCoordinator {
  start(command: StartRun): Promise<RunHandle>;
  resume(command: ResumeRun): Promise<RunHandle>;
  respond(command: RespondToInterrupt): Promise<void>;
  cancel(command: CancelRun): Promise<void>;
}

interface RunHandle {
  runId: RunId;
  result: Promise<RunResult>;
}

interface RunQueries {
  get(query: GetRun): Promise<RunView>;
  events(query: ReadRunEvents): AsyncIterable<RunEvent>;
}
```

- Run start 在返回前必须持久化接受事实和 Dispatch/Outbox。
- Run Event 按 Run 严格 sequence，传输为 at-least-once。
- Harness 只通过 Agent Engine、Tool Runtime、Context Builder、Policy、Artifact 等公开 Interface 协作。
- Checkpoint 只在声明的安全点产生；不兼容 Engine version 必须显式失败或迁移。

Slice 2 使用 `accepted | queued | running | succeeded | failed | cancelled`；Slice 3 增加非终态 `waiting`，具体原因由持久化 Interrupt 表达，Invocation 等待时为 `interrupted` 且不持有 Worker Lease。`output_ready` 是取消边界：若取消先提交则丢弃后续 Engine 输出；若输出先提交则取消太晚，继续幂等追加 Assistant Message。Tool Provider in-flight 期间暂时不可取消，Tool boundary 持久化后恢复可取消，不引入 `cancelling/completing`。Slice 2 在此 Interface 内增加按 generation 排序的聚合 output events；Slice 3 在 Tool/Interrupt 安全点写 Engine-neutral Checkpoint，Lease 恢复不得重复已完成 ToolCall。

### Agent Engine Port

```ts
interface AgentEngine {
  readonly kind: EngineKind;
  capabilities(): EngineCapabilities;
  execute(input: EngineInvocation): AsyncIterable<EngineEvent>;
  resume?(input: ResumeEngineInvocation): AsyncIterable<EngineEvent>;
}
```

AI SDK 是默认 Adapter；Claude SDK、Codex、Pi 等是可选 Adapter。Engine Session 只存在于 Adapter 状态。

## 5. Agents

**拥有**：Agent 稳定身份、Draft、不可变 Agent Revision、发布/激活和 Eval Evidence 关联。

```ts
interface AgentModule {
  create(command: CreateAgent): Promise<Agent>;
  saveDraft(command: SaveAgentDraft): Promise<AgentDraft>;
  publish(command: PublishAgentRevision): Promise<AgentRevision>;
  activate(command: ActivateAgentRevision): Promise<void>;
  resolve(query: ResolveAgent): Promise<ResolvedAgentRevision>;
}
```

- Published Revision 不可修改；回滚是激活旧 Revision。
- Revision 声明能力和 Policy 引用，不持有 Credential 或运行状态。
- Run 固定实际使用的 Agent/Engine/Model/Policy 版本。

## 6. Models

**拥有**：Model Profile、Catalog、能力、路由、Gateway、usage 和 Fallback Policy。

```ts
interface ModelModule {
  select(requirement: ModelRequirement): Promise<ModelSelection>;
  invoke(request: ModelRequest): AsyncIterable<ModelEvent>;
  list(query: ListModelProfiles): Promise<ModelProfile[]>;
}
```

- 调用者请求能力而非散落判断 Provider 名称。
- AI SDK Provider 类型在 Adapter 内终止；Slice 3 只跨 Seam 暴露 Provider-neutral Model Message、Available Tool、Model Tool Request 和 Tool Outcome projection。
- Model Tool Request 只有在完整成功并记录 usage 的 Model Step 后才可交给 Tool Runtime；失败/Fallback 丢弃该 Step 的候选请求。
- Fallback 不能绕过数据分类、安全拒绝或成本上限。
- Managed Engine 自行调用模型时也必须上报统一 ModelCall/usage/trace。
- Slice 2 的 `ModelGateway` 在一次 Invocation 内最多尝试一个 Primary 和一个 Fallback；每次尝试都先持久化 ModelCall，AI SDK `maxRetries` 固定为 `0`。
- Models 拥有 ModelCall，Execution 只保存实际 Profile/usage 快照；两者不跨 Module JOIN，也不建立 `model_calls → runs/invocations` 外键。
- Profile 配置一经该 ID 使用即不可原地修改；Credential 明文不进入 Profile、Contract、Run Event 或 Trace。

## 7. Tools

**拥有**：Tool Capability、不可变 Tool Revision、Skill Descriptor、Tool Provider、Connector、Tool Grant、Tool-call Ledger。

```ts
interface ToolCatalog {
  list(query: ListTools): Promise<ToolDescriptor[]>;
  resolve(toolId: ToolId): Promise<ToolDescriptor>;
}

interface ToolRuntime {
  list(grant: EffectiveToolGrant): Promise<ToolDescriptor[]>;
  invoke(command: InvokeTool): Promise<ToolOutcome>;
}
```

- 模型提出的候选操作是 Model Tool Request；只有 Runtime 校验、授权并持久接受后才成为 ToolCall。
- `ToolOutcome` 是结构化值，Tool 失败不以未分类异常跨 Seam。
- `invoke` 在外部调用前持久化 Ledger 和稳定 idempotency key；一个 ToolCall 可有多个 Dispatch Attempt。
- Agent Revision 授予稳定 Tool Capability major version；Invocation 解析并固定实际 Tool Revision。
- Policy、Employee Confirmation、Credential Lease、输入校验、超时、脱敏与审计由 Runtime 协调执行。
- Slice 3 只消费通用 governed-tool Principal Entitlement，不建设本地逐 Principal/逐 Tool RBAC。
- Tool 安装/Provider 管理不暴露在执行 Interface；Agent Skills/Legacy Parser 与完整隔离 Provider 管理后置到独立 Slice。

## 8. Context

**拥有**：Context Policy、Context Manifest、Invocation Context 构建；Memory/Knowledge 可分别成为内部或后续独立 Module。

```ts
interface ContextBuilder {
  build(request: BuildInvocationContext): Promise<InvocationContext>;
}
```

- 输入来源保留 provenance、scope、content hash 和分类。
- 输出是 Engine-neutral 的有限投影。
- 不拥有 Conversation 存储、Knowledge ingestion、Tool 执行或 Provider 消息格式。

## 9. Artifacts

**拥有**：Artifact、Artifact Version、Artifact Content metadata、访问控制和派生内容。

```ts
interface ArtifactModule {
  create(command: CreateArtifact): Promise<Artifact>;
  createVersion(command: CreateArtifactVersion): Promise<Artifact>;
  open(query: OpenArtifact): Promise<ArtifactContent>;
  list(query: ListArtifacts): Promise<Page<ArtifactSummary>>;
}
```

内部内容存储 Port：

```ts
interface ArtifactContentStore {
  write(input: ContentInput): Promise<StoredContent>;
  read(ref: StorageRef, range?: ByteRange): AsyncIterable<Uint8Array>;
}
```

- Domain/Contract 不暴露路径和 S3 key。
- 写入顺序为 staging → hash/check → atomic promote → metadata commit。
- 删除由引用检查和 GC 完成。

## 10. Governance

**拥有**：Policy/Revision、Decision、Obligation、Approval、Audit 与授权组合。

```ts
interface PolicyModule {
  evaluate(request: PolicyRequest): Promise<PolicyDecision>;
}

interface ApprovalModule {
  request(command: RequestApproval): Promise<Approval>;
  resolve(command: ResolveApproval): Promise<Approval>;
}
```

- 默认拒绝未知 Action/Resource。
- Decision 必须包含 Policy version、safe reason 和 obligation。
- Slice 3 的 Approval 是 initiating Employee 对精确不可变 ToolCall Subject 的一次性确认；拒绝产生 denied ToolOutcome，不直接失败或取消 Run。
- Confirmation 不冻结授权；恢复时重新求权限交集后才可签发 Credential Lease。
- Harness/Tool Runtime 执行 obligation，不解析策略语言。
- OPA/Cedar/内部策略平台是后续 Adapter；细粒度 Principal Entitlement 来自企业 IAM/Policy，而非 CMaster 本地 RBAC。

### Credential Broker Port

```ts
interface CredentialBroker {
  issueLease(request: CredentialLeaseRequest): Promise<CredentialLease>;
  revoke(leaseId: CredentialLeaseId): Promise<void>;
}
```

完整企业实现后置，但 Domain 从一开始只保存 Credential Reference。

## 11. Automation

**拥有**：Task、Task Dependency、Workflow/Revision、Workflow Execution、Runbook、Schedule/Trigger 定义。

```ts
interface AutomationModule {
  createTask(command: CreateTask): Promise<Task>;
  publishWorkflow(command: PublishWorkflow): Promise<WorkflowRevision>;
  execute(command: ExecuteWorkflow): Promise<WorkflowExecution>;
  signal(command: SignalTask): Promise<void>;
}
```

- Plan 属于 Run Working State；显式提升后才成为 Task。
- Workflow Execution 协调 Task，Task 的执行尝试可启动 Run。
- Runbook 复用同一 Workflow Engine；RPA 是 Tool。

## 12. Contracts 与 Presenter

外部 Contract 位于 `packages/contracts`：

```ts
interface StreamEnvelope<T> {
  schemaVersion: number;
  eventId: string;
  runId: string;
  sequence: number;
  type: string;
  timestamp: string;
  data: T;
}
```

- Zod 是运行时 Schema 来源，生成 OpenAPI 和 Typed Client。
- Domain ↔ Contract 映射集中在 API/Presenter Adapter。
- Run Event、Output Delta 和 UI Projection 是不同模型。
- assistant-ui/AI SDK UI/AG-UI 可替换，不改变 Harness 或历史数据。

## 13. Persistence、Messaging 与 Observability Ports

```ts
interface RunDispatcher {
  enqueue(runId: RunId): Promise<void>;
  lease(request: LeaseRequest): Promise<RunLease | null>;
  heartbeat(lease: RunLease): Promise<void>;
}

interface LiveEventBus {
  publish(signal: RunEventSignal): Promise<void>;
  subscribe(runId: RunId): AsyncIterable<RunEventSignal>;
}
```

- PostgreSQL 定义生产事务和并发语义；SQLite 只实现适用的开发 Contract。
- `LISTEN/NOTIFY` 仅是首个 LiveEventBus Adapter，EventStore 才是事实来源。
- OTel 通过 Observability Port 接入，Domain 不导入厂商 SDK。
