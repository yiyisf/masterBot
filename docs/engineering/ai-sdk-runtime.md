# AI SDK Runtime Slice

Slice 2 在 Slice 1 的 Run Walking Skeleton 后接入真实模型，同时保持 Execution Harness、Model Gateway、Agent Engine 和 UI Presenter 为独立 seam。

## 交付范围

- `@cmaster/models` 拥有 `model_profiles`、`model_calls`、Provider Adapter、usage、受控 Fallback 和 GenAI Trace。
- `AiSdkAgentEngine` 只执行一次文本模型调用；Tool Loop、Context Builder 和历史消息留给后续 Slice。
- Agent Revision 固定 `engineKind/engineVersion/modelRequirement`；Feature Flag 只决定新的 Run 解析到 Echo 还是 AI SDK Revision。
- Execution 把 Provider token 聚合为 `output_started/delta/reset/completed` Run Events；最终 Assistant Message 仍是完成输出的权威事实。
- `/api/v1/runs/{runId}/ui-stream` 只把 canonical Run Events 表示为 AI SDK UI Message Stream，不执行模型、不写状态。

## 启用

必须同时设置：

```text
NEXT_ARCHITECTURE_ENABLED=true
CMASTER_DEVELOPMENT_IDENTITY_ENABLED=true
CMASTER_AI_SDK_RUNTIME_ENABLED=true
CMASTER_PRIMARY_MODEL_BASE_URL=https://provider.example/v1
CMASTER_PRIMARY_MODEL_ID=model-id
CMASTER_PRIMARY_MODEL_API_KEY=secret
```

Fallback 的 Base URL、Model ID、API Key 必须全部设置或全部省略。Slice 2 在尚无 Policy Engine 时要求 Primary/Fallback 的 data handling 与 cost tier 完全一致，后续由 Policy Module 替代此保守规则。数据库只保存 `credentialRef`；明文 API Key 只存在于 Server 进程环境和 Adapter 调用参数。

## Fallback 与恢复

Primary 只在 rate limit、timeout、Provider unavailable、connection failure 或 stream interruption 等可重试分类下进入唯一 Fallback。认证、无效请求、上下文超限、安全拒绝、不支持能力和预算失败禁止 Fallback。

若 Primary 已输出部分文本：

1. ModelCall 标记 `discarded`；
2. 持久化 `model.output_discarded`；
3. 持久化 `invocation.output_reset` 并推进 generation；
4. 从原始 Employee Text Message 重新调用 Fallback；
5. 永不拼接两个 Profile 的输出。

若最终 Model failure 已产生部分文本，也以 `failure` reason 持久化 discard/reset，再结束 Run；失败 Run 不保留可误认为最终答案的流式草稿，也不创建 Assistant Message。

Worker Lease 到期后，新 Worker 对已持久化的部分输出执行同样的 generation reset。遗留 `running` ModelCall 被归一化为 `stream_interrupted`，新的 attempt number 单调递增。`output_ready` 之后只恢复 Assistant Message 的幂等交付，不再次调用模型。

## 数据与遥测安全

Run Event 和 Browser Contract 只暴露安全的 Profile ID/display name、Fallback 标记、usage 和归一化失败。Model span 记录 Run/Invocation/Profile 标识、Provider、模型、usage、结果和 Trace IDs；不记录 Prompt、生成内容、API Key、credentialRef 或 Provider 原始异常。未安装/配置 OTel SDK 时使用 API no-op Provider，不改变执行语义。

## 验证

- `npm run next:test`：Contract、Presenter、Adapter 分类和 reducer Unit tests。
- `npm run next:test:integration`：Fake Model 的 Fallback、拒绝、ModelCall、Trace、Lease crash recovery Regression Eval。
- `npm run next:eval:model-smoke`：有显式真实凭据时执行一次付费 Provider Adapter smoke；无凭据时跳过。

## Dependency audit

Slice 2 安装后 `npm audit` 报告 `1 low / 14 moderate / 25 high / 1 critical`。新增的 `ai@7.0.84`、`@ai-sdk/openai@4.0.51` 和 OTel `2.10.0` 安装节点没有未修复 advisory；名为 `@opentelemetry/sdk-trace-base` 的告警来自 Legacy 根依赖的 `1.30.1` 节点。Critical 是仅开发使用的 `vitest@4.0.18` UI Server advisory，本仓库 CI 只运行不监听网络的 `vitest run`。Fastify/Next 等既有 runtime advisory 需要按 ADR-0035 建立独立 verified-upgrade Slice，不在 AI Runtime 变更中混入未经验证的框架升级。
