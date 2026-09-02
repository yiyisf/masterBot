# Governed Tool Runtime Slice

Slice 3 在 AI SDK Runtime 后增加受治理的顺序 Tool Loop。详细设计见 `docs/design/slice-3-governed-tool-runtime.html`。

## 启用

除 Slice 2 的 Model 配置外，设置：

```text
CMASTER_TOOL_RUNTIME_ENABLED=true
# 可选；逗号分隔 hostname，不含 scheme/path/port。空值使 HTTPS fetch 无法访问任何 host。
CMASTER_HTTP_FETCH_ALLOWED_HOSTS=docs.example.internal
```

Feature Flag 默认关闭。当前只装配三个由 #103 跟踪替换的 workflow-validation Built-in Tools：UTC time、text statistics 和 allowlisted HTTPS GET。HTTPS Tool 不发送自定义 Header/Credential、不跟随 redirect，并限制响应大小。

## 执行与恢复

- Model Gateway 只在 ModelCall 成功、usage 已持久化后发布 Model Tool Request。
- Agent Engine 按模型返回顺序执行，最多 5 个 Model Step、8 个 ToolCall。
- Catalog active Revision、Agent Grant、Principal entitlement 和固定 Policy 共同决定可见及可执行集合；模型虚构名称不会进入 Tool Runtime。
- ToolCall/Dispatch Attempt Ledger 和稳定 idempotency key 在 Provider I/O 前持久化。
- Employee Confirmation 产生持久 Approval、Checkpoint 和 `tool_confirmation` Interrupt。确认后二次授权并签发短期 Credential Lease；拒绝作为 denied Tool Outcome 返回模型。
- 未知非幂等效果产生 `tool_outcome_review`；继续不会重试原 ToolCall。
- Checkpoint 恢复复用已持久化 ToolCall，不重新生成已确认请求。Tool input/output 的权威记录仍在 Tools Module。
- Provider 调用期间，Run cancellation 临时返回 `tool_effect_in_flight` 409；Tool boundary 结束后恢复可取消。

Credential Lease 仅存在于 Server/Provider Adapter 内存，不写数据库、Run Event、日志或 Browser Contract。Development Broker 为无凭据 Built-in Tool 签发空值、短期、operation-scoped Lease；企业 Vault Adapter 不属于本 Slice。

## Provider Host fixture

`DevelopmentProviderHostFixture` 是固定协议、不可配置且禁止 production 构造的 child-process fixture，用于验证 Provider 崩溃不会退出 API/Worker。它不是生产扩展安装或沙箱系统；Skills、MCP 和 Provider 管理均不在本 Slice。

## 验证

```bash
npm run next:check
npm run next:test:integration
```

Integration tests 覆盖确认刷新/恢复、拒绝、未知副作用 review、Credential Lease 时序、Provider crash isolation、ToolCall 不重复、取消边界和 PostgreSQL fencing。
