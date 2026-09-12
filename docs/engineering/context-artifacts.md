# Context & Artifacts Slice

Slice 4 在 Governed Tool Runtime 后建立可审计 Context 与可复用 Text/Markdown Artifact。规范性决策见 `docs/design/slice-4-context-artifacts.html`。

## 主流程

1. Employee 在已有 Conversation 中追加第二个 Trigger Message 并创建 Run。
2. Worker 领取 Run 后，Harness 以 Trigger Message sequence 为上界调用 Context Builder。
3. Context Builder 在固定预算内保留 Trigger、最近完整 Turn 和其可读 Text/Markdown Artifact；较早连续历史按需生成 Context Summary，提交不可变 Manifest。
4. Agent Engine 消费 Engine-neutral Invocation Context，经 Governed Tool Runtime 调用 `cmaster.artifact.create_text`。
5. Artifacts Module 以 `sourceToolCallId` 幂等写入 Blob、Artifact/Version/Content metadata。
6. Harness 将成功 ToolOutcome 的 Artifact Reference 确定性附加到最终 Assistant Message。
7. Browser 通过受权 REST 读取 metadata、完整内容或单一 byte Range，并由 Renderer Registry 展示。

## Feature Flag 与配置

```text
CMASTER_CONTEXT_ARTIFACTS_ENABLED=false
CMASTER_DEV_CONTEXT_ARTIFACT_AGENT_REVISION_ID=<new immutable revision ID>
CMASTER_CONTEXT_PRIMARY_MODEL_PROFILE_ID=<new immutable profile ID>
CMASTER_CONTEXT_FALLBACK_MODEL_PROFILE_ID=<new immutable fallback profile ID>
CMASTER_ARTIFACT_STORAGE_ROOT=data/artifacts
CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS=<required when enabled>
CMASTER_PRIMARY_MODEL_MAX_OUTPUT_TOKENS=16384
CMASTER_FALLBACK_MODEL_CONTEXT_WINDOW_TOKENS=<required when fallback is configured>
CMASTER_FALLBACK_MODEL_MAX_OUTPUT_TOKENS=16384
```

Slice Flag 依赖 Next Architecture、AI SDK Runtime 与 Tool Runtime。开启时解析新的不可变 Development Agent Revision 和带 context window/max output 的新 Model Profile IDs；关闭时保持 Slice 3 路径。API/Worker 分角色运行时必须共享同一 Artifact storage root。

## Context 规则

- Conversation 保存完整事实，不摘要、不按 token 选择。
- Run 只看到 `sequence <= triggerMessage.sequence` 的历史；后续 Message 属于后续 Run。
- 有效输入预算取 Context Policy、Primary/Fallback Model Profile 的最严格限制，并扣除实际施加的 max output 与安全余量。
- 首版 token 估算使用 UTF-8 bytes、消息结构开销和固定安全余量，Manifest 明示为 estimate。
- 固定优先级：Agent instructions/Tool contracts、完整 Trigger、最近完整 Turn 及可读 Text/Markdown Artifact、较早连续历史 Summary。
- Context Summary 使用 Employee Goal、Explicit Constraints、Established Facts、Decisions and Commitments、Relevant Artifacts、Unresolved Items；它是低信任派生资料，不是 Message、Memory、Knowledge 或指令。
- `(organizationId, invocationId)` 唯一。Manifest 已完成时恢复只重新物化并校验 source hash，不重新选择或摘要。
- Manifest 只保存引用、hash、provenance、纳入方式和预算；Message/Artifact 正文留在权威 Module。
- Checkpoint 保存 `contextManifestId` 和 Invocation 开始后的执行增量，不复制基础 Context。

摘要通过 Models Module，禁用 Tool，并以 `purpose=context_summary` 记录 Profile 与 usage。首版复用 Run 的 Primary/受限 Fallback。极端历史若连一次摘要调用也无法容纳则明确失败；不静默丢弃。

## Artifact 规则

`cmaster.artifact.create_text` 输入：

```ts
{
  title: string; // <= 200 characters
  format: 'plain_text' | 'markdown';
  content: string; // UTF-8, <= 48 KiB
}
```

Server 从 format 推导 media type。Capability 是低风险 `idempotent_write`，仍经过 Entitlement、Agent Grant、Policy、Ledger 和校验，但 baseline Policy 不要求 Employee Confirmation。Provider Adapter 位于 Artifacts Module；Server 只组合。

写入顺序：

```text
exclusive staging write
→ UTF-8/size/media-type check
→ SHA-256
→ atomic promote to blobs/sha256/{aa}/{bb}/{hash}
→ ArtifactContent + Artifact + Version transaction
```

数据库只记录可用 Content。同 Organization、相同 bytes/media type 复用 Content/Blob。`(organizationId, sourceToolCallId)` 与 request hash 保证 Provider 返回前崩溃后不重复创建。Version 不覆盖；Message/ToolOutcome/Event 固定 `artifactId + artifactVersionId`。

Artifact 默认由 initiating Principal 私有。metadata、完整内容和 Range read 使用相同 Organization/Principal 检查。Browser 不提供创建、更新、删除接口。

## HTTP 与 UI

读取面提供：

- creator-private Artifact Library，使用稳定 opaque cursor，并在 summary 固定 current Artifact Version ID；
- 有界的不可变 Version metadata 分页与指定 Version metadata；
- 指定 Version 完整内容；
- 单一 `bytes=start-end | start- | -suffix` Range；
- `disposition=attachment` 下载，由 Server 生成安全文件名和媒体扩展名。

合法 Range 返回 206；非法、越界或多区间返回 416。成功内容响应设置 `nosniff`；下载和预览保持相同的单 Range 语义。Contract 不暴露 content hash、storage key 或 path，Browser 不能提交文件名。

Slice 5 的 Message Artifact Card 只读取有界 metadata。确切 Version 页面在 Employee 主动操作后读取正文；仅 UTF-8 Text/Markdown 可内联，其他类型使用本地化 metadata/download fallback。Markdown 禁止原始 HTML、脚本、远程图片、危险 scheme 和不安全的外链行为。

## 安全事件与失败

新增安全 Run Events：

- `invocation.context_built`：Manifest ID、计数、是否摘要、估算 token、Policy version；
- `artifact.created`：Invocation/ToolCall/Artifact/Version ID、kind、media type。

事件、普通日志和 Trace 不记录 Prompt、Summary/Artifact 正文、content hash、Tool input、Provider raw error 或 storage key。Manifest/Summary 正文不开放 Browser REST。

Run 新增安全失败码：

- `context_input_too_large`：不可省略输入已经超预算，non-retryable；
- `context_build_failed`：来源、摘要、hash 或持久化构建失败，retryability 由内部分类决定。

## 明确延期

- quarantine、derivatives、trash、删除和完整 GC；
- 上传、二进制、PDF/Office/图片、分块/流式 Artifact 创建；
- 多区间 Range、共享访问和管理员读取；
- 语义检索、递归/分块/滚动摘要、Provider-side compaction、精确 tokenizer；
- 执行中 Tool Result 压缩；
- Coding Agent Summary Profile。未来该 Profile 可参考 Pi 的 Goal/Progress/Key Decisions/Next Steps/Critical Context 和文件操作追踪，但不改变通用 Summary。

## 验证

```bash
npm run next:check
npm run next:test:integration
```

核心测试面：Context Contract、Manifest 崩溃恢复、Artifact Module Contract、Storage Adapter、Artifact Tool/Worker 恢复、HTTP 权限/Range 与 Renderer fallback。真实付费摘要/Agent Smoke 继续显式启用且默认跳过。
