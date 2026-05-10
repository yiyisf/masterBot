# masterBot 重构 · Claude Code 实施提示词集

## 用于分阶段交给 Claude Code 执行的工程实战文档

---

**版本**：v1.0
**生成日期**：2026 年 5 月 8 日
**配套方案**：v3.0 最终版 + v3.1 增量补充
**执行工具**：Claude Code（Anthropic 官方 CLI）
**总周期**：约 24 周

---

## ⚠️ 重要约束（每个 Phase 都必须遵守）

### 🔒 分支保护铁律

**本次为重大重构，完成前不得合并进 master/main 分支**。

```
master / main                  ← 永远不直接合并
  │
  └── refactor/v3              ← 重构主分支（汇集所有 Phase 成果）
        │
        ├── refactor/v3/p0-preparation
        ├── refactor/v3/p1-observability
        ├── refactor/v3/p2-hooks-refactor
        └── ...

每个 Phase 完成 → PR 到 refactor/v3
所有 Phase 完成 → 全量集成测试 → 最终一次性合入 master
```

### 📝 通用规则

每个 Phase 的 Claude Code 任务都必须遵守：

1. **保护现有 master**：绝对禁止修改或合并到 master 分支
2. **每个 Phase 独立分支**：从 refactor/v3 拉新分支 `refactor/v3/p<N>-<name>`
3. **小步提交**：每个有意义改动单独 commit
4. **测试先行**：新功能必须有对应测试
5. **不破坏现有测试**：现有测试必须保持通过
6. **类型严格**：TypeScript strict，禁止 any
7. **代码风格**：遵循项目 ESLint / Prettier
8. **文档同步**：核心改动同步更新 `docs/migration/`
9. **Commit 规范**：
   ```
   [refactor-v3/p<N>] <type>: <subject>
   
   Refs: #issue-<num>
   ```
10. **失败立停**：测试或验证失败立即停止报告，禁止硬推

---

## 使用方法

```bash
# 一次性准备
cd /path/to/masterBot
git checkout master && git pull
git checkout -b refactor/v3
git push -u origin refactor/v3

# 每个 Phase 开始前
git checkout refactor/v3 && git pull
git checkout -b refactor/v3/p<N>-<name>

# 启动 Claude Code 并把该 Phase 的提示词粘贴进去
claude
```

---

## 目录

```
Phase 0    准备工作
Phase 1    可观测性先行
Phase 2    Hooks 重构
Phase 2.5  Identity & Policy Foundation
Phase 3    ClaudeManagedAgent 上线
Phase 4    Skills + Subagents 升级
Phase 5    Session 高级特性
Phase 6    Memory 四层 + 租户隔离
Phase 7    企业 IM 一等公民
Phase 8    Admin Console（基础）
Phase 9    评估金字塔（启动）
Phase 9.5  Skill Factory 2.0
Phase 9.7  UI/UX Design System
Phase 10   Web 版 MVP
Phase 11   Web 版灰度上线
Phase 12   Web 版迭代运营
Phase 13   Electron 准备 + 适配
Phase 14   Electron 打包（macOS+Win）
Phase 15   三轨升级体系
Phase 16   Electron 灰度上线
```

每个 Phase 的提示词均为可独立执行的工程包，包含目标、前置条件、任务清单、完成标准、明确不做、验证步骤六个部分。

---

# Phase 0：准备工作（1 周）

```
你是一名资深 TypeScript / Node.js 工程师，参与 masterBot 项目的重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p0-preparation
- 禁止合并到 master / main，禁止 push 到 master / main
- 所有 commit 必须以 [refactor-v3/p0] 开头

# 🎯 目标
完成 v3 重构的环境准备：依赖添加、ADR 体系建立、SDK 验证。

# 📋 前置条件
- [ ] git status 干净
- [ ] 当前分支为 refactor/v3/p0-preparation
- [ ] Node.js 22+ 已安装
- [ ] 现有 npm test 全部通过

# 🔨 任务清单

## 任务 1：建立 docs/adr/ 目录与三份核心 ADR
创建以下三份 Architecture Decision Records，使用 MADR 模板：

1. **docs/adr/0001-hybrid-architecture.md** — 为什么 Claude SDK + Legacy 双引擎并存
2. **docs/adr/0002-local-first-distribution.md** — 为什么选员工本地分发而非 SaaS
3. **docs/adr/0003-tech-stack-baseline.md** — Node 22 / TypeScript / Next.js 16 / DuckDB 等

每份 ADR 包含：Context / Decision / Consequences / Alternatives Considered。

## 任务 2：建立 docs/migration/ 目录
创建：
- docs/migration/README.md（导航页）
- docs/migration/PHASES.md（所有 Phase 的总览，从本提示词目录抽取）
- docs/migration/PROGRESS.md（进度追踪表，初始全部 TODO 状态）

## 任务 3：添加 Claude Agent SDK 依赖
1. 添加依赖：`npm install @anthropic-ai/claude-agent-sdk`
2. 锁定具体版本到 package.json（精确版本号，非 ^ 语义化前缀）
3. 在 docs/adr/0004-sdk-version-lock.md 记录锁定原因

## 任务 4：跑通 SDK Hello World
创建 `tests/integration/sdk-smoke.test.ts`：
- 使用 SDK 的 query() 函数
- 发起一次最简单的对话："Hello, what is 2+2?"
- 断言返回了文本响应
- 这个测试需要 ANTHROPIC_API_KEY 环境变量，如果未设置则 skip 而不 fail

## 任务 5：基础设施清单
创建 docs/migration/infrastructure-checklist.md，列出后续 Phase 需要的：
- 公司内部 npm registry / Nexus
- 公司内部 Docker registry
- LLM Gateway 部署位置
- SSO IdP 配置
- 代码签名证书（macOS / Windows）

# ✅ 完成标准
- [ ] 4 份 ADR 完成
- [ ] docs/migration/ 目录建立
- [ ] @anthropic-ai/claude-agent-sdk 安装成功，版本锁定
- [ ] sdk-smoke 测试运行成功（有 API key 时通过，无则 skip）
- [ ] 现有 npm test 仍全部通过
- [ ] git log 至少 5 个清晰的 commit

# 🚫 明确不做
- ❌ 不要修改任何现有 src/ 代码
- ❌ 不要重构现有 agent.ts
- ❌ 不要替换 LLM 调用逻辑
- ❌ 不要修改数据库 schema
- 这些都是后续 Phase 的内容

# 🧪 验证步骤
最终执行：
1. `npm test` — 必须全绿
2. `git log --oneline refactor/v3..HEAD` — 检查 commit 历史
3. `cat docs/migration/PROGRESS.md` — 确认进度表存在
4. 在 PR 描述中列出本 Phase 完成的所有任务

# 🎁 交付
完成后用如下格式发起 PR：
- 标题：`[refactor-v3/p0] 准备工作：ADR + SDK 集成`
- 目标分支：refactor/v3
- 描述：列出 5 个任务的完成情况
```

---

# Phase 1：可观测性先行（1 周）

```
你是一名资深 TypeScript 工程师 + SRE，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p1-observability
- 从 refactor/v3 拉出（确保 Phase 0 已合入）
- 禁止合并到 master，所有 commit 以 [refactor-v3/p1] 开头

# 🎯 目标
建立"看见每次 agent 调用"的能力。引入 OpenTelemetry + Langfuse，替换现有 SpanRecorder。
此 Phase 完成后，后续所有改动都能在 Langfuse UI 中观测，是后续灰度对比的基础。

# 📋 前置条件
- [ ] Phase 0 已完成并合入 refactor/v3
- [ ] git status 干净
- [ ] Docker 已安装（用于跑 Langfuse）

# 🔨 任务清单

## 任务 1：引入 OpenTelemetry SDK
安装：
- @opentelemetry/api
- @opentelemetry/sdk-node
- @opentelemetry/auto-instrumentations-node
- @opentelemetry/exporter-trace-otlp-http
- @opentelemetry/semantic-conventions

## 任务 2：实现 OtelObserver
创建 `src/observability/otel.ts`：
- 初始化 NodeSDK
- 配置 OTLPTraceExporter
- 实现 `OtelObserver` 类，方法：
  - `startAgentSpan(input)` 创建 root span，attributes 用 GenAI Semantic Conventions
  - `startToolSpan(toolName, parentSpan)` 创建 tool 子 span
  - `recordModelUsage(span, usage)` 记录 token 使用
  - `endSpan(span, status)` 结束 span
- 字段必须遵循 OTel GenAI Semantic Conventions：
  - gen_ai.system / gen_ai.request.model / gen_ai.operation.name
  - gen_ai.usage.input_tokens / gen_ai.usage.output_tokens
  - gen_ai.usage.cache_read_input_tokens

## 任务 3：替换 SpanRecorder
1. 在 src/core/agent.ts（或当前等价文件）中找到所有 SpanRecorder 调用点
2. 改为使用 OtelObserver
3. 保留 SpanRecorder 作为向后兼容，但标记 @deprecated
4. 在 PR 描述中列出所有替换点

## 任务 4：部署 Langfuse self-hosted
1. 在 deploy/observability/ 目录创建 docker-compose.yml
2. 包含：langfuse-web、langfuse-worker、postgres、clickhouse、redis
3. 创建 .env.example 列出必要环境变量
4. 在 docs/migration/langfuse-setup.md 写部署文档

## 任务 5：配置导出到 Langfuse
1. 配置 OTel exporter 指向本地 Langfuse OTLP 端点
2. 验证一次完整的 agent 调用可以在 Langfuse UI 中查看

## 任务 6：性能基线
1. 创建 tests/performance/otel-overhead.test.ts
2. 测量加入 OTel 后的性能开销
3. 必须 < 5%（采样率默认 100%）
4. 如果超过，配置 sampling 到合适比例

## 任务 7：写文档
- docs/migration/observability-guide.md：trace 查看指南
- docs/migration/PROGRESS.md：更新 P1 状态为 DONE

# ✅ 完成标准
- [ ] OtelObserver 实现并通过单测
- [ ] 现有 SpanRecorder 调用点全部替换
- [ ] 现有 npm test 全部通过
- [ ] Langfuse self-hosted 跑通
- [ ] 一次真实 agent 调用在 Langfuse UI 中有完整 trace
- [ ] 性能开销 < 5%
- [ ] 文档完整

# 🚫 明确不做
- ❌ 不要重构 agent loop 本身（属于 Phase 2）
- ❌ 不要替换 LLM provider 适配层
- ❌ 不要改 prompt
- ❌ 不要替换其他追踪库（Sentry 等保持现状）

# 🧪 验证步骤
1. `npm test` 全绿
2. `docker-compose -f deploy/observability/docker-compose.yml up -d`
3. 跑一次 agent 调用
4. 浏览器打开 http://localhost:3000（Langfuse UI）
5. 在 Traces 页面看到完整链路（agent.run → tool.* spans）
6. 检查 GenAI attributes 完整性

# 🎁 交付
PR 标题：`[refactor-v3/p1] 可观测性：OTel + Langfuse 集成`
```

---

# Phase 2：Hooks 重构（2 周）

```
你是一名资深 TypeScript 架构师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p2-hooks-refactor
- 从 refactor/v3 拉出（确保 P0、P1 已合入）
- 禁止合并到 master，commit 以 [refactor-v3/p2] 开头

# 🎯 目标
把 SDK 的 Hook 抽象引入项目。把现有散落各处的 sandbox / IM 审批 / memory injection / PII 脱敏 /
重试逻辑等，统一重构为 12 个标准事件钩子。建立 IAgent 抽象层。

⚠️ 这是 v3 重构最大的一个 Phase，2 周时间。务必小步提交，每个子任务一个 commit。

# 📋 前置条件
- [ ] Phase 1 已完成并合入 refactor/v3
- [ ] OtelObserver 已可用
- [ ] git status 干净

# 🔨 任务清单

## 任务 1：设计 IAgent 接口
创建 `src/core/agent/types.ts`：

```typescript
export interface AgentInput {
  message: string;
  sessionId: string;
  userId: string;
  tenantId: string;
  provider: 'anthropic' | 'openai' | 'gemini' | 'ollama';
  model?: string;
  forceLegacy?: boolean;
  resumeFrom?: string;
}

export interface AgentEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'state_update' | 'error';
  data: any;
  timestamp: number;
}

export interface IAgent {
  execute(input: AgentInput): AsyncGenerator<AgentEvent>;
  resume(sessionId: string): AsyncGenerator<AgentEvent>;
  fork(sessionId: string): Promise<string>;
  checkpoint(sessionId: string): Promise<string>;
  capabilities(): AgentCapabilities;
}
```

## 任务 2：把现有 agent.ts 重命名为 LegacySelfHostedAgent
1. 复制 src/core/agent.ts → src/core/agent/legacy.ts
2. 改名为 class LegacySelfHostedAgent
3. 让其 implements IAgent
4. 实现 execute / resume / fork / checkpoint（fork/checkpoint 可暂时抛 NotImplementedError）
5. 保留原 src/core/agent.ts 作为向后兼容门面，内部代理到 legacy.ts
6. 现有测试不变

## 任务 3：实现 AgentRouter
创建 `src/core/agent/router.ts`：
- 注入 ClaudeManagedAgent（先用 stub，下一个 Phase 实现）和 LegacySelfHostedAgent
- 实现 route(config) 逻辑：
  - if config.forceLegacy → legacy
  - if config.provider === 'anthropic' && featureFlag.enabled → claude
  - else → legacy
- 注入 FeatureFlagService（先用简单实现，从 env 读取百分比）

## 任务 4：定义 Hook 系统
创建 `src/core/hooks/types.ts`，定义 12 个标准事件：

```typescript
export type HookEvent =
  | 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure'
  | 'UserPromptSubmit'
  | 'SessionStart' | 'SessionEnd'
  | 'SubagentStart' | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest'
  | 'Stop'
  | 'Notification';

export type HookCallback = (event, context) => Promise<HookResult>;

export type HookResult =
  | { action: 'allow' }
  | { action: 'deny'; reason: string }
  | { action: 'modify'; modifiedInput: any };
```

创建 `src/core/hooks/registry.ts`：
- HookRegistry 类
- register(event, callback) / runAll(event, data)
- 支持顺序执行，任意 callback 返回 deny 即终止

## 任务 5：将现有逻辑重构为 Hooks（核心工作）

### 5a. sandbox → PreToolUse Hook
- 找到现有 src/sandbox.ts（或等价文件）的所有调用点
- 提取为 `src/core/hooks/sandbox.ts` 中的 sandboxPreHook
- 在 LegacySelfHostedAgent 中改为通过 HookRegistry 调用

### 5b. IM 审批 → canUseTool 回调
- 找到现有飞书/钉钉审批卡片代码
- 提取为 `src/core/hooks/human-in-loop.ts`
- 在 LegacySelfHostedAgent 中改为通过 canUseTool 调用

### 5c. Memory injection → SessionStart Hook
- 找到现有"会话开始时注入长期记忆"逻辑
- 提取为 `src/core/hooks/memory-injection.ts`
- 注册到 SessionStart 事件

### 5d. PII 脱敏 → PreToolUse Hook
- 提取 PII 脱敏逻辑为 `src/core/hooks/pii-redaction.ts`
- 注册到 PreToolUse

### 5e. 自动重试 → PostToolUseFailure Hook
- 提取重试逻辑为 `src/core/hooks/auto-retry.ts`
- 配置 maxRetries / exponentialBackoff
- 注册到 PostToolUseFailure

### 5f. 审计日志 → PostToolUse Hook
- 提取审计写入为 `src/core/hooks/audit.ts`
- 注册到 PostToolUse 和 SessionEnd

### 5g. OTel 追踪 → 所有相关事件
- 包装 OtelObserver 为 hooks
- PreToolUse: startToolSpan
- PostToolUse: endSpan
- SessionStart: startAgentSpan
- SessionEnd: endAgentSpan

## 任务 6：测试覆盖
为每个 Hook 写单元测试，覆盖：
- 正常路径
- 异常路径（hook 抛错）
- 多个 hook 顺序执行
- deny 时其他 hook 不执行

## 任务 7：写迁移文档
- docs/migration/hooks-architecture.md：解释 Hook 系统设计
- docs/migration/hooks-mapping.md：列出每条原逻辑对应哪个 Hook
- 更新 docs/migration/PROGRESS.md

# ✅ 完成标准
- [ ] IAgent 接口定义完成
- [ ] LegacySelfHostedAgent 实现 IAgent 并通过测试
- [ ] AgentRouter 实现完成
- [ ] HookRegistry + 12 个事件定义
- [ ] 6 类原有逻辑全部 hookify（5a-5g 中的 5a-5f）
- [ ] 现有 npm test 全部通过（重要：不能因为重构破坏功能）
- [ ] 新增 hooks 单元测试覆盖率 ≥ 80%
- [ ] Langfuse trace 中能看到每个 hook 的执行

# 🚫 明确不做
- ❌ 不要实现 ClaudeManagedAgent（属于 Phase 3）
- ❌ 不要实现 fork / checkpoint 完整逻辑（属于 Phase 5）
- ❌ 不要替换底层 LLM 调用
- ❌ 不要改 SDK adapter
- ❌ 不要重构 Memory 系统（属于 Phase 6）

# 🧪 验证步骤
1. `npm test` 全绿（关键：现有功能未破坏）
2. 跑一次完整 agent 调用，在 Langfuse 中检查每个 hook span
3. 故意制造一次 sandbox deny 场景，确认 hook 链中断
4. 故意制造工具失败，确认 auto-retry hook 触发

# 🎁 交付
PR 标题：`[refactor-v3/p2] Hooks 重构：散落逻辑统一为 12 事件中间件`

# 📌 关键提示
- 这个 Phase 涉及大量代码移动，使用 git 时务必检查 diff
- 每完成一个 5a-5g 子任务就 commit + 跑一次测试
- 如果重构后测试失败，先 git revert，分析原因，再小步推进
- 不要试图一次完成所有 hooks，逐个搬迁更安全
```

---

# Phase 2.5：Identity & Policy Foundation（2 周）

```
你是一名资深 TypeScript 工程师 + 安全工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p2.5-identity-policy
- 从 refactor/v3 拉出
- 禁止合并到 master，commit 以 [refactor-v3/p2.5] 开头

# 🎯 目标
建立企业部署的硬前提：SSO 集成、SCIM 用户同步、OPA 策略引擎、三方权限交集模型。
没有这一层，企业 IT 部门不会让你上线。

# 📋 前置条件
- [ ] Phase 2 已完成并合入 refactor/v3
- [ ] HookRegistry 可用
- [ ] 已与公司 IT 部门确认：使用哪个 IdP（Azure AD / Okta / 飞书企业 / 钉钉企业）

# 🔨 任务清单

## 任务 1：SSO 集成（OAuth 2.0）
创建 `src/auth/`：
- `sso.ts`：基于 oauth4webapi 或 openid-client
- 支持 Authorization Code Flow + PKCE
- 实现 login / callback / refresh / logout
- 启动一个本地 callback 服务（端口可配置）
- token 用 OS keychain 加密存储（Web 阶段先用 Cookie + httpOnly）

⚠️ 关键约束：客户端不持有 LLM API Key，仅持有用户自己的 OAuth token。

## 任务 2：SCIM Provisioning（用户/部门同步）
创建 `src/auth/scim/`：
- `client.ts`：SCIM 2.0 客户端
- 同步：users / groups / departments
- 写入本地缓存表 `users` / `departments` / `user_groups`
- 定期增量同步（如每小时）
- 写一份 docs/migration/scim-setup.md，说明 IT 部门需要做什么

## 任务 3：身份模型实现
创建 `src/auth/identity-service.ts`：
- IdentityService 类
- getCurrentUser() → 返回完整身份信息
  - user_id / email / name
  - department / roles[] / groups[]
  - scopes[] (从 IdP 或 SCIM 派生)
- 缓存 5 分钟，避免每次调用都 fetch

## 任务 4：引入 OPA WASM
1. 安装 @open-policy-agent/opa-wasm
2. 创建 `src/permissions/opa-engine.ts`
3. 实现：
   - loadPolicy(rego: string) - 加载 Rego 策略
   - evaluate(input) - 执行评估
4. 创建初始策略 `policies/default.rego`：
   - 包含基础 RBAC 规则
   - 三方权限交集逻辑
   - lethal trifecta 检测

## 任务 5：5 层权限评估引擎
重构 `src/permissions/engine.ts`：

```typescript
class PermissionEngine {
  async evaluate(toolName, toolInput, context) {
    // Layer 1: Hooks（已在 PreToolUse 处理）
    // Layer 2: Deny Rules（绝对禁止）
    // Layer 3: Permission Mode（default/plan/bypass）
    // Layer 4: Allow Rules（白名单）
    // Layer 5: canUseTool 运行时审批
  }
}
```

## 任务 6：三方权限交集
实现核心公式：
```
allow = user.scopes ∩ agent.capabilities ∩ tool.required_scopes
```
- 在 OPA 策略中实现
- 写测试覆盖各种交集场景

## 任务 7：Lethal Trifecta 检测
在 PreToolUse hook 中实现：
- 检测当前 session 是否同时启用了：
  - 私密数据访问（hris / email.read / docs.read）
  - 不可信内容暴露（webfetch / webSearch / email.read）
  - 外部通信（send / post / publish）
- 三者并存 → 强制 HitL 审批

## 任务 8：服务端策略文件签名机制
- 服务端用私钥签名 policy.json
- 客户端用公钥（编译进应用）验证
- 过期机制（默认 7 天）
- 创建 `src/permissions/policy-verifier.ts`

## 任务 9：Web UI 登录页
（如果当前已有 web/，在其中实现）
- /auth/login 页面（重定向到 IdP）
- /auth/callback 处理
- 登录后显示用户信息
- 登出按钮

## 任务 10：测试与文档
- 单元测试：所有 5 层权限评估
- 集成测试：模拟 SSO 完整流程
- 文档：docs/migration/identity-architecture.md
- 文档：docs/migration/permission-model.md
- 安全审查清单：docs/migration/security-checklist.md

# ✅ 完成标准
- [ ] 员工可以用真实工号登录
- [ ] 部门信息从 SCIM 自动同步
- [ ] OPA 策略引擎运行正常
- [ ] 5 层权限评估全部测试通过
- [ ] Lethal Trifecta 检测有效（写一个集成测试触发）
- [ ] 服务端策略签名机制运作
- [ ] 现有 npm test 全部通过
- [ ] 通过基础安全自检

# 🚫 明确不做
- ❌ 不要实现完整审计日志（Phase 10 之前简化版即可）
- ❌ 不要实现租户隔离（属于 Phase 6）
- ❌ 不要做 LLM Gateway（属于 Phase 7 网络层，但本 Phase 要做接入预留）
- ❌ 不要做 SAML（OAuth 2.0 即可，SAML 后续按需）

# 🧪 验证步骤
1. `npm test` 全绿
2. 启动应用，浏览器打开 → 跳转 IdP → 登录回来
3. 检查 IdentityService 返回正确身份
4. 跑一次需要 hr.* scope 的工具调用
5. 用没权限的账号试一次，确认被拒绝
6. 触发一次 lethal trifecta，确认弹出 HitL

# 🎁 交付
PR 标题：`[refactor-v3/p2.5] 身份与权限基础：SSO + SCIM + OPA + 5 层评估`
```

---
# Phase 3：ClaudeManagedAgent 上线（2 周）

```
你是一名资深 TypeScript 工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p3-claude-managed-agent
- 从 refactor/v3 拉出
- commit 以 [refactor-v3/p3] 开头

# 🎯 目标
实现 ClaudeManagedAgent，包装 Claude Agent SDK。Anthropic provider 走 SDK 路径，享受 SDK 的
caching / compaction / subagent 等能力。通过 AgentRouter 灰度切换，5% 流量先跑起来。

# 📋 前置条件
- [ ] Phase 0-2.5 已合入 refactor/v3
- [ ] @anthropic-ai/claude-agent-sdk 依赖可用
- [ ] HookRegistry 可用
- [ ] AgentRouter 可用
- [ ] OtelObserver 可用

# 🔨 任务清单

## 任务 1：实现 ClaudeManagedAgent
创建 `src/core/agent/claude-managed.ts`：

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

export class ClaudeManagedAgent implements IAgent {
  constructor(
    private hookRegistry: HookRegistry,
    private permissionEngine: PermissionEngine,
    private observer: OtelObserver,
    private memoryRouter: MemoryRouter,  // 现有 Memory，下一个 Phase 重构
  ) {}

  async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
    const options = await this.buildOptions(input);
    
    for await (const message of query({
      prompt: input.message,
      options
    })) {
      yield this.translateToAgentEvent(message);
    }
  }

  private async buildOptions(input): Promise<ClaudeAgentOptions> {
    return {
      model: input.model ?? 'claude-opus-4-7',
      maxTurns: 250,
      thinking: { type: 'enabled', budget_tokens: 8000 },
      settingSources: ['project'],
      hooks: this.buildHookOptions(),
      agents: this.buildSubagents(input),  // 先用空对象，Phase 4 实现
      mcpServers: await this.buildMcpServers(),
      canUseTool: async (toolName, toolInput) => 
        this.permissionEngine.evaluate(toolName, toolInput, input),
      sessionId: input.sessionId,
      resumeSessionId: input.resumeFrom,
    };
  }
  // ...
}
```

## 任务 2：实现 SDK Hook 适配器
SDK 的 hooks 配置格式与我们 P2 实现的 HookRegistry 不同，需要适配：

创建 `src/core/agent/sdk-hook-adapter.ts`：
- buildHookOptions() 返回 SDK 期望的 hook 配置对象
- 内部调用 HookRegistry.runAll()
- 注意 SDK 的 hook 事件名映射到我们的 HookEvent

## 任务 3：实现 createMasterBotMcpServer
创建 `src/skills/sdk-mcp-wrapper.ts`：
- 把现有 SKILL.md 技能包装成 SDK 的 MCP Server
- 使用 @anthropic-ai/claude-agent-sdk 的 createSdkMcpServer + tool
- 用 zod 构建参数 schema
- 这是关键：保护现有所有 SKILL.md 投资，让 SDK 路径直接可用

## 任务 4：SDK Message → AgentEvent 转换器
创建 `src/core/agent/event-translator.ts`：
- 把 SDK 流式消息（SDKMessage）翻译为 AgentEvent
- 处理：
  - SDKAssistantMessage（text content blocks）
  - SDKToolUseBlock（tool_call 事件）
  - SDKToolResultBlock（tool_result 事件）
  - SDKThinkingBlock（thinking 事件）
- 测试每种类型的转换

## 任务 5：FeatureFlag 服务实现
基于 P2 的 stub，实现完整版 `src/config/feature-flag.ts`：
- 支持 percentage rollout
- 支持 user_id 白名单 / 黑名单
- 支持配置热加载（暂时从 env 读，后续 Phase 接配置中心）
- 提供：isEnabled(flagName, userId) 接口

## 任务 6：在 AgentRouter 中接入 ClaudeManagedAgent
更新 `src/core/agent/router.ts`：
- 将 P2 中的 stub 替换为真实 ClaudeManagedAgent
- 灰度判定：默认 5% 走 SDK，可通过 env 调整
- 加日志：记录每次路由决策（哪条路径、原因）

## 任务 7：Web UI 增加切换开关
（在现有 Web Settings 页面）
- 增加 "Use Claude Managed Agent" 开关
- 仅管理员可见
- 改动后立即生效（对当前 session）

## 任务 8：编写 capability eval 套件（基础版）
创建 `tests/evals/capability/`：
- `basic-conversation.yaml` 基础对话能力
- `tool-calling.yaml` 工具调用准确性
- `multi-turn.yaml` 多轮对话连贯性
- 使用 promptfoo 框架（npm install -D promptfoo）

测试用例至少 20 个，覆盖：
- 简单问答
- 需要 1 次工具调用
- 需要 2-3 次工具调用
- 需要 HitL 审批的场景

## 任务 9：A/B 对比脚本
创建 `scripts/ab-compare.ts`：
- 同一个测试集分别跑 ClaudeManagedAgent 和 LegacySelfHostedAgent
- 对比指标：
  - 通过率
  - 平均响应时间
  - 平均 token 消耗
  - 成本
- 输出对比报告

## 任务 10：监控与日志
- 在 Langfuse 中为两条路径打不同 tag
- 创建 docs/migration/sdk-vs-legacy-comparison.md 模板报告

# ✅ 完成标准
- [ ] ClaudeManagedAgent 实现完成
- [ ] 现有 SKILL.md 技能可被 SDK 路径调用
- [ ] AgentRouter 灰度 5% 配置生效
- [ ] capability eval 套件 ≥ 20 条用例
- [ ] A/B 对比脚本可运行
- [ ] 现有 npm test 全部通过
- [ ] 灰度 5% 流量在 Langfuse 中能看到 SDK 路径 trace

# 🚫 明确不做
- ❌ 不要实现 Subagents（属于 Phase 4）
- ❌ 不要实现 fork / resume 完整逻辑（属于 Phase 5）
- ❌ 不要重构 Memory 系统（属于 Phase 6）
- ❌ 不要做 Progressive Disclosure 的 Skills 改造（属于 Phase 4）
- ❌ 不要替换 Legacy 路径，保持双引擎并存

# 🧪 验证步骤
1. `npm test` 全绿
2. 设置 ANTHROPIC_API_KEY，跑一次走 SDK 的对话
3. 设置走 Legacy，跑同样的对话
4. 比较两次的 Langfuse trace
5. 跑 A/B 对比脚本，产出报告
6. 灰度配置 50% 跑一段时间，观察是否稳定

# 🎁 交付
PR 标题：`[refactor-v3/p3] ClaudeManagedAgent 上线 + 灰度 5% 流量`

# 📌 关键提示
- SDK 的 query() 是 async generator，处理流时注意背压
- SDK 内部会 spawn 子进程跑 Claude Code CLI，注意进程管理
- 错误处理要完整：网络断开、token 过期、超时等
- 灰度初期 5%，观察 1 周后再决定是否放量
```

---

# Phase 4：Skills + Subagents 升级（2 周）

```
你是一名资深 TypeScript 工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p4-skills-subagents
- commit 以 [refactor-v3/p4] 开头

# 🎯 目标
1. 把现有 SKILL.md 改造为 Anthropic Skills 的 Progressive Disclosure 格式
2. 实现 Subagent 委派机制（替代现有 SOUL.md Worker）
3. 衡量 token 节省效果

# 📋 前置条件
- [ ] Phase 3 已合入
- [ ] ClaudeManagedAgent 跑通
- [ ] 现有 skills/built-in/ 目录可访问

# 🔨 任务清单

## 任务 1：Skills 目录重组
将现有 skills/built-in/ 重组为 Anthropic Skills 格式：

```
.claude/
└── skills/
    ├── shell-execution/
    │   ├── SKILL.md          ← 描述（Layer 1+2）
    │   └── scripts/
    │       └── safe-exec.ts  ← 资源（Layer 3，按需读）
    ├── email-management/
    │   ├── SKILL.md
    │   └── reference/
    │       ├── gmail-api.md
    │       └── template-patterns.md
    └── ... 现有所有技能
```

## 任务 2：SKILL.md 改造
对每个技能的 SKILL.md：
- frontmatter 包含：name / description / license
- description 务必精确：包含"何时使用"的关键词
- 主体内容遵循 Progressive Disclosure：
  - 「何时使用本技能」（触发场景）
  - 「核心流程」（主路径）
  - 「关键约束」（必须遵守）
  - 「高级用法」（指向 reference/）

## 任务 3：实现 Subagent 定义层
创建 `src/subagents/`：

```typescript
// src/subagents/types.ts
export interface SubagentDefinition {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  model: 'haiku' | 'sonnet' | 'opus';
}

// src/subagents/builder.ts
export function buildSubagents(context: AgentContext): Record<string, AgentDefinition> {
  return {
    'email-handler': { ... },
    'calendar-handler': { ... },
    'researcher': { ... },
    'secretary': { ... },
  };
}
```

按方案 v3.0 第 4 章描述实现 4 个核心 subagent：
- email-handler（haiku-4-5）
- calendar-handler（haiku-4-5）
- researcher（opus-4-7）
- secretary（sonnet-4-6）

## 任务 4：迁移 SOUL.md Worker
1. 找到现有 SOUL.md Worker 实现
2. 提取每个 Worker 的核心 prompt 和 tools
3. 改写为 Subagent 定义
4. 旧 SOUL.md 标记 deprecated（保留 6 个月）

## 任务 5：在 ClaudeManagedAgent 中接入 Subagents
更新 `src/core/agent/claude-managed.ts`：
- buildOptions() 中真实接入 buildSubagents()
- 传给 SDK options.agents

## 任务 6：Skills Registry 升级
更新 `src/skills/registry.ts`：
- 支持读取 Anthropic Skills 格式
- 实现 Progressive Disclosure：
  - 列出技能时仅返回 metadata（name + description）
  - agent 决定使用某技能时，按需加载完整 SKILL.md
- 兼容旧格式（向后兼容期 6 个月）

## 任务 7：Token 节省衡量
创建 `scripts/measure-token-reduction.ts`：
- 跑一组标准对话
- 对比改造前后的 input token 数
- 报告：减少百分比
- 期望：≥ 30% 节省

## 任务 8：Subagent 委派测试
创建 `tests/integration/subagent-delegation.test.ts`：
- 测试 secretary 自动委派给 email-handler
- 测试主线 context 不污染（关键）
- 测试模型梯度（subagent 使用配置的便宜模型）

## 任务 9：文档
- docs/migration/skills-progressive-disclosure.md
- docs/migration/subagents-design.md
- 更新 PROGRESS.md

# ✅ 完成标准
- [ ] 所有 SKILL.md 改造为 Progressive Disclosure 格式
- [ ] 4 个核心 Subagent 定义可用
- [ ] SOUL.md Worker 全部迁移
- [ ] Skills Registry 支持新格式
- [ ] Token 减少 ≥ 30%
- [ ] 现有 npm test 全部通过
- [ ] capability eval 套件继续通过（不能因重构而退化）

# 🚫 明确不做
- ❌ 不要实现 Skill Factory 升级（属于 Phase 9.5）
- ❌ 不要做完整租户隔离（属于 Phase 6）
- ❌ 不要做 fork / checkpoint（属于 Phase 5）
- ❌ Legacy 路径不需要 Subagent（仅 SDK 路径需要）

# 🧪 验证步骤
1. `npm test` 全绿
2. 跑 capability eval，对比 P3 完成时的指标，确认无退化
3. 跑 measure-token-reduction.ts，确认节省 ≥ 30%
4. 跑一次 secretary 委派给 email-handler 的场景
5. 在 Langfuse 中查看 subagent span 嵌套

# 🎁 交付
PR 标题：`[refactor-v3/p4] Skills Progressive Disclosure + Subagents 委派`
```

---

# Phase 5：Session 高级特性（1 周）

```
你是一名资深 TypeScript 工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p5-session-features
- commit 以 [refactor-v3/p5] 开头

# 🎯 目标
实现 fork / resume / checkpoint 三个 session 高级特性，支持员工"基于已有对话试不同方案"。

# 📋 前置条件
- [ ] Phase 4 已合入
- [ ] ClaudeManagedAgent 工作正常

# 🔨 任务清单

## 任务 1：数据库 Schema 变更
在 sessions 表增加：
```sql
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
ALTER TABLE sessions ADD COLUMN forked_at TEXT;
ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT;
```

新建表：
```sql
CREATE TABLE session_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  state_blob BLOB NOT NULL,
  file_snapshots TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_checkpoints_session ON session_checkpoints(session_id);

CREATE TABLE file_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  before_content BLOB,
  after_content BLOB,
  created_at TEXT NOT NULL
);
```

写迁移脚本，向后兼容（旧 session 不受影响）。

## 任务 2：实现 fork
更新 `src/core/agent/claude-managed.ts` 和 `legacy.ts`：
- ClaudeManagedAgent.fork() 调用 SDK 的 ClaudeSDKClient.fork()
- LegacySelfHostedAgent.fork()：复制 session 元数据 + 消息历史，生成新 sessionId

## 任务 3：实现 resume
- ClaudeManagedAgent.resume() 调用 SDK 原生 resumeSessionId 选项
- LegacySelfHostedAgent.resume()：从 DB 加载消息，从最后状态继续

## 任务 4：实现 checkpoint
- 任何 agent 都可在执行过程中调 checkpoint()
- 序列化当前 state（消息、变量、工具状态）
- 写入 session_checkpoints 表
- 返回 checkpointId

## 任务 5：API 端点
更新 `src/api/routes/sessions.ts`：
- POST /api/sessions/{id}/fork → 返回新 sessionId
- POST /api/sessions/{id}/resume → 恢复并返回事件流
- POST /api/sessions/{id}/checkpoint → 创建 checkpoint
- POST /api/sessions/{id}/restore-checkpoint/{checkpointId} → 回滚到指定 checkpoint

## 任务 6：File Checkpoints
对于修改文件的工具调用：
- 工具执行前，记录 before_content
- 工具执行后，记录 after_content
- 用户可一键 rewind

## 任务 7：Web UI 集成
在 Chat 页面消息卡片增加：
- 「分叉对话」按钮（fork）
- 「重做这一步」按钮（基于上一个 checkpoint resume）
- 「回滚文件」按钮（如果该消息修改了文件）

## 任务 8：测试
- 单元测试每个端点
- 集成测试 fork → 修改 → resume → checkpoint → restore 完整流程
- 边界测试：fork 不存在的 session、resume 已结束的 session 等

## 任务 9：文档
- docs/migration/session-features.md
- 用户文档：how-to-fork-and-resume.md

# ✅ 完成标准
- [ ] 三个端点全部实现并通过测试
- [ ] Web UI 上可操作 fork/resume/rewind
- [ ] File checkpoint 机制有效
- [ ] 现有 npm test 全部通过
- [ ] 数据库 migration 向后兼容（不破坏旧 session）

# 🚫 明确不做
- ❌ 不要实现完整的 Memory 重构（属于 Phase 6）
- ❌ 不要实现 Tenant 隔离
- ❌ 不要做大规模 UI 改版（属于 Phase 9.7）

# 🧪 验证步骤
1. `npm test` 全绿
2. 跑一次完整 fork 测试
3. 跑一次完整 resume 测试
4. 跑一次 file checkpoint + restore 测试
5. 在 Web UI 上手动验证三个按钮

# 🎁 交付
PR 标题：`[refactor-v3/p5] Session 高级特性：fork/resume/checkpoint`
```

---

# Phase 6：Memory 四层 + 租户隔离（2 周）

```
你是一名资深 TypeScript 工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p6-memory-tenant
- commit 以 [refactor-v3/p6] 开头

# 🎯 目标
1. 把现有短期 + 长期 + 知识图谱三套独立体系，重构为四层统一架构（Working / Episodic / Semantic / Procedural）
2. 引入 DuckDB + VSS 替代当前向量存储（为 Web 阶段服务端版准备）
3. 全部数据强制 tenant_id 隔离

# 📋 前置条件
- [ ] Phase 5 已合入
- [ ] 已确认部署架构（Web 阶段使用服务端 DB）

# 🔨 任务清单

## 任务 1：抽象 MemoryRouter 接口
创建 `src/memory/types.ts`：

```typescript
export interface IMemoryRouter {
  // L1 Working（in-context）
  // 由 SDK 自动管理，仅提供 metrics

  // L2 Episodic（情景记忆）
  searchEpisodic(query: string, k: number, tenantId: string): Promise<EpisodicMemory[]>;
  insertEpisodic(item: EpisodicMemory, tenantId: string): Promise<void>;

  // L3 Semantic（语义记忆）
  searchSemantic(entity: string, tenantId: string): Promise<SemanticFact[]>;
  upsertSemanticFact(fact: SemanticFact, tenantId: string): Promise<void>;
  pendingReview(tenantId: string): Promise<SemanticFact[]>;
  approveFact(factId: string, reviewer: string): Promise<void>;

  // L4 Procedural（程序记忆）
  loadAgentRules(scope: string, tenantId: string): Promise<string>;
}
```

## 任务 2：引入 DuckDB + VSS extension
1. 安装 @duckdb/node-api
2. 创建 `src/persistence/duckdb-client.ts`
3. 安装 VSS extension（向量搜索）
4. 创建 schema：
   - episodic_memory(id, tenant_id, content, embedding, created_at, ...)
   - semantic_facts(id, tenant_id, subject, predicate, object, confidence, status, ...)

## 任务 3：实现 Episodic Memory
创建 `src/memory/episodic.ts`：
- 使用 DuckDB + VSS
- 实现 BM25 + 向量混合检索
- TTL 90 天，过期降级到 L3

## 任务 4：实现 Semantic Memory
创建 `src/memory/semantic.ts`：
- 基于现有知识图谱（保留 BFS 多跳）
- 关键升级：写入需要 HitL 审批
- 实现 pendingReview / approveFact 流程
- 在会话结束时自动提取候选事实（confidence ≥ 0.85）

## 任务 5：实现 Procedural Memory
创建 `src/memory/procedural.ts`：
- 加载 AGENTS.md / SOUL.md / SKILL.md
- 通过 SessionStart hook 注入到 system prompt
- 支持热重载（文件变化自动刷新）

## 任务 6：实现 Active Compression
为 Subagent 和主 agent 提供 `memory_consolidate` 工具：
- agent 自主决定何时压缩
- 把 working memory 关键信息转入 L2 Episodic
- 释放 context window

## 任务 7：租户隔离实现
**这是最重要的安全要求**：
- 所有 memory 表添加 tenant_id 列（NOT NULL）
- 所有查询强制 WHERE tenant_id = ?
- 创建 RLS（Row Level Security）类似机制
- 写一个 lint 规则禁止任何不带 tenant_id 的查询

## 任务 8：迁移现有数据
- 旧短期记忆 → 不迁移（自然过期）
- 旧长期记忆 → 迁移到 L2 Episodic（带 tenant_id）
- 旧知识图谱 → 迁移到 L3 Semantic（带 tenant_id）
- 写迁移脚本 + 校验脚本

## 任务 9：HitL 写入门
在 Web UI 增加「待审批记忆」页面：
- 列出 pending facts
- 一键 approve / reject
- 仅授权用户可见

## 任务 10：测试
- 跨租户隔离测试（关键）
- HitL 写入流程测试
- 性能测试（DuckDB VSS vs 现有方案）

# ✅ 完成标准
- [ ] MemoryRouter 接口实现
- [ ] DuckDB + VSS 替代旧向量库
- [ ] 四层架构全部上线
- [ ] tenant_id 强制隔离（自动化测试覆盖）
- [ ] HitL 审批门工作正常
- [ ] 数据迁移成功
- [ ] 现有 npm test 全部通过
- [ ] capability eval 不退化

# 🚫 明确不做
- ❌ 本 Phase 数据库依然在中心服务端（Web 阶段定位）
- ❌ 不要做客户端本地数据库（属于 Phase 13）
- ❌ 不要重构 Skills（已在 Phase 4 完成）

# 🧪 验证步骤
1. `npm test` 全绿
2. 跨租户测试：创建 tenant A 的记忆，用 tenant B 身份查询，必须 0 结果
3. 写入流程测试：触发候选事实 → 审批 → 进入 L3
4. 性能测试：1M 条记忆下查询 < 100ms
5. 旧数据查询正常（兼容性）

# 🎁 交付
PR 标题：`[refactor-v3/p6] Memory 四层架构 + 租户强制隔离`
```

---
# Phase 7：企业 IM 一等公民（2 周）

```
你是一名资深 TypeScript 工程师 + 产品工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p7-enterprise-im
- commit 以 [refactor-v3/p7] 开头

# 🎯 目标
强化飞书 / 钉钉集成，新增企业微信 / Microsoft Teams 渠道。建立 IChannel 抽象，
统一 HitL 审批卡片协议。

# 📋 前置条件
- [ ] Phase 6 已合入
- [ ] 已与 IT 部门确认：使用哪些企业 IM 渠道
- [ ] 已申请各家 IM 平台的应用开发凭据

# 🔨 任务清单

## 任务 1：设计 IChannel 抽象
创建 `src/channels/types.ts`：

```typescript
export interface IChannel {
  name: string;
  
  // 入站消息处理
  onIncoming(handler: (msg: IncomingMessage) => Promise<void>): void;
  
  // 出站消息发送
  send(target: ChannelTarget, message: ChannelMessage): Promise<void>;
  
  // HitL 审批卡片渲染（关键统一接口）
  renderApprovalCard(req: ApprovalRequest): Promise<ApprovalResponse>;
  
  // 健康检查
  health(): Promise<{ ok: boolean; details?: any }>;
}

export interface IncomingMessage {
  channelName: string;
  userId: string;        // 平台 userId
  externalUserId: string; // 公司内部 userId（通过 SCIM 映射）
  conversationId: string;
  text: string;
  attachments?: Attachment[];
  raw: any;              // 原始平台消息
}

export interface ApprovalRequest {
  toolName: string;
  toolInput: any;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  allowModify?: boolean;  // 是否允许 approve with changes
  timeout?: number;       // 超时秒数
}
```

## 任务 2：飞书 Channel 强化
更新现有 src/channels/feishu.ts（或新建）：
- 完整支持飞书企业版 OpenAPI v3
- Webhook 验签
- 用户 ID 自动映射（通过 SCIM 同步的数据）
- 消息卡片：交互式 InteractiveCard（含审批按钮）
- HitL 卡片标准化：approve / deny / approve with changes

## 任务 3：钉钉 Channel 强化
更新 src/channels/dingtalk.ts：
- 钉钉机器人 + 应用消息双模式
- ActionCard 互动卡片
- 同样支持 HitL 三态

## 任务 4：企业微信 Channel
新建 src/channels/wecom.ts：
- 企业微信自建应用模式
- 消息加解密（必需）
- 模板卡片支持
- 实现 IChannel 全部方法

## 任务 5：Microsoft Teams Channel
新建 src/channels/teams.ts：
- Bot Framework SDK 集成
- Adaptive Cards（HitL 友好）
- SSO 与公司 AAD 整合（如适用）

## 任务 6：HitL 审批卡片标准化
创建 `src/channels/hitl-card-renderer.ts`：
- 抽象出"审批卡片"概念
- 各 Channel 实现自己的渲染
- 接收 ApprovalRequest，返回 ApprovalResponse
- 超时机制：默认 5 分钟无响应自动 deny

## 任务 7：Channel 路由与会话桥接
创建 `src/channels/router.ts`：
- 接收任何 Channel 的入站消息
- 根据 externalUserId 找到 / 创建 session
- 调用 AgentRouter 执行
- 把 AgentEvent 流回该 Channel

## 任务 8：用户 ID 映射
更新 src/auth/identity-service.ts：
- 维护「公司内部 userId ↔ 飞书 userId / 钉钉 userId / 微信 userId / Teams userId」映射表
- 通过 SCIM 同步获取
- 提供 lookup / cache

## 任务 9：测试
- 每个 Channel 至少 5 个集成测试（mock 平台 API）
- 端到端测试：完整 HitL 审批流程
- 失败场景：消息发送失败、用户 ID 找不到、超时等

## 任务 10：部署文档
- docs/migration/im-integration-feishu.md
- docs/migration/im-integration-dingtalk.md
- docs/migration/im-integration-wecom.md
- docs/migration/im-integration-teams.md
每份包含：申请凭据步骤、配置示例、调试方法

# ✅ 完成标准
- [ ] IChannel 抽象稳定
- [ ] 4 个 Channel 全部实现 IChannel
- [ ] HitL 审批在每个 Channel 上工作
- [ ] 用户 ID 映射可靠
- [ ] 现有 npm test 全部通过
- [ ] 至少 1 个 Channel 在生产前完成端到端联调

# 🚫 明确不做
- ❌ 不要做 iMessage / Telegram / WhatsApp 等个人渠道（v3.1 明确不做）
- ❌ 不要在客户端做 Channel（这些都是服务端集成）
- ❌ 不要做语音 Channel（属于未来）

# 🧪 验证步骤
1. `npm test` 全绿
2. 在每个 Channel 上发一条消息，agent 正确响应
3. 触发一次 HitL 审批，在 IM 卡片上点击 approve / deny / modify
4. 健康检查 endpoint 全部正常

# 🎁 交付
PR 标题：`[refactor-v3/p7] 企业 IM 一等公民：飞书/钉钉/企业微信/Teams`

# 📌 关键提示
- 每家 IM 平台 API 各有坑，尤其消息加解密、签名验证
- 凭据管理务必走 LLM Gateway 模式（不要本地存）
- HitL 卡片设计要在所有平台上美观且功能一致
```

---

# Phase 8：Admin Console 基础（1 周）

```
你是一名资深 TypeScript 工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p8-admin-console
- commit 以 [refactor-v3/p8] 开头

# 🎯 目标
建立管理后台基础，包含 4 个核心管理功能：技能审批、RBAC 配置、审计查询、成本看板。
这是给 IT / 安全 / 财务团队使用的，不是给员工使用的。

# 📋 前置条件
- [ ] Phase 7 已合入
- [ ] 现有 Web Console 可用
- [ ] Identity 服务可识别 admin 角色

# 🔨 任务清单

## 任务 1：路由与权限保护
创建 web/src/app/admin/ 路由：
- 仅 admin 角色可访问
- 中间件检查 user.roles 包含 'admin'
- 否则 403 Forbidden

## 任务 2：Admin 主页 / 概览
- /admin 显示概览面板：
  - 今日 agent 调用量
  - 待审批技能数量
  - 待审批记忆事实数量
  - 异常告警

## 任务 3：技能审批界面
/admin/skills/review：
- 列出 status='pending-review' 的 skills
- 详情页显示：
  - SKILL.md 内容
  - 自动生成的代码
  - 静态校验报告
  - 沙箱测试结果
- 操作：approve / reject / request changes
- 改 skill 状态后自动写审计日志

## 任务 4：RBAC 配置界面
/admin/rbac：
- 浏览所有 user × scope 映射
- 配置 deny rules / allow rules
- 修改后服务端重新签名 policy 文件
- 客户端 Track 3 自动拉取新策略

## 任务 5：审计查询界面
/admin/audit：
- 查询表单：时间范围 / userId / agentId / toolName / decision
- 结果列表（分页）
- 详情页：完整 trace（链接到 Langfuse）
- 导出 CSV
- ⚠️ 只读，不可修改（合规要求）

## 任务 6：成本看板
/admin/cost：
- 维度：日 / 周 / 月，按部门 / 用户 / 模型
- 折线图 / 饼图（用 recharts）
- TopN 用户、TopN 部门
- 预算告警配置（接近限额时通知）

## 任务 7：导航与布局
- 侧栏导航：技能审批 / RBAC / 审计 / 成本 / 设置
- 顶栏：当前管理员信息 + 退出
- 面包屑

## 任务 8：操作审计
所有 admin 操作都要写审计日志：
- 谁批准了哪个技能
- 谁修改了哪个 RBAC 规则
- 谁查询了哪些审计记录
- ⚠️ 这些 meta 审计日志同样不可篡改

## 任务 9：测试
- 端到端测试每个页面
- 权限测试：非 admin 用户访问 → 403
- 操作测试：批准 skill → 状态正确变更 + 审计日志生效

## 任务 10：文档
- docs/admin-console-guide.md：管理员使用手册

# ✅ 完成标准
- [ ] 4 个核心模块全部上线
- [ ] 权限保护严格
- [ ] 操作有完整审计
- [ ] 现有 npm test 全部通过
- [ ] UI 基础可用（暂不要求设计精致，Phase 9.7 会重设计）

# 🚫 明确不做
- ❌ 不要做精致的 UI 设计（属于 Phase 9.7）
- ❌ 不要做 SSO 集成调试界面
- ❌ 不要做完整 Skill Factory（属于 Phase 9.5）

# 🧪 验证步骤
1. `npm test` 全绿
2. 用 admin 账号登录，访问 4 个模块
3. 用普通员工账号访问 /admin/* → 403
4. 完整批准一个 skill → 检查状态 + 审计

# 🎁 交付
PR 标题：`[refactor-v3/p8] Admin Console 基础：审批 + RBAC + 审计 + 成本`
```

---

# Phase 9：评估金字塔（启动）（持续）

```
你是一名资深 TypeScript 工程师 + QA 工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p9-evaluation-pyramid
- commit 以 [refactor-v3/p9] 开头
- 注意：Phase 9 是「持续 Phase」，启动后会和后续所有 Phase 并行

# 🎯 目标
建立三层评估金字塔，让 agent 行为变化可量化：
- Tier 1: Offline Regression Eval（每 PR 跑）
- Tier 2: Online Shadow Traffic（持续）
- Tier 3: Production Canary（每次发布）

# 📋 前置条件
- [ ] Phase 8 已合入
- [ ] capability eval 套件已有基础（Phase 3 创建）
- [ ] Langfuse 可用

# 🔨 任务清单

## 任务 1：Tier 1 - 扩展 Capability Eval 套件
扩展 tests/evals/capability/：
- 4 个核心套件：
  - basic-conversation.yaml
  - tool-calling.yaml
  - multi-turn-context.yaml
  - permission-and-safety.yaml
- 每套至少 30 条用例
- 总计 120+ 用例
- 使用 promptfoo 框架
- 包含 LLM-as-Judge 评分（claude-haiku-4-5 当 judge）

## 任务 2：Tier 1 - GitHub Actions CI 集成
创建 .github/workflows/eval.yml：
- 触发：push / pull_request 到 refactor/v3
- 步骤：
  1. 跑现有 npm test
  2. 跑 promptfoo eval 全部套件
  3. 上传报告 artifact
  4. 阈值检查：通过率 < 95% 则 fail
- 添加 PR 描述自动评论：本次 vs 上次的 diff

## 任务 3：Tier 2 - Shadow Traffic 框架
创建 src/eval/shadow-traffic.ts：
- 配置：默认 10% 真实流量
- 入站请求复制一份给 shadow agent（不返回给用户）
- 对比两条路径的：
  - 工具调用集合（diff）
  - 最终回答相似度（embedding similarity）
  - 时延 / token / 成本
- 结果写入 Langfuse Datasets

## 任务 4：Tier 2 - Langfuse Datasets 配置
- 创建 production-shadow dataset
- 配置自动收集 shadow 对比结果
- Dashboard：日新增 / 偏离率 / 退化案例

## 任务 5：Tier 3 - FeatureFlag Canary 系统
扩展 P3 的 FeatureFlag 服务：
- 支持 5% → 25% → 50% → 100% 的渐进发布
- 每个 stage 观察期可配置（默认 24-72h）
- 自动指标：
  - 错误率
  - 用户满意度（thumbs up/down）
  - 平均成本变化
- 任一指标超阈值自动回滚到上一 stage

## 任务 6：FeatureFlag 看板
在 Admin Console 增加 /admin/canary：
- 当前各 flag 的发布阶段
- 各 stage 的指标对比
- 一键提级 / 降级
- 操作有审计

## 任务 7：金标准用例集
创建 tests/evals/golden/：
- 由产品经理 / 资深员工标注
- 50 个"必须答对"的关键场景
- 任何 PR 中破坏一条都自动 block merge

## 任务 8：可视化报告
创建 scripts/generate-eval-report.ts：
- 跑所有套件，输出 HTML 报告
- 通过率趋势图（git history）
- 退化用例列表（最近退化的）
- 上传到内部 wiki / 文档站

## 任务 9：文档
- docs/eval/three-tier-pyramid.md
- docs/eval/writing-good-test-cases.md
- docs/eval/canary-process.md

# ✅ 完成标准
- [ ] Tier 1: 120+ 用例 + CI 自动跑
- [ ] Tier 2: Shadow Traffic 上线 + Langfuse Dataset
- [ ] Tier 3: Canary 系统可用
- [ ] Golden Set 50 个用例
- [ ] 现有 npm test 全部通过

# 🚫 明确不做
- ❌ 这是「持续 Phase」，第一次完成只交付基础设施
- ❌ 不需要在 Phase 9 内把 capability eval 套件做到完美
- ❌ 后续每个 Phase 都会持续补充用例

# 🧪 验证步骤
1. `npm test` 全绿
2. 跑一次完整 promptfoo eval，输出报告
3. 配置 shadow traffic 10%，运行 1 天，检查 dataset
4. 模拟一次 canary 发布，触发自动回滚

# 🎁 交付
PR 标题：`[refactor-v3/p9] 评估金字塔启动：Tier 1/2/3 全链路`

# 📌 持续运营提示
- Phase 9 启动后，每个后续 Phase 完成时都需要：
  - 新增 capability eval 用例
  - 检查 shadow traffic 是否有退化
  - 灰度发布走 canary 流程
- 保持 Tier 1 通过率 ≥ 99%
```

---

# Phase 9.5：Skill Factory 2.0（3 周）

```
你是一名资深 TypeScript 工程师 + AI 工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p9.5-skill-factory-v2
- commit 以 [refactor-v3/p9.5] 开头

# 🎯 目标
把现有 Auto-Skill Generator 升级为完整 5 阶段流水线：
UNDERSTAND → SYNTHESIZE → VERIFY → EVAL → PUBLISH。
实现客户端段（个人草稿立即可用）+ 服务端段（企业评审）双段协同。
这是 masterBot 最大的差异化能力，必须做到极致。

# 📋 前置条件
- [ ] Phase 8 已合入
- [ ] Identity / RBAC 完整
- [ ] Skill Registry 服务端框架已有

# 🔨 任务清单

## 任务 1：Stage 1 - NL Spec Builder（理解需求）
创建 `src/skill-factory/spec-builder.ts`：

```typescript
export class SpecBuilder {
  async build(
    intent: string,
    context: ConversationContext,
    options: { maxRounds: number; schemaTemplate: object },
  ): Promise<SkillSpec> {
    // 多轮反问澄清
    // 输出结构化 Spec（YAML）
  }
}
```

要求：
- 多轮对话（最多 3 轮）
- 输出标准化 SkillSpec：
  - name / description / category
  - inputs schema
  - outputs schema
  - required tools / scopes
  - test cases (示例输入 + 期望输出)
- 在 Spec 落地前查询 Skill Catalog，提示是否已有类似技能

## 任务 2：Stage 2 - Skill Synthesizer（生成代码）
创建 `src/skill-factory/synthesizer.ts`：
- 用 Claude Opus 4.7 生成代码
- 输出文件结构：
  - SKILL.md（Progressive Disclosure 格式）
  - scripts/index.ts（核心实现）
  - tests/unit.test.ts（单元测试）
  - references/（资源文件，可选）
- 内置代码模板（参考最佳实践 SKILL）
- 多次尝试机制（最多 3 次）

## 任务 3：Stage 3a - Local Static Validator
创建 `src/skill-factory/validators/static.ts`：
- 检查项：
  - 文件结构完整性
  - SKILL.md frontmatter 格式
  - 命名规范（kebab-case for skill name）
  - 元数据完整性
  - 所声明 tools 在 Tool Registry 中存在
- 输出：通过 / 警告 / 错误

## 任务 4：Stage 3b - Security Scanner
创建 `src/skill-factory/validators/security.ts`：
- 集成 Semgrep 静态分析
- 检查项：
  - 硬编码 API key / token
  - SQL 注入风险
  - 命令注入风险
  - 文件路径遍历
  - 网络访问范围（应仅限声明的 scope）
- 严重问题直接 reject

## 任务 5：Stage 4a - Local Sandbox Tester
创建 `src/skill-factory/sandbox/local-tester.ts`：
- 在隔离环境跑 Spec 中的 testCases
- 隔离方式：
  - Web 阶段：服务端 Docker 沙箱（推荐 gVisor 或 firecracker）
  - 后续 Electron 阶段：本地 Node worker_threads + 资源限制
- 每个测试用例：
  - 限时 30 秒
  - 限内存 256MB
  - 不允许网络（除非显式允许）
- 收集：成功率、性能、token

## 任务 6：Stage 4b - LLM-as-Judge Eval
创建 `src/skill-factory/validators/llm-judge.ts`：
- 用 Claude Opus 评估技能：
  - 实用性（解决用户描述的问题吗？）
  - 健壮性（边界情况处理）
  - 安全性（无越权）
  - 文档质量
- 评分 0-10，<7 标记需要人工审查

## 任务 7：客户端段集成（LocalSkillFactory）
创建 `src/skill-factory/client.ts`：
- 串联 Stage 1-4a
- 通过即安装到 personal/ 目录（员工本地立即可用）
- 状态：'personal-draft'
- 提供「提交到企业」按钮触发服务端段

## 任务 8：服务端段集成（EnterpriseSkillFactory）
创建 `src/skill-factory/server.ts`（在 Skill Registry 服务）：
- 接收提交
- 重新跑 Stage 3b（Security）+ Stage 4a（Sandbox）+ Stage 4b（LLM Judge）
- 进入人工评审队列
- Reviewer 在 Admin Console 中处理
- 通过后进入灰度发布

## 任务 9：Stage 5 - Publish 流程
创建 `src/skill-factory/publisher.ts`：
- 注册到 Tool Registry
- 设置默认 RBAC 策略（按提交时声明的 scope）
- 加入 Skill Catalog
- 通知 owner & 申请人
- 灰度推送（5% → 100%）

## 任务 10：Skill 生命周期管理
实现 8 个状态：
- drafting / synthesizing / local-tested / pending-review /
- approved / active / deprecated / archived / quarantined
- 状态机迁移规则严格执行
- 所有迁移有审计

## 任务 11：Auto-Curator
创建 `src/skill-factory/auto-curator.ts`：
- 定时任务（每天凌晨）
- 分析每个 skill 的 30 天使用率
- 自动标记：企业精选 / 待优化 / 自动归档
- 负向反馈触发新一轮生成

## 任务 12：Skill Factory UI
在 Web 创建 /skills/factory 页面：
- 5 步可视化进度条
- 每步可返回修改
- 实时显示 LLM 生成过程（streaming）
- 测试结果可视化

## 任务 13：测试
- 端到端测试：从对话到上线全流程
- 安全扫描有效性测试（故意提交含漏洞代码）
- 沙箱逃逸测试（故意尝试越权）

## 任务 14：文档
- docs/skill-factory/architecture.md
- docs/skill-factory/lifecycle.md
- docs/skill-factory/security-model.md
- docs/skill-factory/user-guide.md

# ✅ 完成标准
- [ ] 5 阶段流水线全部上线
- [ ] 客户端段员工可自助创建（< 2 小时端到端）
- [ ] 服务端段评审流程完整
- [ ] 8 状态生命周期严格执行
- [ ] Auto-Curator 上线
- [ ] 端到端测试通过：10 个真实需求场景
- [ ] 安全扫描覆盖率高（故意制造的漏洞 100% 拦截）

# 🚫 明确不做
- ❌ 不要做技能商店付费机制
- ❌ 不要做技能跨租户共享（敏感技能必须 tenant-scoped）
- ❌ 不要做 IDE 插件
- ❌ 不要做技能市场 API（属于未来）

# 🧪 验证步骤
1. `npm test` 全绿
2. 端到端：员工对话「做一个查我们部门 GitHub PR 的技能」→ 创建 → 测试 → 提交 → 评审 → 上线
3. 安全测试：提交含 hardcoded key 的技能 → 应被拒绝
4. 性能测试：10 个并发创建任务 → 全部成功
5. Auto-Curator 模拟 30 天数据 → 自动归档低频技能

# 🎁 交付
PR 标题：`[refactor-v3/p9.5] Skill Factory 2.0：5 阶段流水线 + 双段协同`

# 📌 关键提示
- 这是 3 周 Phase，需要细分任务并行推进
- Skill 生成的 prompt 工程极其关键，需要多轮迭代
- 沙箱安全是底线，宁可严格也不要松
- 用户体验同样关键，员工不能因为复杂而放弃
```

---

# Phase 9.7：UI/UX Design System（2 周）

```
你是一名资深前端工程师 + UI 设计师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p9.7-design-system
- commit 以 [refactor-v3/p9.7] 开头

# 🎯 目标
建立完整设计系统，避免后续 UI 反复重做。这是 P10 Web MVP 的前置依赖。
2 周专项投入，做扎实，长期受益。

# 📋 前置条件
- [ ] Phase 9.5 已合入
- [ ] 产品经理已确认设计方向（参考方案 v3.1 第 8-11 章）
- [ ] 已有 Figma 账号或可用替代设计工具

# 🔨 任务清单

## 任务 1：建立 design 目录
```
masterBot/
├── design/
│   ├── tokens/
│   │   ├── color.ts
│   │   ├── typography.ts
│   │   ├── spacing.ts
│   │   ├── radius.ts
│   │   ├── shadow.ts
│   │   └── motion.ts
│   ├── themes/
│   │   ├── light.ts
│   │   ├── dark.ts
│   │   └── high-contrast.ts
│   └── README.md
```

## 任务 2：实现 Design Tokens
按照方案 v3.1 第 8.2 节，全量实现 tokens：
- Color：brand / surface / text / semantic / border
- Typography：font family / size / weight / line-height
- Spacing：8px 基础栅格
- Radius：none / sm / base / md / lg / xl / 2xl / full
- Shadow：subtle / soft / medium / strong
- Motion：duration / easing
- Component-specific tokens（button height、input height 等）

## 任务 3：三主题实现
- Light theme（默认）
- Dark theme
- High Contrast theme（WCAG AAA）
- 通过 CSS 变量 + data-theme 属性切换
- 主题切换无闪烁（synchronous + persist to localStorage）

## 任务 4：基础组件库（11 个）
基于 Radix UI primitives + Tailwind CSS 实现：
1. Button（4 variant × 3 size）
2. Input（text / search / textarea）
3. Select（单选 / 多选）
4. Checkbox / Radio / Switch
5. Dropdown
6. Tooltip
7. Popover
8. Toast（4 variant）
9. Modal / Drawer
10. Tabs
11. Avatar / Badge

每个组件：
- TypeScript 严格类型
- 支持 className 透传
- 支持 ref 透传
- 完整 a11y（ARIA）
- 三主题适配

## 任务 5：业务组件（10 个）
1. **ChatMessage**（用户/助手两种 variant）
   - 头像 + 内容 + 时间戳
   - 操作菜单（复制、重新生成、点踩）
   - 流式渲染支持
2. **ToolCallCard**（折叠式）
   - 状态图标（loading / success / error）
   - 入参 / 出参可展开
   - 一键复制
3. **ThinkingPanel**（思考过程展示）
   - 默认折叠
   - 展开显示 reasoning 文本
4. **HitLApprovalDialog**
   - 显示工具名 + 入参
   - 风险等级
   - 三按钮：Approve / Modify / Deny
   - 修改 payload 编辑器
5. **SkillCard**（技能市场卡片）
   - 图标 + 名称 + 描述
   - 使用量 + 评分
   - 操作按钮
6. **SkillFactoryWizard**（5 步向导）
   - 步骤指示器
   - 每步内容容器
   - 上一步 / 下一步 / 跳过 / 取消
7. **CommandPalette**（⌘K）
   - Cmdk 组件
   - 模糊搜索
   - 分组（最近 / 命令 / 技能）
8. **CitationLink**（引用链接）
   - 角标式标记
   - 点击展开来源
9. **StatusIndicator**（agent 状态）
   - idle / thinking / executing / waiting / error
   - 微动画
10. **ConnectorCard**（连接器卡片）

## 任务 6：布局组件（5 个）
1. Header
2. Sidebar
3. MainLayout
4. AuthLayout
5. EmptyState

## 任务 7：Storybook 集成
1. 安装 storybook（@storybook/react-vite）
2. 为每个组件写 stories
3. 包含：
   - Default story
   - 所有 variant
   - 边界情况（空状态、超长文本、错误状态）
   - 主题切换 demo
4. 部署到内部 GitHub Pages 或文档站

## 任务 8：可访问性测试
- 所有组件通过 axe-core 自动测试
- 键盘导航测试（Tab / Enter / Esc / 方向键）
- 屏幕阅读器测试（NVDA / VoiceOver）
- 色彩对比度测试（≥ WCAG AA）

## 任务 9：图标系统
- 使用 lucide-react（轻量 + 一致风格）
- 自定义图标用 SVG 组件封装
- 不引用外网 CDN

## 任务 10：字体策略
- 主字体：Inter + PingFang SC（系统字体优先）
- Mono：JetBrains Mono / SF Mono
- Display：Fraunces（仅大标题）
- 字体文件本地打包（不走 Google Fonts）

## 任务 11：文档
- design/README.md：设计系统总览
- design/CONTRIBUTING.md：如何新增组件
- 每个组件 .stories.tsx 文件即文档

## 任务 12：代码生成与维护
- 创建 npm scripts：
  - `npm run design:tokens` 生成 CSS 变量
  - `npm run storybook` 启动文档
  - `npm run design:test` 跑 a11y 测试

# ✅ 完成标准
- [ ] design tokens 完整体系
- [ ] 三主题可切换
- [ ] 基础 11 + 业务 10 + 布局 5 = 26 个组件
- [ ] Storybook 可用，每个组件至少 3 个 story
- [ ] 全部通过 a11y 测试
- [ ] 现有 npm test 不受影响
- [ ] Phase 8 的 Admin Console 改用新组件库（局部验证）

# 🚫 明确不做
- ❌ 不要重做现有 Web 页面（属于 Phase 10）
- ❌ 不要做动画库（lucide + 简单 CSS 动效即可）
- ❌ 不要造轮子，能用 Radix / shadcn 就直接用
- ❌ 不要做营销页（这是企业内部工具）

# 🧪 验证步骤
1. `npm test` 全绿
2. `npm run storybook` 启动并浏览所有组件
3. 切换三主题，UI 正确
4. 跑 a11y 测试，全部通过
5. Admin Console 用新组件后视觉一致

# 🎁 交付
PR 标题：`[refactor-v3/p9.7] UI/UX Design System：26 组件 + 三主题 + Storybook`

# 📌 关键提示
- 设计系统是基础设施，不要追求完美一次到位
- Radix UI 提供 a11y 基础，shadcn 提供样式范本，重点在 token 体系
- Storybook 是给后续工程师看的"使用手册"
- 每个组件先写 type + stories，再写 implementation（TDD 思想）
```

---
# Phase 10：Web 版 MVP（2 周）

```
你是一名资深前端工程师 + 全栈工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p10-web-mvp
- commit 以 [refactor-v3/p10] 开头

# 🎯 目标
基于 Phase 9.7 的设计系统，构建第一个员工真正能用的 Web 版本。
浏览器打开即可使用，跨平台（Win / macOS）天然兼容。
重要：Web 阶段所有数据存储在服务端，为 Electron 阶段（P13 起）的本地数据迁移做好抽象。

# 📋 前置条件
- [ ] Phase 9.7 已合入（设计系统可用）
- [ ] Phase 9.5 已合入（Skill Factory 可用）
- [ ] Phase 7 已合入（Channels）
- [ ] 现有 Next.js 16 项目可访问

# 🔨 任务清单

## 任务 1：Next.js 16 框架升级与配置
- 确认 Next.js 16 + App Router
- 配置 base path: /masterBot-static/（公司内网部署友好）
- 所有静态资源打包，不引用外网 CDN：
  - 字体本地化
  - 图标 lucide-react 本地
  - 移除任何 CDN 引用
- 配置 CSP allowFromIframe（飞书/钉钉嵌入）
- 启用 standalone output 模式（部署友好）

## 任务 2：建立 IStorageAdapter 抽象（关键）
创建 `src/storage/types.ts`：

```typescript
export interface IStorageAdapter {
  // 业务数据
  getSession(id: string): Promise<Session>;
  saveSession(s: Session): Promise<void>;
  listSessions(userId: string, limit: number): Promise<Session[]>;

  // 向量记忆
  searchMemory(query: string, k: number, tenantId: string): Promise<MemoryItem[]>;
  upsertMemory(item: MemoryItem, tenantId: string): Promise<void>;

  // 审计
  writeAudit(event: AuditEvent): Promise<void>;
  queryAudit(filter: AuditFilter): Promise<AuditEvent[]>;
}
```

实现 `src/storage/web-adapter.ts`：
- 所有方法走 HTTP API
- 这一层非常重要——Phase 13 会增加 ElectronStorageAdapter

## 任务 3：建立 IMcpClient 抽象
类似上面，创建 `src/mcp/types.ts` 和 `src/mcp/web-mcp-client.ts`：
- Web 阶段 MCP 调用走服务端
- listTools / callTool 等都通过 HTTP
- 服务端在自己的进程里管理 stdio MCP 子进程

## 任务 4：Login 页（SSO）
创建 `web/src/app/auth/login/page.tsx`：
- 使用 P9.7 的 AuthLayout 组件
- 用 Phase 2.5 的 SSO 流程
- "用公司账号登录" 按钮
- 可选：支持本地开发模式（mock 用户，仅在 dev 环境）
- Loading 与错误状态

## 任务 5：Chat 主页面
创建 `web/src/app/(main)/chat/page.tsx`：
- 使用 P9.7 的 MainLayout + Sidebar + Header
- 主区域：消息流 + 输入框
- 消息流：
  - 使用 ChatMessage 组件
  - 流式渲染（AG-UI 协议）
  - 自动滚动到底（除非用户手动向上滚）
- 输入框：
  - 多行自适应
  - / 触发技能选择
  - @ 触发 subagent 选择
  - 文件附件
  - Cmd+Enter 发送
- Tool Call 展示：
  - 使用 ToolCallCard 组件
  - 实时状态更新
- HitL 审批：
  - 使用 HitLApprovalDialog 组件
  - 三按钮：Approve / Modify / Deny

## 任务 6：AG-UI 协议集成
创建 `web/src/lib/agui-runtime.ts`：
- 替换之前的 assistant-runtime
- 使用 @ag-ui/client（如有）或自己实现 AG-UI events 解析
- 支持事件类型：
  - text_message_start / text_message_chunk / text_message_end
  - tool_call_start / tool_call_chunk / tool_call_end
  - thinking_start / thinking_chunk / thinking_end
  - state_update
  - human_in_the_loop_request

后端 API `/api/chat/stream` 输出 AG-UI 格式的 SSE 流。

## 任务 7：Skill Catalog 页面
创建 `web/src/app/(main)/skills/page.tsx`：
- 使用 SkillCard 组件展示卡片瀑布流
- 筛选 tabs：全部 / 我的 / 部门 / 推荐
- 排序：使用率 / 最新 / 评分
- 搜索框
- 点击卡片 → 详情侧栏（展示 SKILL.md 完整内容）
- 「使用」按钮 → 在 Chat 页面用 / 触发该技能

## 任务 8：Skill Factory 页面
创建 `web/src/app/(main)/skills/factory/page.tsx`：
- 使用 SkillFactoryWizard 组件
- 5 步：Understand → Synthesize → Verify → Eval → Publish
- 每步与 P9.5 的服务端 API 对接
- 实时显示生成过程
- 最后选择「保存为个人」或「提交到企业」

## 任务 9：History 历史对话
创建 `web/src/app/(main)/history/page.tsx`：
- 列表：按日期分组
- 每条显示：标题、时间、消息数、最近消息预览
- 点击进入详情（同 Chat 页面但 readonly）
- 操作：归档、删除（软删除）、导出
- 分页

## 任务 10：Settings 设置
创建 `web/src/app/(main)/settings/page.tsx`：
- 个人偏好：
  - 主题切换（亮 / 暗 / 高对比度）
  - 默认模型选择
  - 语言（中文 / 英文）
- 通知设置
- 已连接的 IM 渠道
- API token（仅高级用户）
- 数据导出 / 删除

## 任务 11：响应式适配
- 桌面（≥ 1024px）：侧栏 + 主区
- 平板（768-1023px）：折叠侧栏
- 手机（< 768px）：全屏切换
- 测试 iPad / iPhone Safari

## 任务 12：Service Worker（基础离线）
创建 `web/public/sw.js`：
- 缓存：
  - 静态资源（HTML / CSS / JS）
  - 已加载过的对话历史
- 离线时：
  - 可查看历史对话
  - 提示"网络不可用，仅可查看历史"
- 注意：不缓存敏感数据（PII / 凭据）

## 任务 13：性能优化
- 代码分割（route-level + component-level）
- 图片懒加载
- 关键 CSS inline
- 首屏 < 2 秒（本地网络）
- LCP < 2.5s, FID < 100ms, CLS < 0.1（Web Vitals）

## 任务 14：用户引导（onboarding）
首次登录的员工：
- 弹出 5 步引导：
  1. 主对话区使用方法
  2. / 选择技能
  3. ⌘K 命令面板
  4. 创建你的第一个技能
  5. 历史与设置
- 一次性，可跳过

## 任务 15：错误边界
- React Error Boundary 包裹关键模块
- 全局错误页（500）
- 网络错误友好提示
- 与 Sentry / Langfuse 集成上报

## 任务 16：测试
- 端到端测试（Playwright）：
  - 登录 → 对话 → 工具调用 → HitL 审批
  - 创建技能完整流程
  - 历史查询
- 跨浏览器测试：Chrome / Edge / Safari
- 跨平台测试：Windows 10/11、macOS 13/14

## 任务 17：文档
- docs/web/architecture.md
- docs/web/deployment.md（部署到公司内网）
- docs/web/development.md（本地开发指南）

# ✅ 完成标准
- [ ] 5 个核心页面全部实现（Login、Chat、Skill Catalog、Factory、History、Settings）
- [ ] AG-UI 协议正常工作
- [ ] Storage Adapter / MCP Adapter 抽象到位
- [ ] 跨浏览器测试通过
- [ ] 跨平台（Win+macOS）测试通过
- [ ] 性能指标达标（Web Vitals）
- [ ] 现有 npm test 全部通过
- [ ] capability eval 不退化
- [ ] 内部 demo 通过

# 🚫 明确不做
- ❌ 不要做 Electron 打包（属于 Phase 13-14）
- ❌ 不要做 Admin Console 重设计（已在 P8，后续 P9.7 风格统一）
- ❌ 不要做精细动画（performant 比 fancy 重要）
- ❌ 不要做语音输入（属于未来）
- ❌ 不要引用任何外网 CDN（关键约束）

# 🧪 验证步骤
1. `npm test` 全绿
2. `npm run build` 成功，bundle 大小合理
3. `npm run dev` 启动，浏览器打开
4. 走通完整登录 → 对话 → 创建技能流程
5. 在 Win + Edge / Win + Chrome / macOS + Safari / macOS + Chrome 全部测试
6. Lighthouse 性能审计 ≥ 90 分
7. 检查 Network 面板：无任何外网请求

# 🎁 交付
PR 标题：`[refactor-v3/p10] Web 版 MVP：5 个核心页面 + AG-UI 集成`

# 📌 关键提示
- 这是产品的"第一面"，员工对 masterBot 的第一印象就在这里
- 严格使用 P9.7 的 Design System，不要造新组件
- Storage Adapter 与 MCP Adapter 的抽象一定要做好——Phase 13 复用关键
- 不要把 SDK 直接暴露给 Web 客户端，所有 LLM 调用经服务端
```

---

# Phase 11：Web 版灰度上线（2 周）

```
你是一名资深 SRE + 产品工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p11-web-rollout
- commit 以 [refactor-v3/p11] 开头

# 🎯 目标
把 Phase 10 的 Web MVP 真正部署到公司内网，让员工开始用。
做好灰度策略与反馈收集机制，建立产品迭代节奏。

# 📋 前置条件
- [ ] Phase 10 已合入并通过内部 demo
- [ ] 公司 IT 部门已分配：服务器资源、域名、SSL 证书
- [ ] LLM Gateway 已部署（公司中心服务）
- [ ] SSO IdP 已配置好 OAuth client

# 🔨 任务清单

## 任务 1：部署架构搭建
创建 `deploy/web/`：
- docker-compose.yml（开发 / staging）
- k8s/（生产，可选）
- 包含服务：
  - masterbot-web（Next.js standalone）
  - masterbot-api（核心 agent 服务）
  - masterbot-skill-registry
  - postgres（业务数据）
  - duckdb 实例（向量记忆）
  - redis（缓存 + 会话）
  - clickhouse（审计日志）

## 任务 2：nginx 反向代理配置
创建 `deploy/web/nginx.conf`：
- TLS 终止（公司证书）
- 静态资源缓存（hash 文件名长缓存）
- API 路径反代到后端
- WebSocket / SSE 长连接支持
- gzip / brotli 压缩
- 安全头（HSTS / CSP / X-Frame-Options 等）

## 任务 3：域名与 SSL
- 配置内网域名：aibot.corp.com（按公司实际）
- HTTPS 证书（公司内部 CA 或 Let's Encrypt 内部版）
- DNS 内网解析
- 验证：员工 PC / Mac 能解析并访问

## 任务 4：环境配置
建立三套环境：
- dev：开发者本地
- staging：内部测试
- production：员工真实使用

每套环境配置：
- LLM Gateway URL
- IdP OAuth client
- 数据库连接
- Langfuse exporter
- Skill Registry URL

## 任务 5：CI/CD 流水线
创建 `.github/workflows/web-deploy.yml`：
- 触发：refactor/v3 分支 push
- 流程：
  1. 跑测试
  2. 跑 capability eval
  3. 构建 Docker 镜像
  4. 推送到公司 Harbor
  5. 部署到 staging（自动）
  6. 通过审批后部署到 production（手动）
- 蓝绿部署（保留上个版本，方便回滚）

## 任务 6：FeatureFlag 灰度配置
基于 Phase 9 的 Canary 系统：
- 创建 web-version flag
- 阶段：alpha (5%) → beta (25%) → stable (100%)
- 阶段间观察 24-72h
- 异常自动回滚

## 任务 7：用户引流入口
- 公司内部门户首页加入口（"AI 助手"按钮）
- 邮件签名/邮件群发（可选）
- 飞书/钉钉首页 widget
- IM 中可 @AI 助手开始对话

## 任务 8：内测群（10 人）
- 选 10 名核心用户（不同部门、不同岗位）
- 创建专属支持群（飞书 / Slack）
- 每周收集反馈
- 第 1 周专注：可用性、SSO、对话流畅度

## 任务 9：反馈收集机制
应用内反馈：
- 每条 agent 回复下方有 👍 / 👎 按钮
- 点 👎 弹出反馈表单：
  - 问题类型（不准确 / 太慢 / 误用工具 / 其他）
  - 描述
  - 是否允许联系
- 数据写入 `feedback` 表，关联到 trace_id

意见箱：
- 全局反馈入口（侧栏底部）
- 一键截图 + 表单提交

## 任务 10：实时监控
建立 dashboard（Grafana 或 Langfuse）：
- 在线用户数
- 平均响应时延
- 错误率
- TopN 调用最多的技能
- TopN 失败最多的工具
- LLM 成本累计

异常告警（PagerDuty / 飞书机器人）：
- 错误率 > 5%
- 响应时延 P95 > 10s
- LLM Gateway 不可用
- DB 连接异常

## 任务 11：用户引导优化
基于 Phase 10 的 onboarding：
- 增加视频教程（2 分钟）
- FAQ 文档
- 公司内部 wiki 页面

## 任务 12：扩大灰度
- Week 1：内测群 10 人
- Week 2：扩展到 1 个部门 50 人
- Week 3：3 个部门 200 人
- Week 4：全员可用（按需开通）

每个阶段：
- 收集 NPS（0-10 评分）
- 目标 NPS ≥ 40
- 不达标则修复后再扩展

## 任务 13：性能监控
Real User Monitoring（RUM）：
- Web Vitals 真实数据
- 按地理 / 设备 / 浏览器分布
- 慢请求 TopN

## 任务 14：客服与支持
- 内部 IT 支持流程：
  - 一级：自助文档 / FAQ
  - 二级：内部 IT 帮助台
  - 三级：研发团队（仅复杂问题）
- SLA：响应 < 4h，解决 < 1 工作日

## 任务 15：文档
- docs/web/operations.md（运维手册）
- docs/web/troubleshooting.md（故障排查）
- docs/web/release-notes-1.0.md
- 用户手册：内部 wiki

# ✅ 完成标准
- [ ] 三套环境（dev/staging/prod）部署完成
- [ ] CI/CD 流水线工作
- [ ] aibot.corp.com 可访问
- [ ] 内测 10 人完成
- [ ] 灰度扩展到全员
- [ ] NPS ≥ 40
- [ ] 监控仪表盘上线
- [ ] 反馈机制工作
- [ ] 现有 npm test 全部通过

# 🚫 明确不做
- ❌ 不要在生产环境跑 dev 配置
- ❌ 不要绕过灰度直接全量
- ❌ 不要忽视监控告警
- ❌ 不要做 Electron 相关工作（属于 Phase 13+）

# 🧪 验证步骤
1. 全公司员工用真实账号登录测试
2. 检查 Lighthouse 性能 ≥ 90
3. 高峰期压力测试（200 并发）
4. SSO 集成测试（多次登录登出）
5. 飞书/钉钉嵌入测试

# 🎁 交付
PR 标题：`[refactor-v3/p11] Web 版灰度上线：MVP → 全员可用`

# 📌 关键提示
- 这是产品价值的关键一步，从代码到员工手上
- 灰度不可省略，宁可慢也不要全量翻车
- 反馈收集机制要在 Week 1 就建立，否则错过早期黄金窗口
- 监控告警可以省钱，宕机一小时损失更大
```

---

# Phase 12：Web 版迭代运营（持续）

```
你是一名资深产品工程师 + 数据工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 持续 Phase，每次迭代独立分支：refactor/v3/p12-iter-<sprint>
- commit 以 [refactor-v3/p12] 开头
- 单次迭代周期：2 周

# 🎯 目标
基于真实生产数据持续迭代 Web 版，建立"双周迭代节奏"。
每次迭代有明确目标 + 数据驱动决策。

# 📋 前置条件
- [ ] Phase 11 已上线
- [ ] 反馈机制有数据
- [ ] 监控仪表盘运行
- [ ] capability eval 套件持续运行

# 🔨 任务清单（按双周迭代）

## 迭代 1：稳定性专项（Week 1-2）
重点修 bug，不加新功能。
- 收集 P11 上线后的所有反馈
- 按严重度分类：P0 (阻塞) / P1 (体验差) / P2 (优化)
- 修完所有 P0、80% P1
- 写一份 release notes

## 迭代 2：性能优化（Week 3-4）
- 慢请求 TopN 分析
- 数据库索引优化
- LLM 调用 prompt 缓存
- 前端打包优化（splitChunks）
- 目标：P95 响应时延降低 30%

## 迭代 3：用户体验提升（Week 5-6）
基于 NPS 反馈：
- TopN 痛点修复
- A/B 测试关键 UI 改动
- 引导流程优化
- 微互动改进（hover / focus / loading）

## 迭代 4：技能扩展（Week 7-8）
- TopN 缺失的技能（基于"未能完成"的对话分析）
- 鼓励员工提交个人技能
- 优秀技能推广（"本周精选"）

## 迭代 5：成本优化（Week 9-10）
- 成本看板分析
- 高成本对话模式识别
- 优化策略：
  - 简单问题路由到 Haiku
  - 复杂问题用 Opus
  - Subagent 委派降低主线 token
- 目标：单次对话平均成本降低 20%

## 迭代 6+：持续优化
按数据驱动决策。

# 通用任务（每次迭代必做）

## 数据分析
- 跑数据分析脚本：
  - 周 / 月活跃用户
  - 技能调用排行
  - 失败模式聚类
  - 用户旅程漏斗
- 输出每周报告

## A/B 测试
- 关键改动用 FeatureFlag 灰度
- 对比指标
- 数据决策（不是凭感觉）

## Capability Eval 持续补充
- 每次迭代新增 5-10 个用例
- 失败案例转化为测试

## 用户访谈
- 每月 5 个用户深度访谈
- 不同部门 / 角色
- 写访谈纪要

## Release Cadence
- 每两周一个版本
- 周一冻结代码
- 周二 staging
- 周三-四观察
- 周五 production

# ✅ 单次迭代完成标准
- [ ] 迭代目标达成（量化指标）
- [ ] 现有 npm test 全部通过
- [ ] capability eval 不退化
- [ ] Release notes 完成
- [ ] 用户反馈良好（NPS 不下降）

# 🚫 明确不做
- ❌ 不要为了 fancy 而加功能
- ❌ 不要忽视小 bug（积累成大问题）
- ❌ 不要做需要数月的大改造（拆小）
- ❌ 不要在迭代中混入 Electron 相关工作

# 🧪 验证步骤（每次迭代）
1. `npm test` 全绿
2. capability eval 通过率 ≥ 99%
3. 真实用户测试新功能
4. 监控指标稳定
5. NPS 调研

# 🎁 交付
每次迭代 PR 标题：`[refactor-v3/p12-iter-N] <主题>`

# 📌 关键提示
- 数据驱动 > 直觉驱动
- 用户反馈是最佳路标
- 不要在 Web 阶段做太多（留给 Electron 阶段）
- 保持 Web 版长期可用，不要在 Electron 上线后下线 Web
```

---
# Phase 13：Electron 准备 + 适配（1 周）

```
你是一名资深 Electron 工程师 + 全栈工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p13-electron-prep
- commit 以 [refactor-v3/p13] 开头

# 🎯 目标
为 Electron 阶段做技术准备，建立 Electron 工程基础。
确保 Web 阶段 95% 代码在 Electron 阶段直接复用，仅 5% 是 Electron 特有逻辑。

# 📋 前置条件
- [ ] Phase 12 已稳定运营 ≥ 4 周
- [ ] Web 版 NPS ≥ 50
- [ ] Storage Adapter / MCP Adapter 抽象稳定
- [ ] 已与 IT 部门确认：代码签名证书 / MDM 推送渠道 / 内部下载页

# 🔨 任务清单

## 任务 1：引入 Electron 36 + electron-builder
- npm install --save-dev electron@36 electron-builder
- 锁定具体版本到 package.json
- 在 docs/adr/0010-electron-version-lock.md 记录原因

## 任务 2：建立 electron/ 目录结构
```
masterBot/
├── electron/
│   ├── main.ts                  # 主进程入口
│   ├── preload.ts               # Preload 脚本
│   ├── ipc-handlers.ts          # IPC 通信
│   ├── menu.ts                  # 应用菜单
│   ├── tray.ts                  # 系统托盘
│   ├── window-manager.ts        # 窗口管理
│   ├── auto-updater.ts          # 自动更新（Phase 15 实现）
│   ├── platform/
│   │   ├── macos.ts             # macOS 特定逻辑
│   │   └── windows.ts           # Windows 特定逻辑
│   └── tsconfig.json
```

## 任务 3：主进程基础架构
创建 `electron/main.ts`：
- 单实例锁（避免多开）
- 创建主窗口（默认尺寸 1400x900，最小 1024x768）
- 加载 Web 内容（dev 时连 localhost，prod 时加载本地文件）
- 关闭行为：macOS 隐藏到 dock，Windows 关闭即退出
- 全局 IPC handler 注册
- 错误处理（uncaughtException）

## 任务 4：Preload 脚本与 contextBridge
创建 `electron/preload.ts`：
- 使用 contextBridge.exposeInMainWorld
- 暴露最小 API surface 到 Renderer：
  - window.electronAPI.storage（本地存储相关）
  - window.electronAPI.mcp（本地 MCP 调用）
  - window.electronAPI.system（系统信息）
  - window.electronAPI.notification（系统通知）
- ⚠️ 严格不暴露 Node.js 全局对象（contextIsolation: true）

## 任务 5：IPC 协议定义
创建 `electron/ipc/types.ts`：
- 所有 IPC 通信用强类型
- 请求 / 响应模型
- 错误处理标准化

## 任务 6：实现 ElectronStorageAdapter
创建 `src/storage/electron-adapter.ts`：

```typescript
export class ElectronStorageAdapter implements IStorageAdapter {
  // 本地优先 + 云同步策略
  async getSession(id: string) {
    const local = await this.localDb.getSession(id);
    if (local) return local;
    const remote = await this.apiClient.get(`/api/sessions/${id}`);
    await this.localDb.saveSession(remote);
    return remote;
  }
  // ...
}
```

注意：
- 关键：实现 IStorageAdapter 接口（与 WebStorageAdapter 相同）
- 业务代码不感知底层是 Web 还是 Electron
- 本地缓存优先，远程作为持久化备份

## 任务 7：实现 ElectronMcpClient
创建 `src/mcp/electron-mcp-client.ts`：
- 直接 spawn 子进程（不经过服务端）
- 这是 Electron 阶段的关键能力升级
- 子进程管理（启动、健康检查、清理）

## 任务 8：跨平台工具类
创建 `src/platform/`：
- paths.ts：跨平台路径
- env.ts：跨平台环境变量
- shell.ts：跨平台 shell 调用
- 全部使用 Node 标准 API（避免硬编码）

参考方案 v3.1 第 3.4 节实现细节。

## 任务 9：构建配置（electron-builder）
创建 `electron-builder.yml`：

```yaml
appId: com.corp.masterbot
productName: masterBot
copyright: Copyright © 2026 ${author}

directories:
  output: dist-electron
  buildResources: build

files:
  - electron/**/*
  - src/**/*
  - web/.next/**/*
  - package.json

asar: true
asarUnpack:
  - "**/*.node"
  - "node_modules/@anthropic-ai/claude-agent-sdk/**"

mac:
  category: public.app-category.productivity
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  notarize:
    teamId: "${APPLE_TEAM_ID}"
  target:
    - target: dmg
      arch: [universal]
    - target: zip
      arch: [universal]

win:
  target:
    - target: nsis
      arch: [x64]
    - target: msi
      arch: [x64]

nsis:
  oneClick: false
  perMachine: false
  allowElevation: true
  allowToChangeInstallationDirectory: true
  installerLanguages: [en_US, zh_CN]

msi:
  oneClick: false
  perMachine: true
  upgradeCode: '...uuid...'   # 必须保持稳定
```

## 任务 10：开发模式启动脚本
更新 `package.json` scripts：
- `dev:electron` 同时启动 Next.js dev server + Electron
- `build:electron:mac` 构建 macOS 版本
- `build:electron:win` 构建 Windows 版本
- `build:electron` 构建当前平台

## 任务 11：本地数据库初始化
- 在 Electron 阶段，第一次启动时：
  - 创建 userData/ 目录结构
  - 初始化 SQLite (core.db)
  - 初始化 DuckDB (vectors.duckdb)
  - 初始化审计 SQLite (audit.db)
- 数据库迁移机制（schema 版本管理）

## 任务 12：跨平台测试
- 在 macOS 13 / 14 / 15 测试 dev 启动
- 在 Windows 10 22H2 / 11 23H2 测试 dev 启动
- 检查路径、IPC、子进程都正常

## 任务 13：本地能跑的 Electron Dev 版
关键里程碑：能 `npm run dev:electron` 本地跑起来，看到与 Web 版一样的 UI。

## 任务 14：文档
- docs/electron/architecture.md
- docs/electron/development.md（开发指南）
- docs/electron/cross-platform.md（跨平台注意事项）

# ✅ 完成标准
- [ ] electron/ 目录结构完成
- [ ] Main + Renderer + Preload 三进程架构
- [ ] ElectronStorageAdapter 实现并通过测试
- [ ] ElectronMcpClient 实现并通过测试
- [ ] electron-builder.yml 完整配置
- [ ] 在 macOS 和 Windows 上都能 `npm run dev:electron` 启动
- [ ] 与 Web 版功能一致（仅 5% 差异）
- [ ] 现有 npm test 全部通过

# 🚫 明确不做
- ❌ 不要做生产打包（属于 Phase 14）
- ❌ 不要做代码签名（属于 Phase 14）
- ❌ 不要做自动更新（属于 Phase 15）
- ❌ 不要破坏 Web 版（仍持续运行）

# 🧪 验证步骤
1. `npm test` 全绿
2. macOS 上 `npm run dev:electron` 启动成功
3. Windows 上 `npm run dev:electron` 启动成功
4. 检查 IPC 通信正常
5. 检查本地数据库初始化
6. UI 与 Web 版视觉一致

# 🎁 交付
PR 标题：`[refactor-v3/p13] Electron 准备：工程基础 + Adapter 切换`

# 📌 关键提示
- Phase 10 设计的抽象层在这里验证价值
- 千万不要为了 Electron 重写业务逻辑
- 跨平台测试必须早做、多做
- 这一周的目标是"能跑起来"，不是"能发布"
```

---

# Phase 14：Electron 打包（macOS+Windows）（2 周）

```
你是一名资深 Electron 工程师 + DevOps 工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p14-electron-package
- commit 以 [refactor-v3/p14] 开头

# 🎯 目标
生产可分发的桌面应用：
- macOS：DMG + ZIP，签名 + 公证
- Windows：MSI + EXE，EV 签名
- 关键约束：Windows 内网零依赖（参考方案 v3.1 第 4 章）

# 📋 前置条件
- [ ] Phase 13 已合入（Electron Dev 版可跑）
- [ ] Apple Developer ID 证书已申请
- [ ] Windows EV Code Signing 证书已申请
- [ ] 公司内部 CI 服务器已配置（macOS Runner + Windows Runner）

# 🔨 任务清单

## 任务 1：macOS 构建管线
更新 `electron-builder.yml`：
- Universal Binary（x64 + arm64）
- 构建产物：DMG（首次安装）+ ZIP（auto-updater）
- DMG 背景图、icon、布局

创建 `build/entitlements.mac.plist`：
- com.apple.security.cs.allow-jit
- com.apple.security.cs.allow-unsigned-executable-memory
- com.apple.security.network.client
- 其他必要权限

## 任务 2：macOS 代码签名
- 配置 Apple Developer ID Application 证书
- electron-builder 自动签名
- 验证 `codesign -dv --verbose=4 masterBot.app`
- 验证签名链完整

## 任务 3：macOS 公证（Notarization）
关键步骤，未公证的应用 Gatekeeper 不放行：
- 配置 notarytool（推荐，比 altool 快）
- 在 CI 中：
  ```bash
  xcrun notarytool submit dist/*.dmg \
    --keychain-profile "AC_PASSWORD" \
    --wait
  ```
- 公证后 staple：
  ```bash
  xcrun stapler staple dist/*.dmg
  ```
- 验证：在干净 macOS 上双击安装无警告

## 任务 4：Windows 构建管线
更新 `electron-builder.yml` Windows 部分：
- nsis（个人安装）+ msi（SCCM 推送）双格式
- per-user 模式（无需管理员）
- 自定义安装路径选项
- 卸载脚本完整（清理注册表、AppData）

## 任务 5：Windows 代码签名（EV 证书）
- 配置 EV 证书（HSM 或文件）
- electron-builder 调用 signtool 自动签名
- ⚠️ EV 证书避免 SmartScreen 警告（必须）
- 验证：在干净 Windows 10/11 上下载 + 双击 + 启动无警告

## 任务 6：Windows 内网零依赖（核心）
参考方案 v3.1 第 4 章：
- 验证应用启动后无任何外网请求（开发者工具 Network 面板）
- 所有静态资源走本地 file:// 或公司 CDN
- 字体本地打包
- 不依赖 WebView2 运行时（Electron 自带 Chromium）
- 不依赖 .NET（Electron 用 Node）
- VC++ Runtime（如必需）：嵌入到安装包

## 任务 7：MSI 包配置
针对 SCCM 部署：
- upgradeCode 必须稳定（同一应用不变，否则升级失败）
- per-machine 安装
- 静默安装支持：`msiexec /i masterBot.msi /quiet`
- 静默卸载：`msiexec /x masterBot.msi /quiet`
- 与 IT 部门联调

## 任务 8：系统托盘
创建 `electron/tray.ts`：
- macOS：菜单栏图标（templateImage）
- Windows：系统托盘图标
- 右键菜单：打开主窗口 / 状态 / 设置 / 退出
- 关闭主窗口时隐藏到托盘（macOS 习惯）

## 任务 9：全局快捷键
创建 `electron/shortcuts.ts`：
- macOS：⌘+Shift+Space 呼出
- Windows：Ctrl+Shift+Space 呼出
- 可在设置中自定义
- 冲突检测（避免与系统快捷键冲突）

## 任务 10：系统通知
创建 `src/notification/system.ts`：
- macOS：用 Notification API（Notification Center）
- Windows：Windows Toast Notification
- 通知用途：HitL 审批、长任务完成、错误告警
- 点击通知 → 打开主窗口聚焦相关消息

## 任务 11：自启动选项
- 在设置页面：「开机自启」开关
- macOS：使用 LaunchAgent
- Windows：使用注册表 Run 键
- 默认关闭（员工同意后开启）

## 任务 12：启动性能优化
目标：< 2 秒启动
- 主窗口先显示加载屏，异步加载内容
- 数据库连接懒加载
- IPC handler 懒注册
- V8 snapshot 加速（如适用）

测试：
- 冷启动时间（首次）
- 热启动时间（已运行）
- 不同硬件配置（i5 / i7 / M1 / M2）

## 任务 13：资源占用优化
目标：idle < 200MB RAM, < 5% CPU
- V8 堆限制：`--max-old-space-size=512`
- 后台时降级（暂停非紧急任务）
- 关闭不必要的后台服务

## 任务 14：跨平台 CI 配置
更新 `.github/workflows/build-electron.yml`：

```yaml
jobs:
  build-mac:
    runs-on: macos-14  # 公司自托管或 GitHub
    steps:
      - 检出代码
      - 安装依赖（公司 Nexus）
      - 构建 + 签名 + 公证
      - 上传 artifact

  build-win:
    runs-on: windows-2022  # 公司自托管
    steps:
      - 检出代码
      - 安装依赖
      - 构建 + EV 签名
      - 上传 artifact
```

## 任务 15：构建 artifact 发布
- 上传到公司内部 OSS / Nexus
- 内部下载页：download.corp.com/masterBot
- 文件命名规范：masterBot-1.0.0-mac-universal.dmg、masterBot-1.0.0-win-x64.msi 等

## 任务 16：跨平台测试矩阵
按方案 v3.1 第 3.6 节执行完整测试：
- macOS 13 / 14 / 15 × Safari / Chrome
- Windows 10 22H2 / 11 23H2 / Server 2022

每个组合测试：
- SSO 登录
- 技能调用
- 文件操作
- HitL 审批
- 通知
- 系统托盘
- 全局快捷键
- 自动更新（虚拟）

## 任务 17：安装/卸载完整性测试
- 安装后 ✓ 应用图标出现
- 安装后 ✓ 启动菜单可见
- 卸载后 ✓ 注册表清理
- 卸载后 ✓ AppData 可选保留 / 清理
- 重装升级 ✓ 数据保留

## 任务 18：文档
- docs/electron/build.md（构建指南）
- docs/electron/signing.md（签名流程）
- docs/electron/distribution.md（分发流程）
- docs/electron/troubleshooting.md（故障排查）
- 用户安装手册（内部 wiki）

# ✅ 完成标准
- [ ] macOS DMG 安装包通过 Gatekeeper
- [ ] Windows MSI + EXE 通过 SmartScreen（EV 证书生效）
- [ ] 跨平台测试矩阵全通过
- [ ] 启动 < 2 秒
- [ ] idle < 200MB
- [ ] CI 自动构建 + 签名 + 公证
- [ ] 安装/卸载完整性
- [ ] Windows 内网零依赖（启动无外网请求）
- [ ] 现有 npm test 全部通过

# 🚫 明确不做
- ❌ 不要发布到 Mac App Store / Microsoft Store（企业内部使用）
- ❌ 不要做 Linux 版本（按需后续）
- ❌ 不要做 ARM Windows 版本（按需后续）
- ❌ 不要做自动更新（属于 Phase 15）

# 🧪 验证步骤
1. 在干净 macOS 上下载 DMG → 拖拽安装 → 启动 → 无警告
2. 在干净 Windows 10 上下载 EXE → 安装 → 启动 → 无 SmartScreen 警告
3. 通过 SCCM 推送 MSI → 验证静默安装
4. 全平台跑完整功能流程
5. 性能测量达标
6. Network 面板检查零外网请求

# 🎁 交付
PR 标题：`[refactor-v3/p14] Electron 打包：macOS+Windows 双端可分发`

# 📌 关键提示
- 代码签名是必须的，省不掉
- macOS 公证流程慢（5-30 分钟），CI 需要适配
- Windows EV 证书贵但必要（避免无数 SmartScreen 警告）
- 公司 IT 部门可能要求白名单，提前沟通
- Windows 内网零依赖是底线，构建机也要离线能跑
```

---

# Phase 15：三轨升级体系（3 周）

```
你是一名资深 Electron 工程师 + DevOps 工程师，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 工作分支：refactor/v3/p15-three-track-update
- commit 以 [refactor-v3/p15] 开头

# 🎯 目标
建立完整的三轨升级体系（参考方案 v3.0 第 8 章）：
- Track 1：应用本体（4-6 周一次，灰度）
- Track 2：技能（随时同步）
- Track 3：配置/策略（即时热更新）
本地分发模式最难的环节，3 周时间。

# 📋 前置条件
- [ ] Phase 14 已合入（Electron 可分发）
- [ ] 公司更新服务器已部署
- [ ] 签名证书可用

# 🔨 任务清单（按 Track 拆分）

## ─── Track 1：应用本体升级（Week 1）───

### 任务 1.1：electron-updater 集成
更新 `electron/auto-updater.ts`：
- 引入 electron-updater
- 配置 setFeedURL：
  ```typescript
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: `https://updates.corp.com/masterBot/${channel}/`,
    channel: this.getUserChannel(),
  });
  ```

### 任务 1.2：分阶段灰度
按方案 v3.0 第 8.2 节实现：
- alpha (5%) / beta (25%) / stable (70%)
- 用户分桶：simpleHash(userId) % 100
- 通道由服务端配置控制

### 任务 1.3：差分更新
- 启用 differentialDownload（仅下载变化部分）
- 实测节省带宽
- 失败回退到完整下载

### 任务 1.4：强制升级
- 服务端配置 minVersion
- 启动时检查，低于 minVersion 强制升级
- 用于修复关键安全漏洞

### 任务 1.5：启动失败回滚
- 启动器记录"上次成功版本"
- 连续失败 2 次自动回退
- 用户可手动选择"使用上一版本"

### 任务 1.6：更新服务器
部署 `services/update-server/`：
- Fastify 服务
- 路径：/updates/{channel}/latest.yml + /updates/{channel}/{version}/{platform}
- 静态文件 + 鉴权（仅公司员工可下载）
- CDN 缓存（公司 OSS）

## ─── Track 2：Skill Sync 引擎（Week 2）───

### 任务 2.1：Skill Manifest 协议
创建 `src/skills/sync/manifest.ts`：
- 实现方案 v3.0 第 7.5 节定义的 Manifest 格式
- 服务端签名 + 客户端验证

### 任务 2.2：SkillSyncEngine 客户端
创建 `src/skills/sync/engine.ts`：
- 启动时同步一次
- 每小时增量轮询
- 用户主动「刷新技能」按钮
- 离线时使用本地最新版

### 任务 2.3：原子安装与回滚
按方案 v3.0 第 8.3 节实现：
- 下载到临时目录
- 验证签名
- 静态校验
- 原子切换：`*.next` / `*.prev`
- 7 天回滚窗口

### 任务 2.4：服务端 Skill Registry API
扩展 Phase 9.5 已有的 Registry 服务：
- GET /api/skills/manifest
- GET /api/skills/{id}/{version}
- 灰度推送支持（rolloutPercentage）

### 任务 2.5：Quarantine 紧急停用
- 服务端发布 Quarantine 指令
- 客户端立即禁用受影响技能
- 不需要重启
- 关键安全机制

### 任务 2.6：Skill Sync UI
在设置页面：
- "技能同步状态"指示器
- 上次同步时间
- 待更新数量
- 手动刷新按钮
- 同步历史日志

## ─── Track 3：配置热更新（Week 3）───

### 任务 3.1：ConfigPoller 客户端
创建 `src/config/poller.ts`：
- 每 5 分钟轮询一次
- ETag 支持（仅当变化时下载）
- 验证服务端签名
- 应用配置：
  - Agent 参数（maxIterations、model）
  - 权限策略（deny/allow rules）
  - Guardrails 规则
  - FeatureFlag

### 任务 3.2：服务端 Config Center
部署 `services/config-center/`：
- Fastify 服务
- 路径：/api/config/policy + /api/config/features
- 配置管理 UI（基于 Admin Console）
- 配置历史 + 一键回滚

### 任务 3.3：策略文件签名服务
按方案 v3.0 第 9.5 节：
- 服务端用私钥签名 policy.json
- 客户端用公钥（编译进应用）验证
- 过期机制（默认 7 天）
- 防员工绕过

### 任务 3.4：配置应用机制
- 客户端拉到新配置后：
  - 验证签名
  - 验证版本递增
  - 应用到运行时（不重启）
  - 通知 UI 更新

### 任务 3.5：失败降级
- 如果配置解析失败，使用上次成功配置
- 上报指标
- 告警

## ─── 通用任务（Week 3 后期）───

### 任务 4.1：审计回传机制
按方案 v3.0 第 10.2 节：
- 本地审计写入 audit.db（永不阻塞）
- 每 5 分钟批量上传
- 服务端验证 hash 链
- 失败时本地缓冲，网络恢复后重传

### 任务 4.2：监控仪表盘
建立升级专用仪表盘：
- 各 Track 当前版本分布
- 升级成功率
- 失败模式分析
- 灰度阶段进度

### 任务 4.3：紧急情况处置流程
按方案 v3.0 第 14.3 节实现：
- 严重 bug → Track 3 即时下发"全员降级"配置
- 严重安全漏洞 → 服务端 Quarantine 指令
- Track 1 强制升级补丁
- 写一份应急响应手册

### 任务 4.4：测试
- 端到端测试每个 Track 的升级流程
- 失败回滚测试
- 网络中断 / 恢复测试
- 并发同步测试（避免数据竞争）

### 任务 4.5：文档
- docs/electron/three-track-updates.md
- docs/electron/release-process.md（发版流程）
- docs/electron/incident-response.md（应急响应）
- docs/electron/skill-publishing.md（技能发布流程）

# ✅ 完成标准
- [ ] Track 1：电子壳自动更新工作（含灰度 + 回滚）
- [ ] Track 2：技能静默同步工作（含灰度 + 回滚）
- [ ] Track 3：配置热更新工作（无需重启生效）
- [ ] 服务端三个组件部署
- [ ] 紧急情况处置流程演练通过
- [ ] 监控仪表盘上线
- [ ] 现有 npm test 全部通过

# 🚫 明确不做
- ❌ 不要做完整 OTA 推送（电子壳推送即可）
- ❌ 不要做 P2P 升级
- ❌ 不要做内网穿透（员工必须在公司网络）

# 🧪 验证步骤
1. 模拟一次 Track 1 升级（alpha → 自己 → 升级成功）
2. 模拟一次 Track 2 技能同步（推送新技能 → 客户端拉取）
3. 模拟一次 Track 3 配置热更新（修改策略 → 5 分钟内生效）
4. 模拟 Track 1 升级失败 → 自动回滚
5. 模拟 Track 2 安装失败 → 7 天内可手动回滚
6. 模拟 Quarantine：远程下发 → 客户端立即停用某技能

# 🎁 交付
PR 标题：`[refactor-v3/p15] 三轨升级体系：Track 1/2/3 全链路`

# 📌 关键提示
- 这是本地分发模式的"灵魂"，做不好整个体系崩溃
- 灰度策略一定要有，不要直接推全量
- 回滚机制比升级更重要（出问题时救命）
- 服务端三个组件可以共部署到 1 台机器（用户量不大时）
```

---

# Phase 16：Electron 灰度上线（持续）

```
你是一名资深产品工程师 + SRE，参与 masterBot 重大重构。

# 🔒 分支约束（强制）
- 持续 Phase，每次发布独立分支：refactor/v3/p16-release-v<x>
- commit 以 [refactor-v3/p16] 开头

# 🎯 目标
渐进式从 Web 切到 Electron，让员工体验到桌面版的价值，同时 Web 版长期保留。

# 📋 前置条件
- [ ] Phase 15 已上线（三轨升级可用）
- [ ] Web 版稳定运行
- [ ] 监控告警就绪

# 🔨 任务清单

## 任务 1：内部 alpha（50 人技术用户）
- 选 50 名研发 / IT 员工
- 邀请下载 alpha 版（公司内部下载页）
- 一周观察期
- 收集：
  - 安装成功率
  - 启动成功率
  - 首日活跃率
  - 主要 bug

## 任务 2：扩大 beta（500 人）
基于 alpha 反馈修复 bug 后：
- 扩展到 500 人（多部门）
- 两周观察期
- 监控：
  - 性能指标（启动时间、内存占用）
  - 用户体验（NPS）
  - 升级机制（Track 1 灰度演练）

## 任务 3：全员可用
- 公司全员可下载安装
- Web 版与 Electron 版并存
- 员工自己选择
- 重要：不强制迁移

## 任务 4：Web 版长期保留策略
- Web 版持续运营（Phase 12 不停）
- 适合：网络受限、不愿装软件、临时设备
- 数据云端同步，员工可随时切换

## 任务 5：成本与价值对比
跑 3 个月数据，对比 Web vs Electron：
- 用户活跃度
- 平均使用时长
- 创建技能数量
- 满意度（NPS）
- 成本（带宽、存储、维护）

## 任务 6：迁移路径优化
Web 用户切到 Electron：
- 自动同步对话历史
- 自动同步个人技能
- 设置自动迁移
- 数据零丢失

## 任务 7：故障演练
按季度演练：
- 服务端故障
- 升级回滚
- 紧急 Quarantine
- 数据恢复

## 任务 8：长期维护节奏
建立月度 / 季度发版节奏：
- 月度小更新（bug + 小功能）
- 季度大更新（新能力）
- 半年度大版本（架构调整）

# ✅ 完成标准
- [ ] alpha → beta → 全员渐进
- [ ] NPS ≥ 50
- [ ] 安装成功率 ≥ 95%
- [ ] 启动成功率 ≥ 99.5%
- [ ] 三轨升级机制经过真实生产验证
- [ ] Web 版与 Electron 版双轨稳定运营

# 🚫 明确不做
- ❌ 不要强制员工迁移到 Electron
- ❌ 不要在 Electron 上线后下线 Web
- ❌ 不要在每次发布都做大改

# 🧪 验证步骤
- 季度审视：用户增长、活跃度、技能创建数
- 季度安全审视：审计日志、合规报告
- 季度成本审视：基础设施 + LLM token

# 🎁 交付
按节奏发版：
- v1.0.0：MVP（alpha）
- v1.1.0：beta（修复主要 bug）
- v1.2.0：全员可用
- 后续按月度迭代

# 📌 关键提示
- Phase 16 是"持续 Phase"，没有明确的"完成"
- 把 masterBot 当作长期产品运营，而不是一次性项目
- 用户反馈 > 团队感觉
- 当 Phase 0-15 全部完成且 Phase 16 稳定运营 ≥ 1 个月，可以考虑：
  - 创建 PR 从 refactor/v3 → master
  - 大版本发布
  - 这才是 v3 重构真正完成的时刻
```

---
# 附录

## 附录 A · 全局执行约束（必读）

### A.1 分支保护铁律

**最重要的规则**：完成所有 Phase 之前，**禁止**任何代码合入 master / main。

```
✅ 允许的合并方向：
  refactor/v3/p<N>-<name>  →  refactor/v3
  
❌ 严格禁止的方向：
  refactor/v3/p<N>-<name>  →  master/main
  refactor/v3              →  master/main（在所有 Phase 完成前）
  
✅ 唯一允许合入 master 的时机：
  所有 16 个 Phase 完成 + 全量集成测试通过 + Web 版稳定 ≥ 4 周 + Electron 版稳定 ≥ 4 周
  → 这时才考虑 refactor/v3 → master 的最终一次合并
```

### A.2 给 Claude Code 的明确指令

每次启动新 Phase 前，**必须**对 Claude Code 说：

> 在执行本 Phase 前，请先确认：
> 1. 当前在 `refactor/v3/p<N>-<name>` 分支（不是 master）
> 2. 所有 commit 都会以 `[refactor-v3/p<N>]` 前缀
> 3. 如果你检测到任何会影响 master 的操作（如 `git checkout master` 后 `git merge`），立即停止并报告
> 4. 如果你需要从 master 拉取最新代码，**只能** rebase 到当前 Phase 分支，**不能反过来 merge 到 master**

### A.3 通用 Commit 规范

```
[refactor-v3/p<N>] <type>: <subject>

<body>

Refs: #issue-<num>
Co-authored-by: <如适用>
```

`type` 可选：
- `feat`: 新功能
- `fix`: bug 修复
- `refactor`: 重构（不改外部行为）
- `test`: 测试
- `docs`: 文档
- `chore`: 工程杂项
- `perf`: 性能优化

例：
```
[refactor-v3/p2] refactor: 提取 sandbox 逻辑为 PreToolUse Hook

将 src/sandbox.ts 中的命令验证逻辑迁移为 src/core/hooks/sandbox.ts
统一通过 HookRegistry 调用，与 SDK 协议对齐。

Refs: #issue-14
```

### A.4 PR 规范

每个 Phase 完成时：
- 标题：`[refactor-v3/p<N>] <Phase 名>`
- 目标分支：`refactor/v3`（**不是 master**）
- PR 描述模板：
  ```markdown
  ## Phase <N> 完成清单
  
  ### 任务完成情况
  - [x] 任务 1
  - [x] 任务 2
  - ...
  
  ### 测试结果
  - [x] npm test 全绿
  - [x] capability eval 通过率 X%
  - [x] 性能基线 X
  
  ### Langfuse Trace 链接
  <link>
  
  ### 关键设计决策
  <如有 ADR 链接>
  
  ### Breaking Changes
  无 / 列出
  
  ### 后续 Phase 影响
  <对下一个 Phase 的提醒>
  ```

---

## 附录 B · 常见反模式（务必避免）

Claude Code 可能的"诱惑"操作，**严格避免**：

### B.1 禁止行为

| 反模式 | 危害 | 替代做法 |
|-------|------|---------|
| 直接合并到 master | 破坏分支保护 | PR 到 refactor/v3 |
| 跨 Phase 改动 | 职责混乱 | 当前 Phase 只做当前任务 |
| 忽略测试失败硬推 | 引入隐藏 bug | 失败立停修复 |
| 删除现有测试 | 失去回归保护 | 标记 deprecated 不删 |
| 重写而非重构 | 风险大、难审查 | 小步迁移 |
| 不写 commit message body | 历史难追溯 | 至少 2-3 行说明 |
| 直接修改 master 上的文件 | 灾难 | 永远在 refactor/v3 子分支工作 |
| 跳过 review 直接合并 | 失去同行验证 | 必须 PR review |

### B.2 当 Claude Code 偏离时的纠偏话术

如果你发现 Claude Code 在做以下操作，立即制止：

- "我准备 cherry-pick 到 master..."  → ❌ 停止，本次重构期不允许
- "我合并到主分支..." → ❌ 停止，目标分支应该是 refactor/v3
- "我跳过这个测试..." → ❌ 停止，调查失败原因
- "为了简单，我重写了..." → ❌ 停止，遵循小步迁移原则
- "我忽略了这个警告..." → ❌ 停止，先理解警告含义

---

## 附录 C · 跨 Phase 依赖关系图

```
P0 ─→ P1 ─→ P2 ─→ P2.5 ─→ P3 ─→ P4 ─→ P5
                                    ↓
                                    P6
                                    ↓
              ┌─────────────────────┴─────────┐
              ↓                               ↓
              P7                              P8
              ↓                               ↓
              └────────→ P9 ←─────────────────┘
                          │
                  P9.5 ←──┴──→ P9.7
                          │
                          ↓
                          P10
                          ↓
                          P11
                          ↓
                          P12（持续）
                          │
                          ↓
                          P13
                          ↓
                          P14
                          ↓
                          P15
                          ↓
                          P16（持续）
                          │
                          ↓
              ──────── 所有 Phase 完成 ────────
                          │
                          ↓
                  最终一次性合入 master
```

**关键依赖说明**：
- P9（评估金字塔）启动后会跨多个后续 Phase 持续运行
- P12（Web 迭代）启动后并行于 P13-P16
- P16（Electron 灰度）启动后长期持续

---

## 附录 D · 紧急情况处理

### D.1 如果 Claude Code 误操作了 master

立即执行：
```bash
# 1. 不要 push
git status

# 2. 检查 reflog
git reflog

# 3. reset 到误操作前的状态
git reset --hard HEAD@{N}  # N 是误操作前的步骤号

# 4. 如果已经 push 了
# 联系所有协作者 → 切换分支 → 强制 reset master 到正确版本
git push origin master --force-with-lease  # 务必谨慎
```

### D.2 如果某个 Phase 进展不顺

**不要硬推完成**。优先：

1. 评估是否需要拆分 Phase（拆为 N 和 N.5）
2. 评估是否需要降低范围（保留核心，剔除 nice-to-have）
3. 评估是否需要回滚到上一个 Phase（保留代码，调整时间）
4. 评估是否需要重新设计（如 P9.5 的具体实现）

记录决策到 docs/migration/ADJUSTMENTS.md。

### D.3 如果 capability eval 突然下降

立即停止当前 Phase 工作，启动调查：

1. `git bisect` 定位是哪个 commit 引入退化
2. 检查 Langfuse trace 看具体哪类对话变差
3. 检查 prompt 改动 / hook 改动 / SDK 升级
4. 修复 + 补充 eval 用例（防止再次发生）

---

## 附录 E · Claude Code 启动模板

### E.1 每个 Phase 开始时的标准化指令

```bash
# 1. 切到主重构分支并拉最新
git checkout refactor/v3
git pull origin refactor/v3

# 2. 创建 Phase 专属分支
git checkout -b refactor/v3/p<N>-<name>

# 3. 启动 Claude Code
claude
```

然后给 Claude Code 这样的开场白：

```
我在执行 masterBot 项目的 v3 重构 Phase <N>。

# 关键约束
- 当前分支：refactor/v3/p<N>-<name>
- 严格禁止合并或 push 到 master / main
- 所有 commit 必须以 [refactor-v3/p<N>] 开头
- 不能破坏现有 vitest 测试（必须保持通过）

# 工作风格要求
- 小步提交，每完成一个有意义的子任务就 commit
- 失败立停（测试失败 → 调查原因，不要硬推）
- 类型严格（TypeScript strict，禁止 any）
- 同步更新 docs/migration/PROGRESS.md

# 本 Phase 任务
<这里粘贴对应 Phase 的完整提示词>

请确认你理解约束，然后开始任务 1。
每完成一个任务，简要汇报进度。
遇到不确定的设计决策，先问我再实施。
```

### E.2 阶段性检查点

每完成 30% 任务时，要求 Claude Code：

```
请暂停，做阶段性汇报：
1. 已完成的任务列表
2. 当前测试状态（npm test 是否通过）
3. 发现的潜在问题
4. 下一步计划

不要继续，等我确认后再推进。
```

### E.3 Phase 收尾检查

完成所有任务后：

```
请做 Phase 收尾：
1. 最后一次 npm test，确认全绿
2. 检查 git log，所有 commit 是否符合规范
3. 检查 docs/migration/PROGRESS.md 是否更新
4. 准备 PR 描述（按附录 A.4 模板）
5. 列出本 Phase 中遗留的 known issues（如有）

完成后我会发起 PR review，确认无问题再合入 refactor/v3。
```

---

## 附录 F · 常见问答（FAQ）

### F1：为什么要分这么多 Phase？不能一次性做完吗？

答：因为这是**重大重构**，涉及核心 agent 引擎、数据模型、客户端形态多个层面。一次性做完风险极高（容易出现集成问题、回滚困难、长期没产出影响士气）。分 16 个 Phase 后：
- 每个 Phase 独立可验证
- 每个 Phase 独立可回滚
- 阶段性可见进展（产品上线、价值交付）

### F2：每个 Phase 都必须等上一个完成才开始吗？

答：基本是。但有少量并行可能性：
- P9（评估金字塔）是持续 Phase，启动后所有后续 Phase 都在它的护栏下进行
- P12（Web 迭代）启动后可并行 P13 准备
- P16（Electron 灰度）启动后可并行 P12 持续迭代

**禁止的并行**：
- ❌ P2 和 P2.5 不能并行（P2 是 P2.5 基础）
- ❌ P3 和 P4 不能并行（P4 依赖 P3 的 SDK 接入）
- ❌ P10 和 P14 不能并行（要求 Web 先稳定）

### F3：一个 Phase 卡住了怎么办？

答：参考附录 D.2。优先选项：
1. 缩小范围（保留 P0 任务，砍掉 P1/P2 任务）
2. 拆分 Phase（如 P9.5 拆成 P9.5a / P9.5b）
3. 临时跳过该 Phase 的某项（如 P7 跳过 Teams，先做飞书+钉钉+企微）

但要记录决策到 ADR。

### F4：什么时候才能合并到 master？

答：当且仅当以下条件**全部**满足：
- [ ] 16 个 Phase 全部完成
- [ ] capability eval 通过率 ≥ 99%
- [ ] Web 版生产稳定 ≥ 4 周
- [ ] Electron 版生产稳定 ≥ 4 周
- [ ] 没有 P0 / P1 级 bug
- [ ] 完整集成回归测试通过
- [ ] 团队 review 通过

满足后：
1. 创建 final-merge 分支：`git checkout -b refactor/v3-final-merge`
2. 把 refactor/v3 全部合入
3. 运行最终测试
4. PR 到 master，**所有团队成员 review**
5. 合并并打版本 tag：`v3.0.0`

### F5：如何处理过程中 master 上的 hotfix？

答：在重构期间，master 可能仍需修紧急 bug。处理方式：
1. master hotfix 直接在 master 上做，正常发布
2. 定期（如每 2 周）从 master rebase 到 refactor/v3
3. 解决冲突
4. 不要把 master 的内容合到子 Phase 分支（会乱）

### F6：每个 Phase 完成后立即合入 refactor/v3 吗？

答：是的。完成 Phase N → PR → review → 合入 refactor/v3 → 开始 Phase N+1。
这样保证 refactor/v3 始终包含最新进展，下一个 Phase 从最新基础上工作。

### F7：测试失败应该怎么处理？

答：**绝对不能硬推**。流程：
1. 立即停止当前任务
2. 分析失败原因（git bisect 定位）
3. 决策：
   - 是测试本身有问题 → 修测试（少见）
   - 是新代码引入 bug → 修代码
   - 是 flaky test（偶尔失败） → 标记 + 后续修
4. 修复后重新跑全套测试
5. 全绿后再继续

### F8：怎么判断一个 Phase 真的完成了？

答：每个 Phase 提示词都有"完成标准"清单。**全部勾选**才算完成。
不要为了进度自我安慰"差不多了"。

---

## 附录 G · 进度追踪模板

### docs/migration/PROGRESS.md 模板

```markdown
# masterBot v3 重构进度

最后更新：2026-XX-XX

## 总览

- 计划周期：24 周
- 当前进度：第 X 周
- 当前 Phase：P<N>
- 总体状态：🟢 健康 / 🟡 需关注 / 🔴 阻塞

## Phase 进度

| Phase | 名称 | 状态 | 开始 | 完成 | PR |
|-------|------|------|------|------|-----|
| P0 | 准备工作 | ✅ DONE | 2026-XX-XX | 2026-XX-XX | #1 |
| P1 | 可观测性 | ✅ DONE | ... | ... | #2 |
| P2 | Hooks 重构 | 🔄 IN PROGRESS | ... | - | - |
| P2.5 | Identity & Policy | ⏳ TODO | - | - | - |
| ... | ... | ⏳ TODO | - | - | - |

## 关键里程碑

- [x] M1 (P1 完成): 看见每次 agent 调用 - 2026-XX-XX
- [ ] M2 (P3 完成): SDK 5% 流量跑通
- [ ] M3 (P9.5 完成): Skill Factory 2 小时上线
- [ ] M3.5 (P9.7 完成): 设计系统就绪
- [ ] M4 (P11 完成): Web 版上线
- [ ] M5 (P14 完成): Electron 可分发
- [ ] M6 (P16 启动): 桌面版全员可用

## 已知风险

1. <风险描述> - 影响 / 缓解措施

## 决策记录

详见 docs/adr/

## 调整记录

详见 docs/migration/ADJUSTMENTS.md
```

---

## 文档结尾

### 给项目维护者的最终建议

1. **节奏管理 > 速度管理**
   - 快速完成 16 个 Phase 是反直觉的目标
   - 真正的目标是：**每个 Phase 都做扎实，最终一次性合入 master 时无回退**

2. **沟通 > 代码**
   - 与公司 IT 部门提前沟通：SSO 接入、签名证书、内网部署
   - 与员工提前沟通：试用范围、反馈渠道
   - 与团队对齐：每个 Phase 开始前 review 提示词

3. **数据驱动 > 直觉驱动**
   - capability eval 通过率
   - Langfuse 实时指标
   - 用户 NPS
   - 永远基于数据而非感觉做决策

4. **保护性优先 > 创新性优先**
   - 这次重构的目标不是炫技
   - 而是：把 masterBot 推上一个新台阶，并保证不破坏现有用户

5. **重构期间是项目最脆弱的时期**
   - 严格遵守分支保护
   - 严格执行测试
   - 严格记录决策
   - 严格控制范围

---

**文档版本**：v1.0 实施提示词集
**完成日期**：2026 年 5 月 8 日
**配套使用**：
- masterBot优化方案_v3_最终版.md（架构方案）
- masterBot优化方案_v3.1_增量补充.md（修订点）
- 本文档（实施提示词）

**预计执行周期**：24 周（约 5.5 个月）
**最终交付时机**：所有 Phase 完成 + 双版本稳定 ≥ 4 周后，一次性合入 master

祝重构顺利！
