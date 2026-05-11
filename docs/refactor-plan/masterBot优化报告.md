# masterBot 优化报告

## 结合业界 Harness Engineering 实践 + Claude 产品技术理念的完整版

---

**版本**：v1.0
**生成日期**：2026年5月8日
**目标读者**：masterBot 项目维护者 / yiyisf
**核心定位变化**：从「自研 ReAct Agent」 → 「Claude managed agent 优先 + 自研 harness 兜底」

---

## 摘要（TL;DR）

masterBot 当前已经是一个**功能丰富、架构清晰的企业级 Agent 系统**，覆盖了 Skills/MCP/记忆/DAG/Webhook/Runbook/RPA/NL2SQL 等完整能力面，技术选型（Node 22 + Fastify + Next.js 16 + node:sqlite）非常现代。

但要朝 **Claude managed agent** 方向演进，需要进行三个层次的转型：

1. **战略层**：从"我自己造一个 ReAct loop"转向"我使用 Claude 提供的 agent loop + 我专注于 harness"——这与 OpenAI/Anthropic 在 2026 年共同确立的 **Harness Engineering** 哲学一致：**模型决定上限，Harness 决定能发挥多少**。
2. **架构层**：把核心 agent loop 替换为 `@anthropic-ai/claude-agent-sdk`，自研代码全部退化为 **Hooks + 自定义 Tools + Subagents 配置 + MCP Servers**——这正好是 SDK 暴露的扩展点。
3. **能力层**：补齐当前架构的关键缺口——分层 Skills（Progressive Disclosure）、Hooks-based 权限审批、Session Resume/Fork、Checkpoint、Compaction、OTel 标准追踪。

本报告分 8 章，**第 4 章是核心改造方案，第 6 章是分阶段路线图，可作为 issue 直接拆分**。

---

## 目录

1. 项目现状评估（优势 + 缺口）
2. 业界标杆：Claude Agent SDK 的核心理念
3. 战略选择：Managed vs 自研——为何选 Managed
4. 完整架构改造方案（核心章节）
5. 关键模块逐项优化建议
6. 分阶段实施路线图（可拆 issue）
7. 风险与回滚策略
8. 附录：参考资源 + 代码模板

---

# 第 1 章 项目现状评估

## 1.1 已具备的能力（强项）

通过阅读 README + CLAUDE.md，masterBot 当前的能力栈已相当完整：

| 维度 | 现状 | 业界对标 |
|------|------|----------|
| **Agent Loop** | 自研 ReAct，async generator 流式输出 | LangGraph / Claude SDK 的 query() |
| **多 LLM** | OpenAI / Anthropic / Gemini / Ollama 适配 | LiteLLM 风格 |
| **Skills 协议** | SKILL.md + YAML frontmatter + index.ts 热重载 | 与 Anthropic Skills 协议高度一致 |
| **MCP 支持** | stdio / SSE 双传输，环境变量注入 | MCP 标准实现 |
| **记忆系统** | 短期 LRU + 长期 SQLite 向量余弦 + 知识图谱 BFS | Letta 三层 + GraphRAG |
| **任务编排** | DAG Executor (Promise.allSettled 并行) | Plan-and-Execute |
| **多 Agent** | Supervisor + Worker (SOUL.md) | Anthropic Subagents 雏形 |
| **追踪** | SpanRecorder（trace_id / parent_id）| OTel 雏形 |
| **审批** | 飞书/钉钉 HitL 卡片 | Claude SDK canUseTool |
| **沙箱** | Shell 黑名单/白名单 | Claude Code Bash sandbox |
| **运维** | Webhook + YAML Runbook + Cron | Anthropic Skills + AIOps |
| **前端** | Next.js 16 + @assistant-ui/react + 12 页面 | CopilotKit 雏形 |
| **审计** | 全量执行记录 + CSV 导出 | 企业合规级 |

**结论**：你已经独立"重新发明"了 Claude Agent SDK 的大部分核心抽象。这本身证明了架构方向的正确性，但也意味着——继续自研每一个原语的 ROI 在快速下降。

## 1.2 关键缺口（弱项 + 改进点）

对照 2026 年 Claude Agent SDK / Harness Engineering 的最佳实践，masterBot 在以下方面存在差距：

### 1.2.1 Agent Loop 层

- **没有 prompt caching 与 server-side compaction**：长对话场景下 token 成本会快速失控。Anthropic 官方数据：在 100 轮 web search 评估中，开启 compaction 可减少 84% token 消耗。
- **没有 extended thinking 集成**：Claude 4.x 的 thinking budget 是质量杠杆，但需要在 tool result 回传时**保留 thinking blocks**，自研容易遗漏。
- **maxIterations=10 偏低**：Claude Code 的 `maxTurns` 默认 200+，长任务（如代码 review、多步研究）很容易撞墙。

### 1.2.2 上下文工程（最大缺口）

- **没有 Skills 的 Progressive Disclosure**：当前 Skills 一次性全部注册到工具列表，工具数 > 20 时会导致显著的"context rot"和工具选择混乱。Anthropic 的 Skills 设计原则是 **agent 按需激活**——只暴露 metadata（name + description），实际内容在 agent 显式调用时再加载。
- **没有 Subagent 的 context isolation**：Worker Agent 共享主线 context，导致 supervisor 的上下文持续膨胀。Claude SDK 的 Subagent 机制是关键创新——子任务在独立 context 跑完，**只把最终结论返回主线**。
- **AGENTS.md / SOUL.md 缺少分层结构**：缺一个面向人和 agent 共读的"项目宪法"。

### 1.2.3 权限模型

当前权限是"沙箱黑白名单 + IM 卡片审批"二元模式，缺少 Claude SDK 的 **5 层评估顺序**：

```
Hooks → Deny Rules → Permission Mode → Allow Rules → canUseTool 回调
```

特别是缺少：
- **细粒度的 PreToolUse Hook**：在工具执行前修改入参（"approve with changes"——比纯 allow/deny 更灵活）。
- **Tool Annotation Hints**：`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` 没有被利用。
- **Subagent 权限隔离**：当前 Worker 看起来继承了 Supervisor 的全部权限，存在权限蔓延风险。

### 1.2.4 Session 与持久化

- **没有 fork**：用户经常需要"基于这个 session 试一下另一种方案"，自研要重新跑一遍。
- **没有 checkpoint**：长任务中断不可恢复。Meta REA 的 hibernate-and-wake 机制在 6 小时任务中断后能恢复执行，关键就靠 checkpoint。
- **没有 file checkpoint**：agent 修改文件后无法快速回滚。

### 1.2.5 可观测性

- SpanRecorder 是自研格式，**没遵循 OTel GenAI Semantic Conventions**（`gen_ai.system` / `gen_ai.request.model` / `gen_ai.usage.*`）。
- 不能直接接入 Langfuse / Phoenix / Datadog 等标准 backend，未来排查问题/做评估会越来越痛。

### 1.2.6 评估与回归

- 单元测试 90 个全部通过——但**缺少 agent 行为的回归评估**。Anthropic 强调 agent eval 必须区分两类：
  - **Capability eval**（低通过率，目标改进）
  - **Regression eval**（接近 100%，目标保护）
  - 当前 vitest 主要是后者，前者完全缺位。

### 1.2.7 个人定位 vs 企业定位的拧巴

README 主打"企业员工 AI 助手操作系统"，但你的实际方向是**个人助手**。这导致：
- 飞书/钉钉占据一等公民地位，而个人助手更需要的 Telegram / iMessage / WhatsApp 等渠道反而是缺口。
- 一些企业向能力（NL2Insight、Runbook）相对成熟，但个人向的高频场景（日历、邮件、笔记同步、家居）反而较薄。

---

# 第 2 章 业界标杆：Claude Agent SDK 的核心理念

要朝"Claude managed agent"方向走，必须深入理解 SDK 的设计哲学。这不是简单替换 LLM 调用层，而是**整个 harness 的重新组织**。

## 2.1 SDK 暴露的 6 大扩展点

```
┌─────────────────────────────────────────────────────┐
│  Your Application Code                              │
│  ────────────────────────────────────────────────   │
│  ① Custom Tools  (createSdkMcpServer / @tool)       │
│  ② Hooks         (PreToolUse, PostToolUse, ...)     │
│  ③ Subagents     (agents: { ... })                  │
│  ④ MCP Servers   (mcpServers: { ... })              │
│  ⑤ Permissions   (allowedTools, canUseTool)         │
│  ⑥ Skills        (settingSources: ['project'])      │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│  Claude Agent SDK Core (managed)                    │
│  · Agent Loop（迭代、终止、错误恢复）                  │
│  · Built-in Tools（Read/Write/Edit/Bash/WebSearch）   │
│  · Context Management（compaction, caching）         │
│  · Session（resume / fork）                          │
│  · Streaming                                         │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│  Anthropic API（Opus 4.7 / Sonnet 4.6 / Haiku 4.5）  │
└─────────────────────────────────────────────────────┘
```

**核心转变**：你不再需要写 agent loop，而是写**插件**——在 SDK 提供的 6 个扩展点上挂载你的业务逻辑。

## 2.2 Hooks 系统（Anthropic 的"中间件"）

Hooks 是 Claude SDK 最强大的机制，也是 masterBot 当前架构最大的升级点。事件列表：

| Hook 事件 | 触发时机 | 典型用途 |
|-----------|----------|---------|
| `PreToolUse` | 工具调用前 | 权限审批、入参 PII 脱敏、参数改写 |
| `PostToolUse` | 工具调用后 | 日志、指标、结果验证 |
| `PostToolUseFailure` | 工具失败 | 自动重试、告警 |
| `UserPromptSubmit` | 用户输入提交 | 输入审计、prompt injection 检测 |
| `SessionStart` | 会话开始 | 注入用户偏好、加载长期记忆 |
| `SessionEnd` | 会话结束 | 持久化、统计上报 |
| `SubagentStart` | 子 agent 启动 | 隔离上下文、切换权限 |
| `SubagentStop` | 子 agent 结束 | 收集摘要 |
| `PreCompact` | 压缩前 | 保护关键信息 |
| `PermissionRequest` | 权限请求 | 程序化授权 |
| `Stop` | Agent 终止 | 清理 |
| `Notification` | 用户提醒 | 路由到 IM |

**masterBot 当前的 IM 审批、shell sandbox、SpanRecorder、长期记忆注入——全部都可以重写为 Hook**，而且会更标准、更易测试、更易组合。

## 2.3 Subagent 的 Context Isolation

Subagent 的核心价值不是"多个 agent 协作"，而是 **context 隔离**：

```typescript
// 主 agent 的视角：只看到 Worker 的最终结论
const result = query({
  prompt: "整理这周的所有邮件并生成日报",
  options: {
    agents: {
      "email-fetcher": {
        description: "拉取邮件，但中间过程的几百封邮件内容不会污染主线 context",
        prompt: "你是邮件抓取专家。返回结构化摘要。",
        tools: ["mcp__gmail__list", "mcp__gmail__get"],
        model: "haiku",  // 简单任务用便宜模型
      },
      "summarizer": {
        description: "把邮件清单整理成日报",
        prompt: "你是简报写手。用 200 字以内总结。",
        tools: ["Read"],
        model: "sonnet",
      },
    }
  }
});
```

masterBot 当前的 Worker Agent 是**手动用工具调用模拟**的，缺少 SDK 的两个关键能力：
1. **Subagent 在独立 context 跑，主 agent 只收最终消息**——直接砍掉 67% 的跨域 token 浪费（LangChain 实测数据）。
2. **每个 Subagent 可以指定不同的 model**——Haiku 跑文件搜索、Sonnet 跑业务推理、Opus 跑战略规划，自然形成成本最优解。

## 2.4 Skills 的 Progressive Disclosure

Anthropic Skills 的设计哲学是 **三层渐进披露**：

```
Layer 1: skill 名称 + 一句话描述  ← 总是在 context 里
Layer 2: SKILL.md 详细说明        ← agent 决定使用时再加载
Layer 3: 引用的资源文件            ← agent 在 SKILL.md 中按需打开
```

这与 masterBot 当前"全部 SKILL.md 一次性注册成 tool definition"的方式有本质区别：

- 当前方式：**N 个技能 × M 行描述 ≈ 大量永久占用的 context**
- Skills 方式：**N 个技能名 ≈ 轻量级菜单 + 按需展开**

实测数据：Claude Code 在使用 Skills 后，将技能数量从大量缩减到 ≤12 个核心 Skills，agent 任务完成率反而从 9% 提升到 82%——少即是多。

## 2.5 Permission Model 的 5 层结构

```
1. Hooks                  (你的代码可以在这里 deny / modify)
2. Deny Rules             (静态黑名单，bypassPermissions 也无法绕过)
3. Permission Mode        (default / acceptEdits / plan / bypassPermissions)
4. Allow Rules            (静态白名单)
5. canUseTool 回调         (运行时交互式审批)
```

每一层都有明确职责，不能用单一 if-else 替代。masterBot 的 sandbox 主要在第 2 层，HitL 在第 5 层，但缺少 1、3、4 层的精细化。

---

# 第 3 章 战略选择：Managed vs 自研

## 3.1 决策矩阵

| 评估维度 | 全自研（现状） | Hybrid: SDK + 自研扩展（推荐） | 100% Anthropic-managed |
|----------|-----------|---------------------------|--------------------|
| **核心 Loop 维护成本** | ⚠️ 高 | ✅ 极低 | ✅ 零 |
| **跟进新特性（thinking/skills/compaction）** | ❌ 总落后 6-12 月 | ✅ 立即可用 | ✅ 立即 |
| **Token 成本** | ⚠️ 无 caching | ✅ 自动 caching/compaction | ✅ |
| **多 LLM 支持** | ✅ 4 家 | ⚠️ 主要 Anthropic（可降级到 Bedrock/Vertex） | ❌ 仅 Anthropic |
| **本地模型（Ollama）** | ✅ 支持 | ⚠️ 通过 OAuth/Bedrock 间接 | ❌ |
| **代码库可控性** | ✅ 100% | ✅ 95%（SDK 封装最小） | ⚠️ 50% |
| **企业部署灵活性** | ✅ 完全自主 | ✅ Bedrock/Vertex 满足 SOC2 | ⚠️ 受 Anthropic 影响 |
| **License 风险** | ✅ MIT | ⚠️ Agent SDK 是 proprietary license | ⚠️ |
| **学习成本** | 中（自家代码） | 低（SDK 文档完善） | 低 |
| **生产稳定性** | ⚠️ 90 个测试覆盖有限 | ✅ Anthropic 大规模验证 | ✅ |

**结论：选 Hybrid 方案**——这正好契合你"未来方向希望是 Claude managed agent"的目标，但又不彻底放弃多 provider 能力。

## 3.2 Hybrid 方案的核心原则

1. **Anthropic Provider 走 SDK，其他 provider 走自研 fallback**
   - Anthropic 路径：用 `@anthropic-ai/claude-agent-sdk` 的 `query()`
   - 非 Anthropic 路径：保留你现在的 ReAct 实现作为 fallback
   - 通过 `AgentRouter` 抽象层根据 provider 路由

2. **抽象层设计：让 SDK 和自研共享同一套 Tool/Skill/Hook 协议**
   - 你现有的 `SKILL.md` 协议保留——它本来就和 Anthropic Skills 兼容
   - 自定义 Tool 用 SDK 的 `createSdkMcpServer` 包装一遍即可被 SDK 调用
   - Hook 系统改造为 SDK 兼容格式

3. **本地模型场景另起一条路**
   - Ollama 用户场景下，使用 OpenAI 兼容接口 + 你现有的 ReAct
   - 但是**用 SDK 的 Skills/Hooks/Subagent 配置规范**——这样将来切回 Claude 时配置零修改

## 3.3 License 风险提示

⚠️ **重要**：Anthropic 已将 claude-agent-sdk 库以 proprietary license 发布。这意味着：

- 你**可以**在自己的产品中商用、自部署、自托管
- 但**不能**修改 SDK 源码并以你的名义重新分发
- 你的 masterBot **本身可以保持 MIT**，因为 SDK 是依赖（类似你依赖 Fastify）

如果你严重在意 license 纯度，可以选择**仅集成 SDK 协议（Hooks 接口、AgentDefinition schema）而不依赖 SDK runtime**。但这会损失 SDK 提供的核心价值（managed loop、自动 caching、subagent isolation）——不推荐。

---

# 第 4 章 完整架构改造方案（核心）

## 4.1 目标架构图

```
┌──────────────────────────────────────────────────────────────────┐
│  前端（保留并增强）                                                  │
│  ┌──────────────────────┬──────────────────────────────────────┐ │
│  │ Web Console (Next.js)│  Multi-Channel Bots                   │ │
│  │ + @assistant-ui/react│  Telegram / iMessage / Slack / 飞书   │ │
│  │ + AG-UI 协议（推荐）   │  WhatsApp / Discord                   │ │
│  └──────────────────────┴──────────────────────────────────────┘ │
└───────────────────────────────┬──────────────────────────────────┘
                                │ AG-UI events (SSE/WS)
┌───────────────────────────────▼──────────────────────────────────┐
│  Gateway Layer（轻度重构）                                          │
│  Fastify + AG-UI Protocol Adapter                                 │
│  · /api/chat/stream（SSE，AG-UI 格式）                             │
│  · /api/sessions/{id}/fork（新）                                  │
│  · /api/sessions/{id}/resume（新）                                │
│  · /api/sessions/{id}/checkpoint（新）                            │
└───────────────────────────────┬──────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────┐
│  AgentRouter（新增 - 关键抽象层）                                    │
│                                                                   │
│  if (provider === 'anthropic') → ClaudeManagedAgent              │
│  else                          → LegacySelfHostedAgent           │
└─────────────────┬─────────────────────────────────┬──────────────┘
                  │                                 │
┌─────────────────▼──────────┐  ┌──────────────────▼───────────────┐
│  ClaudeManagedAgent (新)   │  │  LegacySelfHostedAgent (保留)     │
│  ──────────────────────── │  │  ───────────────────────────────  │
│  @anthropic-ai/           │  │  当前 src/core/agent.ts           │
│    claude-agent-sdk       │  │  + ContextManager                 │
│                            │  │  + DAG Executor                   │
│  · query() / Client        │  │                                   │
│  · 配置：                   │  │  服务于：                          │
│    - hooks                 │  │  - OpenAI                         │
│    - agents (subagents)    │  │  - Gemini                         │
│    - mcpServers            │  │  - Ollama                         │
│    - allowedTools          │  │  - 自定义 OpenAI 兼容              │
│    - settingSources        │  │                                   │
│  · sessions resume/fork    │  │  逐步迁移：当 SDK 支持 OpenAI 兼容    │
│  · 自动 caching/compaction  │  │  接口后，本路径退役                  │
└────────────────────────────┘  └───────────────────────────────────┘
                  │                                 │
                  └─────────────────┬───────────────┘
                                    │
┌───────────────────────────────────▼──────────────────────────────┐
│  共享基础设施层（重构对齐 SDK 协议）                                  │
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────┐           │
│  │ Hook System  │ │ Tool/Skill   │ │ Subagent       │           │
│  │ (重构)        │ │ Registry     │ │ Definitions    │           │
│  │              │ │              │ │                │           │
│  │ PreToolUse   │ │ SDK MCP      │ │ AgentDefinition│           │
│  │ PostToolUse  │ │ Server 包装   │ │ (filesystem +  │           │
│  │ SessionStart │ │ + 你现有的   │ │  programmatic) │           │
│  │ ...12 events │ │   skills/    │ │                │           │
│  └──────────────┘ └──────────────┘ └────────────────┘           │
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────┐           │
│  │ MCP Servers  │ │ Permission   │ │ Memory Router  │           │
│  │              │ │ Engine       │ │                │           │
│  │ - 内置 builtin│ │ 5 层评估     │ │ Working /      │           │
│  │ - 第三方 MCP  │ │              │ │ Episodic /     │           │
│  │ - 自定义内嵌  │ │              │ │ Semantic /     │           │
│  └──────────────┘ └──────────────┘ │ Procedural     │           │
│                                    └────────────────┘           │
└───────────────────────────────────┬──────────────────────────────┘
                                    │
┌───────────────────────────────────▼──────────────────────────────┐
│  Persistence & Observability（增强）                              │
│                                                                   │
│  · SQLite (sessions, checkpoints, memory) - 保留                   │
│  · pgvector（推荐升级）                                            │
│  · OTel GenAI Semantic Conventions（替换 SpanRecorder）            │
│  · Langfuse self-hosted（推荐）                                    │
└──────────────────────────────────────────────────────────────────┘
```

## 4.2 核心代码骨架

### 4.2.1 AgentRouter（关键抽象层）

新建 `src/core/agent-router.ts`：

```typescript
// src/core/agent-router.ts
import { ClaudeManagedAgent } from './agents/claude-managed.js';
import { LegacySelfHostedAgent } from './agents/legacy-self-hosted.js';
import type { AgentInput, AgentEvent, AgentConfig } from './types.js';

export interface IAgent {
  /**
   * 统一执行接口，无论底层是 Claude SDK 还是自研 ReAct，都返回标准 AgentEvent 流
   */
  execute(input: AgentInput): AsyncGenerator<AgentEvent>;

  /**
   * Session 管理
   */
  resume(sessionId: string): AsyncGenerator<AgentEvent>;
  fork(sessionId: string): Promise<string>;  // returns new sessionId
  checkpoint(sessionId: string): Promise<string>;  // returns checkpoint id
}

export class AgentRouter {
  constructor(
    private readonly claude: ClaudeManagedAgent,
    private readonly legacy: LegacySelfHostedAgent,
  ) {}

  route(config: AgentConfig): IAgent {
    // 关键路由逻辑：Anthropic provider 走 SDK
    if (config.provider === 'anthropic' && !config.forceLegacy) {
      return this.claude;
    }
    return this.legacy;
  }
}
```

### 4.2.2 ClaudeManagedAgent（新核心）

```typescript
// src/core/agents/claude-managed.ts
import { query, ClaudeSDKClient } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeAgentOptions, AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { buildHooks } from '../hooks/index.js';
import { buildSubagents } from '../subagents/index.js';
import { buildMcpServers } from '../mcp/index.js';
import type { IAgent, AgentInput, AgentEvent } from '../types.js';

export class ClaudeManagedAgent implements IAgent {
  constructor(
    private readonly skillsRegistry: SkillRegistry,
    private readonly memoryRouter: MemoryRouter,
    private readonly permissionEngine: PermissionEngine,
    private readonly observer: OtelObserver,
  ) {}

  async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
    const options: ClaudeAgentOptions = {
      // === 1. System Prompt（注入用户/项目上下文）===
      systemPrompt: await this.buildSystemPrompt(input),

      // === 2. 模型与 thinking ===
      model: input.model ?? 'claude-opus-4-7',
      maxTurns: 250,
      thinking: { type: 'enabled', budget_tokens: 8000 },

      // === 3. Tools 配置 ===
      // 默认启用 Read/Glob/Grep/Bash/WebSearch，按需关闭
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'Task'],

      // === 4. Skills（progressive disclosure 自动生效）===
      settingSources: ['project'],  // 加载 .claude/skills/

      // === 5. Hooks（你现在所有的拦截逻辑都在这）===
      hooks: buildHooks({
        sandbox: this.permissionEngine,
        observer: this.observer,
        memory: this.memoryRouter,
      }),

      // === 6. Subagents（替换 SOUL.md Worker）===
      agents: buildSubagents(),

      // === 7. MCP Servers（保留你的 MCP 配置）===
      mcpServers: await buildMcpServers(),

      // === 8. canUseTool（运行时审批 - 替换飞书卡片审批）===
      canUseTool: async (toolName, toolInput) => {
        return this.permissionEngine.evaluate(toolName, toolInput, input.userId);
      },

      // === 9. Session 管理 ===
      sessionId: input.sessionId,
      resumeSessionId: input.resumeFromSession,
    };

    // 执行并把 SDK 的消息流转换为 AgentEvent
    for await (const message of query({ prompt: input.message, options })) {
      yield this.translateToAgentEvent(message);
    }
  }

  async fork(sessionId: string): Promise<string> {
    // SDK 原生支持 fork
    const client = new ClaudeSDKClient();
    return client.fork(sessionId);
  }

  // ... resume / checkpoint
}
```

### 4.2.3 Hooks 体系（最大升级点）

新建 `src/core/hooks/`：

```typescript
// src/core/hooks/index.ts
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { sandboxPreHook } from './sandbox.js';
import { piiRedactionHook } from './pii-redaction.js';
import { otelHook } from './otel.js';
import { memoryInjectionHook } from './memory.js';
import { auditLogHook } from './audit.js';

export function buildHooks(deps: HookDependencies): Record<string, HookCallback[]> {
  return {
    // 工具调用前：sandbox 检查 + PII 脱敏 + 审计起点
    PreToolUse: [
      sandboxPreHook(deps.sandbox),
      piiRedactionHook(),
      otelHook.startSpan(deps.observer),
    ],

    // 工具调用后：结果验证 + 审计落点
    PostToolUse: [
      otelHook.endSpan(deps.observer),
      auditLogHook(),
    ],

    // 工具失败：自动重试逻辑
    PostToolUseFailure: [
      autoRetryHook({ maxRetries: 2, exponentialBackoff: true }),
    ],

    // 用户输入提交：prompt injection 检测
    UserPromptSubmit: [
      promptInjectionHook(),
    ],

    // 会话开始：注入长期记忆 + 用户偏好
    SessionStart: [
      memoryInjectionHook(deps.memory),
      loadUserPreferencesHook(),
    ],

    // 会话结束：持久化重要事实到长期记忆
    SessionEnd: [
      extractAndPersistMemoryHook(deps.memory),
    ],

    // 子 agent 启停：OTel parent_id 维护
    SubagentStart: [otelHook.subagentStart(deps.observer)],
    SubagentStop: [otelHook.subagentStop(deps.observer)],

    // 压缩前：保护关键事实
    PreCompact: [
      protectCriticalContextHook(),
    ],
  };
}
```

**关键洞察**：现在 masterBot 的 `sandbox.ts`、`SpanRecorder`、`memory injection`、`PII 脱敏`、`审计日志`等逻辑散落在多个文件中——重构成 Hook 后，**它们成为可独立测试、可热插拔的中间件**，而且天然支持组合。

### 4.2.4 Subagents 设计（替换 SOUL.md）

```typescript
// src/core/subagents/index.ts
export function buildSubagents(): Record<string, AgentDefinition> {
  return {
    // 邮件助手 - 用便宜模型批量处理
    'email-handler': {
      description: '处理邮件相关任务：搜索、阅读、起草回复。' +
                   '场景：用户提到邮件、收件箱、回复某人时使用。',
      prompt: `你是邮件助手。遵循以下规则：
1. 起草回复前必须读取最近 3 封相关邮件了解上下文
2. 涉及金额、合同、敏感信息时**必须**让用户确认后再发送
3. 返回时给主线 agent 一个不超过 3 行的执行摘要`,
      tools: ['Read', 'mcp__gmail__list', 'mcp__gmail__send', 'mcp__gmail__draft'],
      model: 'claude-haiku-4-5',  // 邮件操作用 Haiku 性价比最高
    },

    // 日历助手
    'calendar-handler': {
      description: '处理日程：查询、创建、修改、查找空闲时间',
      prompt: `你是日历助手。规则：
1. 创建会议前确认参会人时区
2. 涉及公司外部人员时需要双重确认
3. 默认提前 10 分钟设置提醒`,
      tools: ['mcp__gcal__list', 'mcp__gcal__create', 'mcp__gcal__update'],
      model: 'claude-haiku-4-5',
    },

    // 研究员 - 深度搜索 + 综合
    'researcher': {
      description: '深度研究任务：调研某主题、对比方案、查找最新进展',
      prompt: `你是研究员。流程：
1. 先做关键词扩展，列出 5-8 个搜索 query
2. 并行抓取后用 Read 详读 top 3
3. 输出含引用的结构化报告`,
      tools: ['WebSearch', 'WebFetch', 'Read', 'Write'],
      model: 'claude-opus-4-7',  // 复杂任务用 Opus
    },

    // 个人秘书 - 综合协调
    'secretary': {
      description: '日常协调：查看消息、整理待办、给出今日建议',
      prompt: `你是个人秘书。每天早上：
1. 检查日历今日安排
2. 检查邮件重要事项
3. 检查 Telegram 未回消息
4. 给出 3 件最重要的事`,
      tools: ['Task', 'Read'],  // Task 让她可以委派给 email-handler / calendar-handler
      model: 'claude-sonnet-4-6',
    },
  };
}
```

**对比当前 SOUL.md 的提升**：
1. **类型安全**：AgentDefinition 是 SDK 的标准类型
2. **模型分级**：每个 subagent 自己决定用什么模型，自然形成成本梯度
3. **工具隔离**：email-handler 拿不到 calendar 的工具，符合最小权限
4. **Context isolation 自动生效**：不需要你手动管理 worker context
5. **可声明式委派**：主 agent 通过 description 自动决定何时调用，不需要硬编码 router

### 4.2.5 SDK 兼容的自定义 Tool

```typescript
// src/skills/sdk-mcp-wrapper.ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { skillRegistry } from './registry.js';

/**
 * 把 masterBot 现有的 SKILL.md 技能包装成 SDK MCP Server
 * 这样 SDK agent 就能像调内置工具一样调你的技能
 */
export async function createMasterBotMcpServer() {
  const skills = await skillRegistry.list();

  const tools = skills.flatMap(skill =>
    skill.actions.map(action => tool(
      `${skill.name}__${action.name}`,
      action.description,
      buildZodSchema(action.parameters),
      async (input) => {
        const result = await skillRegistry.execute(skill.name, action.name, input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
    ))
  );

  return createSdkMcpServer({
    name: 'masterbot-skills',
    version: '1.0.0',
    tools,
  });
}
```

**这一步保护了你过去 100+ commits 的全部投资**——所有 SKILL.md 协议、连接器 YAML、Webhook、Runbook 都不需要重写，只是被包装一层暴露给 Claude SDK。

### 4.2.6 Permission Engine（5 层）

```typescript
// src/core/permissions/engine.ts
import type { PermissionDecision } from '@anthropic-ai/claude-agent-sdk';

export class PermissionEngine {
  /**
   * 5 层评估，对应 Claude SDK 的标准顺序
   */
  async evaluate(
    toolName: string,
    toolInput: any,
    userId: string,
  ): Promise<PermissionDecision> {

    // Layer 1: Hooks（已在 PreToolUse 处理）
    // 这里只处理后 4 层

    // Layer 2: Deny Rules（绝对禁止 - 即使是 bypassPermissions 也不行）
    if (this.matchesDenyRule(toolName, toolInput)) {
      return {
        behavior: 'deny',
        message: 'Tool blocked by deny rule',
      };
    }

    // Layer 3: Permission Mode
    const mode = await this.getPermissionMode(userId);
    if (mode === 'bypassPermissions') {
      return { behavior: 'allow' };
    }
    if (mode === 'plan') {
      return { behavior: 'deny', message: 'Plan mode: read-only' };
    }

    // Layer 4: Allow Rules（白名单直接通过）
    if (this.matchesAllowRule(toolName, toolInput, userId)) {
      return { behavior: 'allow' };
    }

    // Layer 5: 运行时审批 - 你现在的飞书/钉钉卡片在这里
    const annotation = this.getToolAnnotation(toolName);
    if (annotation.destructiveHint || annotation.isLethalTrifecta) {
      // 触发 HitL 审批流
      const approval = await this.requestHumanApproval({
        userId,
        toolName,
        toolInput,
        annotation,
      });
      return approval.approved
        ? {
            behavior: 'allow',
            updatedInput: approval.modifiedInput ?? toolInput,  // approve with changes
          }
        : { behavior: 'deny', message: approval.reason };
    }

    // 无害工具直接允许
    return { behavior: 'allow' };
  }

  /**
   * 关键概念：lethal trifecta
   * 私密数据访问 + 不可信内容暴露 + 外部通信 = 致命组合
   * 一旦触发必须 HitL
   */
  private isLethalTrifecta(toolName: string, sessionTools: string[]): boolean {
    const reads_private = sessionTools.some(t =>
      t.includes('gmail') || t.includes('gcal') || t.includes('contacts')
    );
    const exposes_untrusted = sessionTools.some(t =>
      t.includes('webfetch') || t.includes('webSearch')
    );
    const sends_external = sessionTools.some(t =>
      t.includes('send') || t.includes('post') || t.includes('publish')
    );
    return reads_private && exposes_untrusted && sends_external;
  }
}
```

## 4.3 数据库 Schema 增强

为支持 fork / resume / checkpoint，需要新增 3 个表：

```sql
-- 现有 sessions 表 + 增加 parent_session_id 支持 fork
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
ALTER TABLE sessions ADD COLUMN forked_at TEXT;
ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT;  -- Claude SDK 内部 sessionId

-- 新表：checkpoints
CREATE TABLE session_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  state_blob BLOB NOT NULL,  -- 序列化的完整状态
  file_snapshots TEXT,        -- JSON: { path: hash } 用于 file checkpoint
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX idx_checkpoints_session ON session_checkpoints(session_id);

-- 新表：file checkpoints（agent 修改文件的快照，支持 rewind）
CREATE TABLE file_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  before_content BLOB,
  after_content BLOB,
  created_at TEXT NOT NULL
);

-- 新表：tool execution log（用于事后回放与训练数据）
CREATE TABLE tool_executions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_tool_id TEXT,         -- 嵌套调用时的父 tool
  tool_name TEXT NOT NULL,
  tool_input TEXT NOT NULL,    -- JSON
  tool_output TEXT,            -- JSON
  duration_ms INTEGER,
  is_error INTEGER DEFAULT 0,
  permission_decision TEXT,    -- allow/deny/approved-with-changes
  trace_id TEXT,               -- OTel trace_id
  span_id TEXT,
  created_at TEXT NOT NULL
);
```

## 4.4 OTel 标准化改造

替换当前 SpanRecorder。新建 `src/observability/otel.ts`：

```typescript
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { LangfuseExporter } from 'langfuse';

const tracer = trace.getTracer('masterbot', '1.0.0');

export class OtelObserver {
  startAgentSpan(input: AgentInput) {
    return tracer.startSpan('agent.run', {
      attributes: {
        // OTel GenAI Semantic Conventions
        'gen_ai.system': 'anthropic',
        'gen_ai.request.model': input.model,
        'gen_ai.operation.name': 'agent_loop',
        // 你的扩展
        'agent.session_id': input.sessionId,
        'agent.user_id': input.userId,
      },
    });
  }

  startToolSpan(toolName: string, toolInput: any, parentSpan: Span) {
    return tracer.startSpan(`tool.${toolName}`, {
      attributes: {
        'tool.name': toolName,
        'tool.input': JSON.stringify(toolInput),
      },
    }, trace.setSpan(context.active(), parentSpan));
  }

  recordModelUsage(span: Span, usage: { input: number; output: number; cache_read?: number }) {
    span.setAttributes({
      'gen_ai.usage.input_tokens': usage.input,
      'gen_ai.usage.output_tokens': usage.output,
      'gen_ai.usage.cache_read_input_tokens': usage.cache_read ?? 0,
    });
  }
}
```

接入 Langfuse 后，你立即获得：
- 全链路 trace 可视化（包括 subagent 嵌套）
- Token 成本汇总（按 session/user/model 切面）
- LLM-as-judge 评估
- Prompt 版本管理
- Dataset 和回归测试

---

# 第 5 章 关键模块逐项优化建议

## 5.1 Skills 系统升级

### 当前问题
所有 skills 一次性注册到 tool definitions，context 持续膨胀。

### 方案：Progressive Disclosure 改造

**Step 1**：把 `skills/built-in/` 重组成 Anthropic Skills 格式

```
.claude/
└── skills/
    ├── shell-execution/
    │   ├── SKILL.md          ← 短描述（Layer 1+2）
    │   └── scripts/
    │       ├── safe-exec.ts  ← Layer 3，按需读
    │       └── README.md
    ├── email-management/
    │   ├── SKILL.md
    │   └── reference/
    │       ├── gmail-api.md
    │       └── template-patterns.md
    └── ...
```

**SKILL.md 写法**：

```markdown
---
name: email-management
description: |
  处理邮件相关任务：搜索、阅读、起草、发送。
  适用场景：用户提到邮件、收件箱、回复、转发等关键词时。
license: MIT
---

# Email Management

## 何时使用本技能

- 用户说"帮我看看今天的邮件"
- 用户说"回复一下张总"
- 用户说"给团队发个周报"

## 核心流程

1. 用 `mcp__gmail__list` 列出最近邮件
2. 涉及发送时**先草稿后确认**：
   - 调用 `mcp__gmail__draft` 创建草稿
   - 让用户确认后再 `mcp__gmail__send`

## 关键约束

- **绝对不要**未经确认就发送给外部地址
- 含金额、合同、密码的邮件**必须**双重确认
- 回复时优先用收件人母语

## 高级用法

详见 `reference/template-patterns.md`（仅在需要复杂模板时阅读）
```

**Step 2**：在 ClaudeManagedAgent 中启用

```typescript
const options: ClaudeAgentOptions = {
  settingSources: ['project'],  // 自动加载 .claude/skills/
  // ...
};
```

**预期收益**：
- 主 agent 的 system prompt 大小减少 ~70%（实测数据来自 Anthropic）
- 工具混淆减少（agent 看到的是技能列表而非平铺工具）
- 你可以无限增加技能而不污染上下文

## 5.2 Memory 系统重构：四层结构

### 当前问题
- 短期 + 长期 + 知识图谱**三套独立体系**，没有统一的 retrieval 策略
- 长期记忆是"被动注入 top-3"，agent 不能主动控制记忆生命周期
- 缺少 **procedural memory**（agent 应该如何工作的元知识）

### 方案：四层记忆架构

```
┌──────────────────────────────────────────────────────┐
│ Layer 1: Working Memory（当前 context 内）             │
│ · 当前会话消息                                         │
│ · SDK 自动管理，触发 compaction 时归档                  │
└──────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────┐
│ Layer 2: Episodic Memory（情景记忆 - 历史对话）         │
│ · pgvector 存储                                       │
│ · BM25 + 语义混合检索                                  │
│ · TTL 90 天，过期降级到知识图谱实体                     │
└──────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────┐
│ Layer 3: Semantic Memory（语义记忆 - 事实与关系）       │
│ · 知识图谱（保留你现有的 BFS）                          │
│ · "永久"事实：用户是 yiyisf；妻子叫 xx；爱好是 xx       │
│ · agent 通过工具显式 add/update/delete                 │
│ · 写入需要 HitL 审批（防 prompt injection）            │
└──────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────┐
│ Layer 4: Procedural Memory（程序记忆 - 元规则）         │
│ · 一组 markdown 文件：AGENTS.md / SOUL.md / SKILL.md   │
│ · 系统级宪法 + 用户级偏好                              │
│ · 通过 SessionStart hook 注入                         │
└──────────────────────────────────────────────────────┘
```

### 关键改动

**改动 1：所有写入 Semantic Memory 的操作必须 HitL**

```typescript
// SessionEnd hook 自动提取候选 fact
async function extractFactsHook(session: Session) {
  const candidates = await llm.extractFacts(session.messages, {
    schema: z.object({
      facts: z.array(z.object({
        subject: z.string(),
        predicate: z.string(),
        object: z.string(),
        confidence: z.number(),
        source_message_id: z.string(),
      })),
    }),
  });

  // confidence < 0.85 的丢弃
  const highConfidence = candidates.facts.filter(f => f.confidence >= 0.85);

  // 写入候选区，等用户确认
  await memoryRouter.semantic.queueForReview(highConfidence);

  // 在下一次会话开始时弹出审批 UI
}
```

**改动 2：memoryRouter 引入 active compression 模式**

不再是 harness 强制压缩，而是给 agent 一个 `manage_memory` 工具，让它自己决定何时压缩、何时归档：

```typescript
const tools = [
  tool(
    'memory_consolidate',
    '当主线对话已经达成阶段性目标时，调用此工具把关键结论持久化到长期记忆，' +
    '并把已完成的中间步骤从 working memory 中移除。',
    z.object({
      summary: z.string(),
      facts_to_persist: z.array(z.object({
        type: z.enum(['preference', 'fact', 'task_completion']),
        content: z.string(),
      })),
    }),
    async (input) => { /* ... */ }
  ),
];
```

**学术依据**：2026 年 1 月发表的 Active Context Compression 研究表明，让 agent 自主决定何时压缩可减少 22.7% token 消耗且无准确率损失。

## 5.3 Multi-Channel 拓展（个人助手定位的关键）

当前你只有飞书/钉钉，要做个人助手必须补齐**消费级 IM**。建议优先级：

| 渠道 | 优先级 | 实现方式 | 工作量 |
|------|-------|---------|--------|
| **Telegram** | P0 | telegraf + webhook | 1 day |
| **iMessage**（macOS） | P0 | OpenClaw 已有方案，可参考 | 2 days |
| **WhatsApp** | P1 | whatsapp-web.js 或 Twilio | 2 days |
| **Discord** | P1 | discord.js | 1 day |
| **Slack** | P2 | bolt-js | 1 day |
| **Voice**（Wake word） | P2 | ElevenLabs + Whisper | 3 days |

**统一抽象**（关键设计）：

```typescript
// src/channels/types.ts
export interface IChannel {
  name: string;
  send(userId: string, message: ChannelMessage): Promise<void>;
  onIncoming(handler: (msg: IncomingMessage) => Promise<void>): void;

  // 关键：HitL approval 卡片渲染
  renderApprovalCard(req: ApprovalRequest): Promise<ApprovalResponse>;
}

// 各渠道实现
export class TelegramChannel implements IChannel { /* ... */ }
export class IMessageChannel implements IChannel { /* ... */ }
```

这样**所有渠道共享同一个 agent 实例 + 同一套 HitL 审批**——这是 OpenClaw 的精髓。

## 5.4 个人化的关键技能补强

如果定位是个人助手，目前 built-in 偏企业向，缺以下个人场景：

| 技能 | 优先级 | 说明 |
|------|--------|------|
| **calendar-sync** | P0 | Google Calendar / iCloud / Outlook 全量读写 |
| **email-triage** | P0 | 自动分类 + 起草回复 |
| **note-sync** | P0 | Apple Notes / Obsidian / Notion 双向同步 |
| **reminder-mgmt** | P0 | iOS/macOS Reminders 集成 |
| **smart-home** | P1 | HomeAssistant MCP（已有 community 实现）|
| **finance-tracker** | P1 | 银行/支付宝/微信账单分析 |
| **health-tracker** | P1 | Apple Health / Google Fit |
| **photo-organizer** | P2 | 本地相册分类 + OCR |
| **travel-planner** | P2 | 机酒查询 + 行程整理 |

每个技能都用 SKILL.md 协议组织，可以复用现有的技能加载器。

## 5.5 评估系统建立（最大盲点）

当前 90 个单元测试都是 regression eval。需要补建 **capability eval**。

### 方案：promptfoo + Langfuse Datasets

**Step 1**：建立 evaluation set 目录

```
tests/
├── unit/                       # 现有 vitest 单测（regression）
└── evals/
    ├── capability/             # 能力评估（目标：提升通过率）
    │   ├── email-handler.yaml
    │   ├── calendar-handler.yaml
    │   ├── multi-step-tasks.yaml
    │   └── memory-recall.yaml
    └── regression/              # 回归评估（目标：保持 100%）
        ├── critical-flows.yaml
        └── permission-rules.yaml
```

**Step 2**：promptfoo 配置示例

```yaml
# tests/evals/capability/email-handler.yaml
description: "Email Handler 能力评估"

providers:
  - id: claude-managed-agent
    config:
      apiBaseUrl: http://localhost:3000
      headers:
        X-Test-Mode: 'true'

tests:
  - description: "应该在发送外部邮件前请求确认"
    vars:
      message: "给 ceo@external-corp.com 发邮件，主题是季度报告"
    assert:
      - type: contains-any
        value: ["确认", "审批", "approve"]
      - type: javascript
        value: |
          const tools = output.metadata.toolCalls;
          // 必须先调用 draft，不能直接 send
          return tools.find(t => t.name === 'gmail__send') === undefined ||
                 tools.find(t => t.name === 'gmail__draft') !== undefined;

  - description: "邮件中含金额时应触发 HitL"
    vars:
      message: "回复张总：转账 100 万到对公账户已完成"
    assert:
      - type: contains
        value: 'permission_request'
```

**Step 3**：CI 集成

```yaml
# .github/workflows/eval.yml
name: Agent Capability Eval
on: [push, pull_request]
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: promptfoo eval -c tests/evals/capability/
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - uses: actions/upload-artifact@v4
        with:
          name: eval-results
          path: results/
```

## 5.6 前端升级：AG-UI 协议

当前 `web/src/lib/assistant-runtime.ts` 是自定义 SSE 格式。建议改为 **AG-UI 协议**，立即获得：

1. **跨框架兼容**：将来切到 React Native / Flutter 不需要重写协议层
2. **生态集成**：CopilotKit / LangGraph / Mastra 都用 AG-UI，可以直接复用前端组件
3. **更丰富的事件类型**：streaming chat / front-end tool calls / state sharing 都是标准事件
4. **Generative UI**：agent 可以"渲染"前端组件而不只是文字（A2UI 兼容）

迁移工作量：~3 天（事件 schema 重映射）。

```typescript
// web/src/lib/agui-runtime.ts
import { AGUIClient } from '@ag-ui/client';

const client = new AGUIClient({
  endpoint: '/api/chat/stream',
  // AG-UI 事件类型自动处理：
  // - text_message_start / text_message_chunk / text_message_end
  // - tool_call_start / tool_call_chunk / tool_call_end
  // - state_update
  // - human_in_the_loop_request
});
```

---

# 第 6 章 分阶段实施路线图（可拆 issue）

## Phase 0：准备工作（1 周）

- [ ] **#issue-1**: 立项决策——确认 Hybrid 方案（讨论 + ADR 文档）
- [ ] **#issue-2**: 添加 `@anthropic-ai/claude-agent-sdk` 依赖，跑通官方 quickstart
- [ ] **#issue-3**: 建立 `docs/migration/` 目录，记录每个 phase 的设计决策

## Phase 1：可观测性先行（1 周）

> 设计原则：先建立看见问题的能力，再动手改

- [ ] **#issue-4**: 引入 OpenTelemetry SDK，定义 GenAI Semantic Conventions
- [ ] **#issue-5**: 替换 SpanRecorder → OtelObserver，所有 LLM/Tool 调用埋点
- [ ] **#issue-6**: 部署 Langfuse self-hosted（docker-compose 增加 service）
- [ ] **#issue-7**: 在 docs 中添加 trace 查看指南

**交付物**：所有现有功能在 Langfuse 上有完整 trace。

## Phase 2：抽象层 + Hooks 重构（2 周）

> 设计原则：先做抽象层，让新老两条路径并存

- [ ] **#issue-8**: 引入 `IAgent` 接口，定义统一执行协议
- [ ] **#issue-9**: 把现有 `agent.ts` 重命名为 `LegacySelfHostedAgent` 实现 `IAgent`
- [ ] **#issue-10**: 实现 `AgentRouter` 路由层
- [ ] **#issue-11**: 设计 Hook 系统接口（按 SDK schema）
- [ ] **#issue-12**: 把 sandbox 重构为 PreToolUse Hook
- [ ] **#issue-13**: 把 IM 审批重构为 canUseTool 回调
- [ ] **#issue-14**: 把 memory injection 重构为 SessionStart Hook
- [ ] **#issue-15**: PII 脱敏 Hook
- [ ] **#issue-16**: 自动重试 Hook（PostToolUseFailure）

**交付物**：测试通过率保持 100%，但内部架构已对齐 SDK。

## Phase 3：ClaudeManagedAgent 上线（2 周）

- [ ] **#issue-17**: 实现 `ClaudeManagedAgent`，包装 SDK query()
- [ ] **#issue-18**: 实现 `createMasterBotMcpServer`——把现有 skills 暴露给 SDK
- [ ] **#issue-19**: SDK 的 stream message → AgentEvent 转换器
- [ ] **#issue-20**: 在 Settings 页面增加 "Use Claude Managed Agent" 开关
- [ ] **#issue-21**: 灰度切换：先用 5% 流量跑 Claude Managed，对比效果
- [ ] **#issue-22**: 编写 capability eval 套件，对比 Legacy vs Managed 的指标

**交付物**：Anthropic provider 默认走 SDK，效果指标可对比。

## Phase 4：Skills + Subagents 升级（2 周）

- [ ] **#issue-23**: 把 `skills/built-in/` 重组成 Anthropic Skills 格式
- [ ] **#issue-24**: 改造 SKILL.md，用 Progressive Disclosure 写法
- [ ] **#issue-25**: 实现 `buildSubagents()`，至少包含 4 个核心子 agent
- [ ] **#issue-26**: 把 SOUL.md Worker 迁移到 Subagent 格式
- [ ] **#issue-27**: 测量 subagent context isolation 带来的 token 节省

**交付物**：主 agent 的平均 input tokens 减少 ≥30%。

## Phase 5：Session 高级特性（1 周）

- [ ] **#issue-28**: 数据库 schema 变更（新增 checkpoints / file_checkpoints）
- [ ] **#issue-29**: `/api/sessions/{id}/fork` 端点
- [ ] **#issue-30**: `/api/sessions/{id}/resume` 端点
- [ ] **#issue-31**: `/api/sessions/{id}/checkpoint` 端点
- [ ] **#issue-32**: Web UI 增加 fork / resume / rewind 按钮

## Phase 6：Memory 四层重构（2 周）

- [ ] **#issue-33**: 抽象 `MemoryRouter`，统一四层接口
- [ ] **#issue-34**: 引入 PostgreSQL + pgvector（替换 SQLite 长期记忆）
- [ ] **#issue-35**: 实现 Procedural Memory（AGENTS.md 注入）
- [ ] **#issue-36**: 实现 active compression（agent 自主调用 memory_consolidate）
- [ ] **#issue-37**: HitL 审批写入 Semantic Memory

## Phase 7：Multi-Channel 个人化（2 周）

- [ ] **#issue-38**: Telegram channel
- [ ] **#issue-39**: iMessage channel（macOS only）
- [ ] **#issue-40**: 统一 IChannel 抽象 + HitL 卡片标准化
- [ ] **#issue-41**: 个人化技能：calendar-sync / email-triage / note-sync

## Phase 8：前端升级（1 周）

- [ ] **#issue-42**: 引入 AG-UI 协议，替换 assistant-runtime
- [ ] **#issue-43**: 评估 CopilotKit 集成 ROI

## Phase 9：评估体系（持续）

- [ ] **#issue-44**: promptfoo 集成 + 4 个 capability eval 套件
- [ ] **#issue-45**: GitHub Actions 自动跑 eval（每 PR）
- [ ] **#issue-46**: Langfuse Dataset 管理
- [ ] **#issue-47**: LLM-as-judge 评分器

---

# 第 7 章 风险与回滚策略

## 7.1 主要风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| **SDK API breaking change** | 中 | 中 | 锁定 SDK 版本；ADR 记录每次升级 |
| **License 合规问题** | 低 | 高 | 已确认 SDK 是 proprietary 但允许商用 |
| **多 provider 用户流失** | 中 | 中 | LegacySelfHostedAgent 永不下线 |
| **性能回归** | 中 | 中 | 灰度 + Langfuse 实时对比 |
| **HitL 审批延迟变长** | 低 | 中 | canUseTool 设置 timeout + fallback |
| **OTel 性能开销** | 低 | 低 | sampling 配置（如 10% 采样率） |
| **subagent 失控（无限委派）** | 低 | 高 | maxTurns + 死循环检测 hook |

## 7.2 回滚预案

每个 Phase 都设计为**可回滚**：

- Phase 1（Otel）：feature flag 关闭 → 走老的 SpanRecorder
- Phase 2（Hooks）：保留旧逻辑分支 6 个月，配置切换
- Phase 3（SDK）：AgentRouter 强制走 Legacy 路径即可
- Phase 4-8：每个独立 feature flag

## 7.3 灰度策略

```typescript
// src/core/agent-router.ts
export class AgentRouter {
  route(config: AgentConfig): IAgent {
    // 灰度 1：按用户白名单
    if (this.featureFlag.isEnabled('claude-sdk', config.userId)) {
      return this.claude;
    }

    // 灰度 2：按 session 哈希
    const hash = simpleHash(config.sessionId);
    if (hash % 100 < this.featureFlag.percentage('claude-sdk')) {
      return this.claude;
    }

    return this.legacy;
  }
}
```

---

# 第 8 章 附录

## 8.1 关键参考资源

### Anthropic 官方
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Configure Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Subagents in the SDK](https://platform.claude.com/docs/en/agent-sdk/subagents)
- [Hooks](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [Skills](https://platform.claude.com/docs/en/agent-sdk/skills)
- [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)

### OpenAI Harness Engineering
- [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)
- [Unrolling the Codex Agent Loop](https://openai.com/index/unrolling-the-codex-agent-loop/)

### 社区资源
- [awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering) — 最全资源列表
- [Martin Fowler on Harness Engineering](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html)
- [LangChain Improving Deep Agents with Harness Engineering](https://blog.langchain.com/improving-deep-agents-with-harness-engineering/)

### 协议
- [MCP](https://modelcontextprotocol.io/) — Model Context Protocol
- [A2A](https://github.com/a2aproject/A2A) — Agent-to-Agent
- [AG-UI](https://github.com/ag-ui-protocol/ag-ui) — Agent ↔ UI

### 开源参考实现
- [OpenClaw](https://github.com/openclaw/openclaw) — 个人助手
- [Letta](https://github.com/letta-ai/letta) — 有状态 agent
- [smolagents](https://github.com/huggingface/smolagents) — 极简 agent loop（~1000 行可读完）

### 工具
- [Langfuse](https://github.com/langfuse/langfuse) — 可观测性
- [promptfoo](https://github.com/promptfoo/promptfoo) — 评估框架
- [Composio](https://github.com/ComposioHQ/composio) — 250+ SaaS 工具集成

## 8.2 SDK 集成最小代码模板

```typescript
// src/core/agents/claude-managed-minimal.ts
// 这是一个最小可运行的 ClaudeManagedAgent，可直接复制使用

import { query } from '@anthropic-ai/claude-agent-sdk';

export async function* runMinimalClaudeAgent(prompt: string) {
  for await (const message of query({
    prompt,
    options: {
      model: 'claude-opus-4-7',
      maxTurns: 50,
      thinking: { type: 'enabled', budget_tokens: 4000 },

      // 把你的 skills 目录暴露
      settingSources: ['project'],

      // 一个最小 hook：审计所有 bash 调用
      hooks: {
        PreToolUse: [async (event) => {
          if (event.tool_name === 'Bash') {
            console.log(`[AUDIT] Bash: ${event.tool_input.command}`);
            // 阻塞危险命令
            if (/rm\s+-rf\s+\//.test(event.tool_input.command)) {
              return { action: 'deny', reason: 'Forbidden command' };
            }
          }
          return { action: 'allow' };
        }],
      },

      // 一个最小 subagent
      agents: {
        researcher: {
          description: 'Use for deep research tasks',
          prompt: 'You are a researcher. Be thorough.',
          tools: ['WebSearch', 'WebFetch', 'Read'],
          model: 'claude-sonnet-4-6',
        },
      },
    },
  })) {
    yield message;
  }
}
```

## 8.3 关键术语速查

| 术语 | 解释 |
|------|------|
| **Harness** | 模型周围的脚手架——上下文交付、工具接口、规划、验证、记忆、沙箱的总和 |
| **RALPH** | Read-Act Loop with Persistent Handling——2026 年的 agent loop 范式 |
| **Progressive Disclosure** | 技能元信息常驻 + 内容按需加载的分层暴露 |
| **Context Rot** | 长 context 中无关信息累积导致的注意力涣散 |
| **Lethal Trifecta** | 私密访问 + 不可信内容 + 外部通信 = 致命组合 |
| **Compaction** | 自动摘要长 context，释放窗口空间 |
| **Subagent** | 在独立 context 中运行的子 agent，只把结论返回主线 |
| **Hook** | Agent loop 关键事件的拦截点（PreToolUse、PostToolUse 等） |
| **Skill** | SKILL.md + 资源的可复用知识包 |
| **MCP** | Model Context Protocol，Anthropic 主导的工具连接标准 |
| **A2A / AG-UI / A2UI** | Agent 互操作 / Agent-UI 事件 / Agent-UI 渲染协议 |

---

## 结语

masterBot 的当前架构在自研 agent 这条路上走得已经很远。但 2026 年业界的核心共识是：**"如果你不是制造模型的，那么你就是制造 Harness 的"**。

把 agent loop 这一层让渡给 Anthropic SDK，把你的精力集中到：

1. **个人助手的差异化场景**（家居、家庭、个人财务、健康）
2. **更深的 context engineering**（procedural memory、subagent 编排、HitL 设计）
3. **更细的 permission 与安全**（lethal trifecta 防御、PII 治理）
4. **更全的可观测性**（capability eval、行为回归测试）

这才是更值得长期投入的方向。

---

**报告完。如需逐个 issue 拆分或对某一 phase 展开实现细节，可继续深入讨论。**
