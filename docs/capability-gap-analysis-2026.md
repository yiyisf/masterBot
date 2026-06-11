# CMaster Bot — 能力差距分析与升级方向规划（2026-06）

> **目标**：基于对主分支（master，约 11k 行后端代码，Phase 1–26+ 已落地）的全量代码审查，对照 2026 年中业界 AI Agent 系统的最新实践，识别能力差距，给出不局限于现有架构的功能升级方向建议。
>
> **定位**：与 `docs/roadmap.md`（已完成 Phase 记录）和 `docs/next-gen-capabilities.md`（业务场景规划）互补，本文聚焦**技术能力基线 vs 业界最新实践**的工程差距。

---

## 一、现状能力盘点（基于代码审查）

### 1.1 已达到或接近业界水准的能力 ✅

| 能力 | 实现位置 | 评价 |
|------|---------|------|
| ReAct 循环 + 原生 function calling | `src/core/agent.ts`（AsyncGenerator 流式，支持 Anthropic `tool_use` / OpenAI `tool_calls`） | 业界标准做法 |
| 并行工具调用 | `agent.ts` `handleExternalToolCalls`（Promise.allSettled） | ✓ |
| 自适应复杂度路由 | `src/core/complexity-classifier.ts`，Tier 1/2/3 动态调整迭代上限与模型 | 领先于多数开源框架 |
| 上下文压缩 | `src/core/context-manager.ts`：滑动窗口 + LLM 摘要 + CJK tokenizer + 压缩事件上报 + 超限自动恢复 | 接近业界主流 |
| DAG 任务编排 | `src/core/dag-executor.ts` / `task-repository.ts`：Kahn 环检测、条件执行、优先级、重试 | ✓ |
| 托管 Agent 容器 | `src/core/harness/`：AgentSpec 声明式定义、工具权限过滤、生命周期 Hook、Grader 修订循环、暂停/恢复/取消 | 对标 Managed Agents 架构，设计先进 |
| 多 Agent 协作 | AgentPool + AgentBus（pub/sub + request-reply）、SOUL.md 声明式 Worker、流式委派、子 Agent 步骤聚合 | 内部协作完善 |
| 断点恢复 | `src/core/checkpoint-manager.ts` 会话检查点 | ✓ |
| Human-in-the-Loop | InterruptCoordinator + 飞书卡片审批 + 超时看护 + 前端 interrupt UI | 完整闭环，领先 |
| MCP 客户端 | `src/skills/mcp-source.ts`：stdio / SSE / **streamable-http** 三传输 + 指数退避重连 + Registry 安装 | 传输层齐全 |
| 审计与追踪 | `audit-repository.ts`（执行/审批记录 + CSV 导出）、`trace.ts`（trace_id/parent_id span → SQLite） | 自研方案完整 |
| 技能热加载 / 自动生成 | SKILL.md 协议 + SkillGenerator（NL → 技能 → 热加载） | 自进化能力领先 |
| 浏览器 RPA | Playwright（`skills/built-in/browser-automation`） | ✓ |
| 工程化 | CI（tsc + vitest + web build）、多阶段 Docker、13 个测试文件 | 基础合格 |

### 1.2 部分实现 / 存在短板 ⚠️

| 能力 | 现状 | 短板 |
|------|------|------|
| 语义检索 | 仅 SQLite FTS5 全文检索（LIKE 降级），`src/memory/long-term.ts` | **无向量检索、无 rerank**，同义改写/跨语言召回弱 |
| 知识图谱 RAG | `knowledge-graph.ts` BFS + MemoryRouter 混合检索 | 无 embedding 召回兜底，图谱依赖摄入质量 |
| 记忆治理 | 6 类记忆 + MEMORY.md 索引注入 | 无冲突检测、置信度、衰减/过期机制（2026 年「记忆幻觉」已被公认为生产环境头号故障源） |
| 推理模型支持 | Tier 3 可切换 deepThinking LLM | 无 extended thinking / reasoning_effort 参数透传，无思维链 token 预算控制 |
| 可观测性 | 自研 SpanRecorder + token_usage 表 + pino 日志 | **无 OpenTelemetry 导出**，无法接入 Jaeger/Datadog/Grafana 标准链路 |
| 评测 | Grader 运行时结果评分 + 修订循环 | **无离线评测体系**：无评测数据集、无 CI 回归、无轨迹级（trajectory）评测 |
| 沙箱 | 正则黑名单/白名单（`sandbox.ts`，19 个 Unix 危险模式） | 字符串匹配可被编码/变量拼接绕过，**无 OS 级隔离** |
| 安全治理 | 认证（API Key/JWT）+ 审计 + SQL 只读沙箱 + PII masking | 无速率限制实装、无多租户 RBAC、无 prompt injection 防护层 |
| SDK 版本 | Anthropic SDK ^0.30、OpenAI SDK ^4.77 | 落后主线版本，无法使用 prompt caching、原生 thinking、structured outputs 等新 API 能力 |

### 1.3 完全缺失 ❌

向量检索/embedding 管道、rerank、prompt caching、OpenTelemetry、速率限制、A2A 协议、MCP Server 模式（对外暴露自身能力）、MCP 2025-11 新特性（elicitation/async tasks/sampling/OAuth 2.1）、离线 Agent 评测、语音交互、OS 级 Computer Use、Generative UI、多租户 RBAC/SSO。

---

## 二、业界最新实践基准（2026 年中扫描）

1. **上下文工程成为一级学科**：业界（以 Anthropic《Effective Context Engineering for AI Agents》为代表）确立三大技术：**compaction（压缩）、structured note-taking（结构化笔记外存）、sub-agent 隔离上下文**；新增轻量手段 **tool result clearing**（清除深历史的工具原始输出、保留消息骨架）。「即时代理式检索（agentic search：glob/grep 式按需探索）优于预建索引」成为代码/文件场景共识。
2. **记忆与 RAG 架构分离**：2026 年生产事故统计中「记忆幻觉」（检索到自身历史中冲突/过期事实）居首；最佳实践是把 Memory（有状态、跨会话、需冲突治理）与 RAG（无状态、查询时检索）作为两个独立组件，记忆需要写入策略、置信度与失效机制。
3. **混合检索成为 RAG 标配**：BM25/FTS + 向量 + rerank 三段式；轻量场景用 `sqlite-vec` 等嵌入式向量方案，避免引入外部向量库运维负担。
4. **MCP 进入第二代**：2025-11 规范引入 **async tasks、elicitation（服务端中途请求结构化用户输入）、增强 sampling、服务端 agent loop、OAuth 2.1、extensions**；Streamable HTTP 取代 SSE 成为推荐远程传输。企业级形态是「既做 MCP 客户端、也把自身能力发布为 MCP Server」。
5. **A2A 成为多 Agent 横向互操作标准**：Google 2025-04 发布、已捐赠 Linux Foundation；「MCP 纵向连工具 + A2A 横向连 Agent」两层协议栈成为企业默认架构，2026 Q3 将开展 MCP/A2A 联合规范工作。
6. **可观测性标准化**：OpenTelemetry **GenAI Semantic Conventions** 覆盖 LLM 调用 span、agent span、MCP 工具调用、token/成本指标与质量评估事件；Datadog/Grafana/Uptrace 等已原生支持，自研 trace 方案普遍走「双发（dual-emission）」迁移路径。
7. **评测左移**：Agent evals 进入 CI——固定任务集 + LLM-as-judge + 轨迹断言（工具调用序列、步数、成本预算），上线前回归与生产采样回灌评测集闭环。
8. **成本工程**：prompt caching（Anthropic/OpenAI 原生支持，长系统提示词 + 工具定义场景节省 50–90% 输入成本）、模型路由（按复杂度路由到便宜模型 + 失败回退链）、Batch API。
9. **头部框架格局**：LangGraph（图式状态机）、Claude Agent SDK、CrewAI、AutoGen/AG2、Pydantic AI 为 2026 主流；共同收敛的能力面是 **durable execution（持久化可恢复执行）、HitL、子 Agent、评测钩子、OTel 集成**。
10. **执行环境隔离升级**：工具执行从「命令黑名单」转向 **容器/microVM/seccomp 级沙箱**（如 E2B、Firecracker 方案），文件系统与网络默认隔离、白名单放行。

---

## 三、差距矩阵

| # | 维度 | 业界基准（2026） | CMaster 现状 | 差距 | 影响 |
|---|------|-----------------|--------------|------|------|
| G1 | 语义检索 | FTS + 向量 + rerank 混合三段式 | 仅 FTS5/LIKE | **大** | 召回质量直接拖累记忆、知识图谱、NL2Insight 全链路 |
| G2 | 记忆治理 | 冲突检测、置信度、衰减、写入策略 | 仅分类存储 + 索引注入 | **大** | 长期运行后记忆幻觉风险 |
| G3 | 成本工程 | prompt caching + 模型路由 + 成本预算 | 仅 token 统计 | **大** | 长系统提示 + 大工具集场景成本可降 50%+ |
| G4 | 可观测性 | OTel GenAI 语义约定 + 标准后端 | 自研 SQLite span | **中** | 无法融入企业既有监控体系 |
| G5 | 评测体系 | 离线 eval 数据集 + CI 回归 + 轨迹评测 | 仅运行时 Grader | **大** | 改 prompt/换模型无回归保障，质量不可度量 |
| G6 | MCP 深度 | 2025-11 新特性 + Server 模式 | 三传输客户端（旧规范） | **中** | elicitation 恰好契合已有 HitL；Server 模式打开生态出口 |
| G7 | A2A 互操作 | MCP+A2A 两层协议栈 | 内部 AgentBus 私有协议 | **中** | 无法与外部 Agent 生态互通 |
| G8 | 推理模型 | extended thinking / reasoning effort 透传与预算 | 仅切换模型 | **中** | Tier 3 深度任务效果打折 |
| G9 | 执行沙箱 | 容器/microVM 隔离 | 正则黑名单 | **大**（安全） | 企业落地的合规硬门槛 |
| G10 | 多租户与限流 | RBAC + SSO + per-user 限流 | 单租户、无限流 | **大**（企业） | v1.0 既定目标，仍未启动 |
| G11 | 上下文工程 | tool result clearing + 结构化笔记 | 滑动窗口 + 摘要 | **小** | 低成本增量优化 |
| G12 | 交互形态 | Generative UI、语音入口 | 文本 + 图表渲染 | **中** | 体验代差 |
| G13 | Computer Use | OS 级视觉操作 API | 仅 Playwright 浏览器 | **小**（场景驱动） | 遗留桌面系统 RPA 盲区 |

---

## 四、升级方向建议

### P0 — 基线补齐（最高投入产出比，建议 1–2 个迭代内完成）

#### U1. 混合语义检索层（对应 G1）
- **方案**：引入 `sqlite-vec` 扩展（零外部依赖，契合现有 node:sqlite 架构）；embedding 复用 OpenAI 适配器既有 `embed()`（`src/llm/openai.ts`），Ollama 本地模型兜底内网场景；检索链 = FTS5 召回 ∪ 向量召回 → LLM listwise rerank（轻量，无需独立 rerank 模型）。
- **改造点**：`src/memory/long-term.ts` 增加向量列与双路召回；`MemoryRouter.search()` 统一融合；知识图谱节点同步向量化。
- **验收**：中文同义改写查询召回率显著提升；检索延迟 < 200ms；外网不可用时自动降级 FTS5。

#### U2. Prompt Caching + SDK 升级（对应 G3、G8）
- **方案**：升级 Anthropic / OpenAI SDK 到当前主线版本；系统提示词 + 工具定义段落标记 `cache_control`（Anthropic）；OpenAI 自动缓存对齐前缀稳定性（把易变内容移到消息尾部）；同步透传 `thinking` / `reasoning_effort` 参数到 Tier 3。
- **改造点**：`src/llm/anthropic.ts` / `openai.ts` / `factory.ts`；`agent.ts` 系统提示构造顺序调整（稳定段前置）。
- **验收**：长会话输入 token 成本下降 ≥ 50%（token_usage 表可直接度量）；Tier 3 支持思维链预算配置。

#### U3. 离线评测体系（对应 G5）
- **方案**：新建 `evals/` 目录：任务集（YAML：输入、期望工具序列、结果断言）+ 评测 Runner（复用 AgentHarness + Grader，离线模式）+ 轨迹断言（步数上限、成本上限、必须/禁止调用的工具）；接入 CI 作为可选 gate（标记 flaky 容忍度）。
- **改造点**：复用 `src/core/harness/grader.ts`；`agent_spans` 表已有轨迹数据可直接断言；CI 增加 `npm run eval` job。
- **验收**：≥ 20 个核心场景用例；prompt/模型变更时 CI 给出质量回归报告。

#### U4. OpenTelemetry 双发导出（对应 G4）
- **方案**：保留现有 SpanRecorder（UI 依赖），在 `trace.ts` 增加 OTLP exporter，按 GenAI Semantic Conventions 映射（`gen_ai.agent.*`、`gen_ai.tool.*`、token 用量属性）；可配置开关，默认关闭。
- **验收**：接入任意 OTLP 后端（Jaeger 本地验证）可看到完整 agent → tool → LLM 调用链与成本属性。

### P1 — 架构升级（差异化竞争力，2–4 个迭代）

#### U5. 记忆治理引擎（对应 G2）
- **方案**：记忆条目增加 `confidence`、`last_verified_at`、`supersedes` 字段；写入时 LLM 查重/冲突检测（复用 `knowledge-graph.ts` 已有 `detectConflicts()` 思路下沉到 LTM）；周期性反思任务（SchedulerService 已具备）合并冗余、降权过期记忆；召回时按 置信度 × 时近性 加权。
- **价值**：直接对冲 2026 年生产环境头号故障模式「记忆幻觉」。

#### U6. MCP 第二代特性 + Server 模式（对应 G6）
- **方案**：
  - 客户端：支持 elicitation（**映射到既有 InterruptCoordinator + 飞书卡片，几乎零新增交互成本**）、async tasks、OAuth 2.1 远程授权。
  - 服务端：新增 `src/gateway/mcp-server.ts`，把技能注册表（`registry.ts` 已有工具定义转换）作为 MCP Server 经 streamable HTTP 暴露——CMaster 的全部技能即刻可被 Claude Code / 任意 MCP 客户端调用。
- **价值**：从「MCP 消费者」升级为「MCP 生态节点」，企业内技能资产可复用。

#### U7. A2A 协议适配（对应 G7）
- **方案**：为 AgentPool 增加 A2A 适配层：发布 Agent Card（能力描述，源自既有 AgentSpec/SOUL.md）、实现 task 生命周期端点；AgentBus 内部协议保持不变，A2A 作为对外网关（`/a2a/*`）。
- **价值**：与外部 Agent（含其他部门/厂商系统）标准化互操作，符合「MCP 纵向 + A2A 横向」业界架构。

#### U8. 执行沙箱硬隔离（对应 G9）
- **方案**：分级执行策略——低风险命令走现有黑名单快路径；中高风险（写文件系统/网络/包安装）路由到容器沙箱（Docker run --rm + 只读根 + 网络白名单 + 资源限额；已有 Docker 基础设施可复用）；沙箱判级复用 complexity-classifier 模式做命令风险分类。
- **价值**：企业合规硬门槛；同时解锁「放心给 Agent 更大权限」→ 能力上限提升。

#### U9. 多租户 RBAC + 限流（对应 G10，v1.0 既定目标）
- **方案**：users/roles 表 + 技能级权限门（FilteredSkillRegistry 已是现成的权限执行点）+ per-user/session 令牌桶限流（@fastify/rate-limit）+ OIDC SSO；记忆按用户隔离（SessionMemoryManager 已有会话隔离基础）。

#### U15. Loop Engineering：目标驱动自治循环（LoopSpec + LoopRunner）

> 背景：Loop Engineering 是 2026 年中被推热的工程方向（Addy Osmani、Claude Code 团队等推动）——杠杆从「写好单条 prompt」转移到「设计一个能 发现任务 → 执行 → 验证 → 纠错 → 持久化状态 → 决定下一步 的循环系统」，按计划或直到目标达成无人值守运行。核心要点：① 验证优先用确定性手段（测试/编译/日志/API 状态比对），LLM 评分仅兜底；② goal 原语——让循环自行判断「完成了没有」。

**可行性评估：高。** masterBot 是少数「循环原语已基本备齐、只差组合层」的项目：

| Loop Engineering 要素 | masterBot 对应组件 | 状态 |
|---|---|---|
| 内层执行循环 | `agent.ts` ReAct 循环 | ✅ |
| 验证→修正外循环 | Harness Grader 修订循环（OutcomeSpec + maxRevisions） | ✅ 已是雏形 |
| 目标定义 | AgentSpec `OutcomeSpec`（criteria + 权重 + required） | ✅ 即现成 goal 原语 |
| 定时/事件触发 | SchedulerService（Cron）+ Webhook 入站（HMAC） | ✅ |
| 任务发现与分解 | DAG executor + `plan_task` | ✅ |
| 状态持久化 | CheckpointManager + 长期记忆 | ✅ |
| 子 Agent 分派 | AgentPool + AgentBus | ✅ |
| 卡住时升级人工 | InterruptCoordinator + 飞书 HitL | ✅ |
| 预算/熔断 | token_usage 仅统计，无熔断 | ⚠️ 缺 |
| 确定性验证器 | Grader 仅 LLM-as-judge | ⚠️ 缺 |
| 循环级声明式定义 | Runbook 是「步骤声明式」，非「目标声明式」 | ❌ 缺 |

**方案**：新增 `LoopSpec` 声明式循环定义（类比 SOUL.md / Runbook YAML）+ `LoopRunner` 组合引擎：

```yaml
goal: "保持 X 服务告警队列清零"        # OutcomeSpec 升格为循环级目标
trigger: { cron: "*/30 * * * *" }      # 或 webhook / manual
discover: alerts.list_open             # 任务发现阶段 → 喂给 DAG
execute: { agent: ops-worker }         # 复用 AgentPool
verify:                                # 确定性验证优先
  - { tool: shell.execute, assert: "exit_code == 0" }
  - { grader: ... }                    # LLM 评分仅兜底模糊准则
budgets: { maxCostUsd: 2, maxSteps: 200, maxWallClockMin: 60 }
onStall: escalate                      # → InterruptCoordinator
```

实施要点：
1. **确定性验证器（VerifierSpec）**：在 Grader 之前加 shell/http 断言层（复用 HookRunner `shell` hook 机制）——这是与业界差距最实质的一点，当前修订循环完全依赖 LLM 评分；
2. **停滞检测与熔断**：同一错误连续出现 / Grader 分数不再提升 / 预算耗尽 → 自动暂停并升级 HitL（防 runaway loop 是无人值守的安全底线，成本数据 token_usage 表已有）；
3. **循环日志/工作笔记**：每轮迭代写结构化笔记（与 U10 合并实现），跨迭代恢复不依赖完整对话历史。

**直接兑现场景**：AIOps 无人值守（Runbook 从「步骤式」升级为「目标式」）、过夜代码任务（修到测试全绿为止）、知识库持续巡检——均为 next-gen 七大场景的自治化版本。**前置依赖**：U3（评测）应先就位提供回归保护；与 U8（沙箱）、U16（Coder 引擎）强协同。

#### U16. Coder Agent 引擎升级：嵌入 Claude Agent SDK（专项分析）

**现状与问题。** 当前编码能力有两条并行路径，质量上限都不高：

1. `agents/builtin/coder/SOUL.md`：通用 ReAct Agent + `shell.*` / `file-manager.*` 工具 + Grader 修订循环（maxRevisions 3 / minScore 75）。问题：
   - **工具面太粗**：没有专用 Edit（字符串替换式编辑）、Grep/Glob 结构化检索工具，改大文件只能整文件重写，易引入无关 diff；shell 是「万能但不可治理」的工具形态（无法按动作粒度审批/审计/并行调度）。
   - **资源限额不符合编码任务形态**：15 次迭代 / 180s 超时——真实编码任务（改→跑测试→读报错→修）动辄几十上百次工具调用。
   - **验证靠 LLM 评分**：Grader 判「runnable」，但不真正跑测试。
   - **本质约束**：编码 Agent 的效果 = 模型 × Harness（系统提示、工具设计、上下文压缩、子 Agent、权限交互的多年调优）。自研通用 ReAct 循环去追 Claude Code 这类顶级编码 Harness，永远在追赶。
2. `skills/built-in/claude-code`：shell 出 `claude -p` 单发 CLI。问题：黑盒单发——内部几十次工具调用对 masterBot 完全不可见，无法流式呈现步骤、无法 HitL 审批单个工具调用、无法接入审计/追踪/沙箱，JSON 解析脆弱，且要求宿主机预装 CLI。

**方案对比：**

| 方案 | 编码效果 | 集成深度 | 依赖/约束 | 评估 |
|---|---|---|---|---|
| A. 增强自研 coder（补 Edit/Grep 工具、放宽限额、测试验证器） | 中 | 完全可控 | 无新依赖、任意模型 | 永远在追赶顶级 Harness；作为**降级路径**保留 |
| B. 维持 claude-code CLI 技能 | 高（但黑盒） | 极浅 | 需预装 CLI | 仅适合一次性问答，不适合作为受管 Agent 引擎 |
| **C. 嵌入 Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`）** | **顶级**（即 Claude Code 同款 Harness） | **深**（逐工具调用可见可控） | 需 Claude 模型访问（API/网关/Bedrock/Vertex 均可） | **推荐** |
| D. Anthropic Managed Agents（托管会话 + Outcome 评分循环） | 顶级 | 中（事件流） | 工具执行在 Anthropic 容器（或自托管 worker），数据出域 | 云端许可的组织可选；与自托管定位冲突 |

**推荐架构：引擎抽象 + Claude Agent SDK 作为 coder 引擎。**

AgentSpec 增加 `engine: native | claude-agent-sdk` 字段（默认 native，全向后兼容）。改造点恰好只有两处：`agent-harness.ts:90`（`new Agent(...)`）和 `:197`（`for await (const step of this.agent.run(...))`）——抽出 `IAgentEngine` 接口，coder spec 切换引擎：

```
AgentHarness（不变：Spec/Grader/预算/审计/HitL 的编排层）
   └─ IAgentEngine
        ├─ NativeAgentEngine        ← 现有 Agent.run()，所有非编码 Agent 不变
        └─ ClaudeAgentSdkEngine     ← coder 专用，新增
```

SDK 能力与现有组件的映射（几乎一一对应，集成成本低）：

| Claude Agent SDK 能力 | masterBot 对接点 |
|---|---|
| `query()` AsyncGenerator 流式消息 | 转译为 `ExecutionStep` yield（与 agent.ts 同范式，前端零改动） |
| `canUseTool` 权限回调 | 接 CommandSandbox 校验 + FilteredSkillRegistry 白名单 + InterruptCoordinator HitL（高危操作飞书卡片审批） |
| PreToolUse/PostToolUse hooks | 写入 audit-repository + SpanRecorder（统一追踪） |
| `resume` 会话续接 | 对接 CheckpointManager（断点恢复语义一致） |
| 进程内 MCP server（自定义工具） | **把 masterBot 技能注册表暴露给 coder**——coder 可直接调用企业连接器/通知/知识图谱技能（与 U6 MCP Server 模式同一份实现） |
| 内建：Edit/Grep/Glob/Bash 工具、CLAUDE.md、上下文压缩、子 Agent、prompt caching | 免费获得，无需自研（U2/U10 的诉求在 coder 场景直接被覆盖） |

外层闭环保持不变：Harness 仍用 OutcomeSpec + Grader 做结果评分与修订循环；叠加 U15 的确定性验证器（跑测试作为 ground truth）后，构成「顶级编码引擎 + 测试验证 + LLM 评分兜底」的完整质量链路。

**风险与对策**：
1. *模型绑定*：SDK 仅驱动 Claude 系模型。对策——engine 抽象保证 native 引擎兜底（纯内网/内部模型部署自动降级）；SDK 支持 `ANTHROPIC_BASE_URL` 网关与 Bedrock/Vertex，企业代理场景可用。
2. *执行安全*：SDK 在宿主进程执行文件/shell 工具。对策——coder 引擎默认运行在 U8 容器沙箱内（工作目录隔离 + 网络白名单），`canUseTool` 回调做第二道闸。
3. *成本*：Claude Code 式会话 token 消耗大。对策——SDK 自带 prompt caching；接入 token_usage 统计与 U15 预算熔断。
4. *可观测割裂*：SDK 内部步骤需归一。对策——hooks 全量映射到既有 span/审计表，前端 subTask 步骤聚合（Phase 26）直接复用。

**实施切分**（建议一个迭代内）：① `IAgentEngine` 抽取 + native 实现回归（纯重构，测试保护）→ ② `ClaudeAgentSdkEngine` 最小可用（query 流转译 + canUseTool 接沙箱）→ ③ HitL/审计/检查点对接 → ④ 技能注册表经进程内 MCP 暴露给 coder → ⑤ coder SOUL.md 切换 `engine: claude-agent-sdk`，用 U3 评测集对比新旧引擎的编码通过率。

### P2 — 前瞻布局（业界新兴方向，按场景需求启动）

#### U10. 上下文工程增量优化（对应 G11）
- tool result clearing：深历史的 observation 原文替换为摘要占位（比整段压缩更轻、信息损失更小）；
- 结构化笔记：长任务让 Agent 维护 `data/.memory/notes/{taskId}.md` 工作笔记（文件基础设施已有），压缩后从笔记恢复关键状态，与 CheckpointManager 互补。

#### U11. Generative UI / 动态工具界面（对应 G12）
- assistant-ui 的 tool UI 注册机制：为高频技能（NL2Insight 图表已有先例）定义专属渲染组件——表格编辑器、审批卡片、DAG 实时图、diff 视图；后端 chunk 增加 `ui_component` 提示字段。

#### U12. 语音入口（对应 G12）
- 网关增加音频上传 → STT（内网 Whisper 兼容服务）→ 既有聊天链路 → TTS 回流；优先落在 IM 语音消息场景（ImGateway 已有飞书通道）。

#### U13. OS 级 Computer Use（对应 G13）
- 在 browser-automation 之上增加桌面驱动（截图 + 视觉定位 + 鼠标键盘注入），对接 Anthropic Computer Use API 或开源 OS-agent 方案；覆盖无 API 且非 Web 的遗留桌面系统（与 next-gen 场景六衔接）。

#### U14. LLM 智能路由（roadmap v1.0 既定）
- 复杂度分类器已有 → 扩展为成本感知路由：Tier 1 → 廉价小模型，失败回退链，per-session 成本预算与熔断。

---

## 五、实施路线图建议

```
迭代 N（P0 基线）      : U1 混合检索 → U2 Prompt Caching/SDK → U4 OTel 双发      ✅ 已完成
迭代 N+1（P0 收尾+P1）: U3 评测体系（此后所有升级受评测保护）→ U5 记忆治理        ✅ 已完成
迭代 N+2（P1 引擎）    : U16 Coder 引擎（IAgentEngine 抽象 + Claude Agent SDK）→ U15 Loop Engineering  ✅ 已完成
迭代 N+3（P1 协议）    : U6 MCP v2 + Server 模式（与 U16 共享实现）→ U7 A2A 适配   🔶 U6 Server 模式已完成
迭代 N+4（P1 企业）    : U8 沙箱硬隔离 → U9 RBAC/限流/SSO  ← v1.0 发布门槛
迭代 N+5+（P2 前瞻）   : U10–U14 按业务场景拉动排期
```

**实施落点速查**（已完成项）：
- U1: `src/memory/long-term.ts`（混合检索）；U2: `src/llm/anthropic.ts`（cache_control）；U3: `evals/`；U4: `src/core/otel.ts` + `trace.ts`
- U5: `src/memory/memory-governor.ts` + long-term.ts 治理列（confidence / superseded_by / 反思衰减）
- U16: `src/core/harness/agent-engine.ts`（IAgentEngine）+ `claude-sdk-engine.ts`（Claude Agent SDK 引擎，自动降级 native）；coder SOUL.md v3 已切换
- U15: `src/core/loop/`（LoopSpec + 确定性验证器 + LoopRunner，预算熔断/停滞检测/escalate）；示例见 `loops/*.yaml`
- U6(Server): `src/gateway/mcp-server.ts`（POST /mcp 无状态 Streamable HTTP，全部技能对外暴露，复用网关认证）；客户端 elicitation/async-tasks/OAuth 2.1 待后续迭代

**排序原则**：
1. U3（评测）虽列 P0 末位，但应在大规模架构改动（U5–U9、U15–U16）前就位，使后续升级全部有回归保护；
2. U1/U2 是纯增益、低风险、可独立度量的改造，适合先行建立信心；
3. U16 与 U15 强协同（过夜编码循环 = 顶级引擎 + 确定性验证 + 预算熔断），且 U16 的进程内 MCP 工具与 U6 的 Server 模式是同一份实现，连排可摊薄成本；
4. U6 的 elicitation 与 U9 的 FilteredSkillRegistry 都能复用现有组件，边际成本低于表面工作量；
5. P2 项不预先排期，由业务场景（docs/next-gen-capabilities.md 的七大场景）拉动。

---

## 六、参考来源

- [Anthropic — Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [LangChain — Context Engineering for Agents](https://www.langchain.com/blog/context-engineering-for-agents)
- [Best AI Agent Frameworks 2026: Production-Tested Rankings](https://alicelabs.ai/en/insights/best-ai-agent-frameworks-2026)
- [Firecrawl — Best Open Source Agent Frameworks 2026](https://www.firecrawl.dev/blog/best-open-source-agent-frameworks)
- [MCP 2026 Roadmap: Everything That's Changing for Developers](https://mcpplaygroundonline.com/blog/mcp-2026-roadmap-whats-changing-for-developers)
- [WorkOS — Everything Your Team Needs to Know About MCP in 2026](https://workos.com/blog/everything-your-team-needs-to-know-about-mcp-in-2026)
- [Zylos Research — Agent Interoperability Protocols 2026: MCP, A2A, ACP](https://zylos.ai/research/2026-03-26-agent-interoperability-protocols-mcp-a2a-acp-convergence/)
- [Zylos Research — OpenTelemetry for AI Agents: GenAI Semantic Conventions](https://zylos.ai/research/2026-02-28-opentelemetry-ai-agent-observability)
- [Datadog — LLM Observability Supports OTel GenAI Semantic Conventions](https://www.datadoghq.com/blog/llm-otel-semantic-convention/)
- [Uptrace — OpenTelemetry for AI Systems (2026)](https://uptrace.dev/blog/opentelemetry-ai-systems)
- [Innoflexion — Multi-Agent Orchestration: Enterprise GenAI Architecture 2026](https://www.innoflexion.com/blog/multi-agent-orchestration-enterprise-genai-2026)
- [TURION.AI — The AI Agent Protocol Stack: MCP, A2A & What Comes Next](https://turion.ai/blog/ai-agent-protocol-stack-2026/)
- [Loops Replace Prompts: Loop Engineering Is Changing How AI Agents Work](https://knightli.com/en/2026/06/10/loops-replace-prompts-agent-loop-engineering/)
- [Loop Engineering: The Guide for AI Agents — Lushbinary](https://lushbinary.com/blog/loop-engineering-ai-coding-agents-guide/)
- [Loop Engineering: Coding Agent Loops That Run While You Sleep](https://explainx.ai/blog/loop-engineering-coding-agents-claude-code-guide-2026)
- [What Is Loop Engineering? The New Meta for AI Coding Agents — MindStudio](https://www.mindstudio.ai/blog/what-is-loop-engineering-ai-coding-agents)
- [awesome-harness-engineering — AI agent harness 工程模式汇编](https://github.com/ai-boost/awesome-harness-engineering)
- [Claude Agent SDK / Managed Agents — Anthropic 平台文档](https://platform.claude.com/docs/en/managed-agents/overview)
