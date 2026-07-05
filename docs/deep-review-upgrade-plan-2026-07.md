# CMaster Bot 深度审查与优化升级规划（2026-07）

> 审查范围：后端 `src/`（约 15,600 行）、技能目录 `skills/`、Agent 定义 `agents/`、前端 `web/`、依赖清单与构建配置。
> 审查时测试基线：`vitest run` 17 个文件 / 188 个用例全部通过。
> 本文档定位：未来 2–3 个迭代周期的优化升级规划，与 `architecture-review.md`（架构总览）、`capability-gap-analysis-2026.md`（能力差距）互补，聚焦**可执行的整改项**。

---

## 一、代码架构及可维护性

### 1.1 `server.ts` 巨型文件（P0）

`src/gateway/server.ts` 已达 **2013 行**，承载了 chat/SSE/WS、sessions、skills、MCP 配置、audit、IM、agents、workflows、conductor、config 等全部路由。这是当前最大的可维护性风险：任何功能都要改同一个文件，合并冲突频发，且路由级单元测试难以拆分（tests/ 中仅 auth、mcp-server、conductor-api 有网关侧测试）。

**整改方案**：按 Fastify 插件模式拆分为 `src/gateway/routes/` 下的独立模块：

```
src/gateway/routes/
  chat.ts          # /api/chat, /api/chat/stream, /ws
  sessions.ts      # /api/sessions*
  skills.ts        # /api/skills*, /api/mcp/config
  agents.ts        # /api/agents/* (8 个端点)
  audit.ts         # /api/audit/*
  im.ts            # /api/im/*
  admin.ts         # /api/config/*, /api/status, /api/improvements
  workflows.ts     # /api/workflows, /api/conductor-workflows
```

每个模块导出 `FastifyPluginAsync`，通过 `app.register()` 挂载；共享依赖（agent、repository、registry 等）通过 Fastify 的 `decorate` 或插件 options 注入。拆分后可对每个路由模块单独编写注入 mock 的测试。

### 1.2 `Agent` 构造函数依赖爆炸 + `any` 类型逃逸（P1）

`src/core/agent.ts` 构造函数接收 **15 个可选依赖**的巨型 options 对象，其中三个关键协作者是裸 `any`：

```ts
private skillGenerator?: any;
private orchestrator?: any;
private knowledgeGraph?: any;
```

同时多处使用内联 `import('./harness/agent-pool.js').AgentPool` 类型标注。后果：编译器无法校验调用点，重构时这些依赖是盲区。

**整改方案**：
- 在 `src/types.ts`（或各模块自身）定义 `ISkillGenerator`、`IOrchestrator`、`IKnowledgeGraph` 最小接口（只声明 Agent 实际调用的方法），替换所有 `any`；
- 将 15 个依赖聚合为一个 `AgentDependencies` 接口，组合根（`src/index.ts`）统一装配；
- 消除内联 `import()` 类型，改为顶部 `import type`。

### 1.3 双多智能体体系并存（P1）

`src/core/multi-agent.ts`（`MultiAgentOrchestrator`，158 行）与 Phase 23 引入的 `src/core/harness/`（AgentPool + AgentHarness + Grader）职责重叠：两者都做"委派任务给子 Agent"。目前 `delegate_to_agent` 工具同时挂着两条路径，新功能（Outcome 评分、修订循环、Hook、权限过滤）只在 Harness 一侧生效。

**整改方案**：将 `MultiAgentOrchestrator` 的调用点全部迁移到 `AgentPool.spawn()`，`multi-agent.ts` 标记 deprecated 并在下一版本删除。委派统一入口 = AgentPool，治理策略只需维护一份。

### 1.4 层级违规：LLM 适配器直接写数据库（P1）

`src/llm/openai.ts:3` 直接 `import { db } from '../core/database.js'` 并在适配器内 INSERT `token_usage`。LLM 适配层本应是无副作用的纯协议转换层；直接依赖 DB 导致：适配器无法在无数据库环境（如 evals、MCP server 独立网关）复用，单测必须初始化 SQLite。

**整改方案**：`LLMAdapter` 接口增加可选的 `onUsage?: (usage: TokenUsage) => void` 回调（或让 `chatStream` 在 `done` chunk 中携带 usage），由组合根订阅并写库。

### 1.5 Claude SDK 引擎的 `any` 消息处理（P2）

`src/core/harness/claude-sdk-engine.ts` 中 `sdk: any`、`_translateMessage(message: any)`。`@anthropic-ai/claude-agent-sdk` 自带完整的 `SDKMessage` 联合类型，动态 `import()` 后可用 `typeof import('@anthropic-ai/claude-agent-sdk')` 获得类型而不影响降级逻辑。

### 1.6 已引入 zod 4 但未系统性使用（P2）

`zod ^4.4.3` 在依赖中，但：技能动作参数、API 请求 body、SOUL.md/LoopSpec YAML 解析多数仍是手写类型断言。建议将 zod schema 作为所有"外部输入边界"（HTTP body、SKILL.md/SOUL.md frontmatter、MCP 工具参数）的统一校验层，schema 即文档。

### 1.7 做得好的地方（保持）

- 流式 async generator 贯穿全链路，`ExecutionStep` 统一事件模型；
- `ISkillRegistry` 接口抽取 + `FilteredSkillRegistry` 权限过滤（Phase 23）是正确的依赖倒置实践；
- 188 个测试全绿、TypeScript strict 模式、ESM/NodeNext 全面就位；
- ContextManager 滑动窗口 + 溢出强制压缩重试是同类项目少有的健壮设计。

---

## 二、系统能力及依赖工具先进性

### 2.1 需要立即处理的依赖问题

| 依赖 | 现状 | 问题 | 建议 |
|------|------|------|------|
| `xlsx ^0.18.5` | npm 版 SheetJS | **npm 渠道自 2022 起停更**，0.18.5 存在已知漏洞（原型污染 CVE-2023-30533、ReDoS CVE-2024-22363），官方已迁移至 cdn.sheetjs.com 分发 | P0：换 `exceljs`（document-processor 技能的 read_xlsx/write_xlsx），或改用官方 `https://cdn.sheetjs.com/xlsx-latest` 源 |
| `https-proxy-agent ^9.0.0` | 声明于 dependencies | **全代码库（src/、skills/、evals/）零引用**，纯冗余 | P0：直接移除 |
| `@opentelemetry/resources ^1.30` 等 | OTel JS 1.x | OTel JS SDK 2.x 已发布（2025 年初），1.x 进入维护期 | P1：整体升级到 2.x（`resources`/`sdk-trace-*` 有 breaking change，`semantic-conventions` 改用 `ATTR_*` 常量） |

### 2.2 LLM 层的现代化差距

1. **代理支持不对称**：`openai.ts` 手动读 `https_proxy` 环境变量注入 undici `ProxyAgent`，而 `anthropic.ts` **完全没有代理支持**——同一部署环境下 Anthropic 提供商会连不上。建议统一改用 undici 的 **`EnvHttpProxyAgent`**（自动读取 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`，无需手写判断），两个适配器共享同一个 dispatcher 工厂。
2. **Chat Completions vs Responses API**：`openai.ts` 使用 `chat.completions`。OpenAI 官方方向已转向 Responses API（原生支持 reasoning 模型、内建工具、有状态会话）。Chat Completions 短期不会消失（兼容百炼/Ollama/vLLM 等兼容端点仍需它），但建议：适配器内按 `config.type === 'openai' && 官方 baseUrl` 时优先走 Responses API，兼容端点保留 Chat Completions。
3. **`max_tokens` 已弃用**：对 OpenAI 新模型（o 系列、gpt-5 系列）应使用 `max_completion_tokens`；当前硬编码 `max_tokens` 会导致新推理模型报 400。建议按模型名路由参数。
4. **未启用 prompt caching**：native ReAct 循环每轮重发全量 system prompt + 工具定义。Anthropic 侧加 `cache_control: {type: 'ephemeral'}` 到 system 块与工具定义（长会话可省 60–90% 输入 token 成本）；这是 Claude SDK 引擎已免费获得、native 引擎缺失的能力。
5. **未使用 structured outputs**：Grader、complexity-classifier、nl2sql 等"LLM 输出 JSON 再 parse"的场景应改用 `response_format: {type: 'json_schema', strict: true}`（OpenAI）/ tool-use 强制模式（Anthropic），消除 JSON 解析失败重试逻辑。

### 2.3 向量检索：JS 全表余弦 → sqlite-vec（P1）

`src/memory/long-term.ts` 的语义检索是"加载所有有 embedding 的记忆 → JS 逐条余弦"，O(n) 全表扫描 + JSON.parse 缓存。千条级够用，但知识库增长后会成为热路径瓶颈。`node:sqlite` 的 `DatabaseSync` 支持 `loadExtension`（需 `allowExtension: true`），可直接接入 **sqlite-vec** 扩展做 SQL 内 KNN，保持零外部服务的架构承诺。FTS5 + sqlite-vec 双路召回即当前混合检索的标准形态。

### 2.4 Tokenizer 估算精度（P2）

`src/core/tokenizer.ts` 是 CJK 启发式估算（自评 85–90% 精度）。上下文管理裁剪边界依赖它，低估会触发上游 400。建议引入纯 JS 的 `gpt-tokenizer`（o200k_base）做精确计数，启发式作为 fallback；或至少把安全余量参数化。

### 2.5 `node:sqlite` 同步阻塞风险（P2，观察项）

`DatabaseSync` 每次查询都阻塞事件循环，与 SSE 流式响应共享同一线程。当前查询都很小，问题不大；但审计 CSV 导出、全表向量扫描这类大查询会卡住所有并发流。中期方案：大查询移入 `node:worker_threads`，或数据层抽象出 async 接口为未来切换留口。

### 2.6 保持领先的部分（无需动）

fastify 5、next 16 + react 19、tailwind 4、vitest 4、zod 4、undici 8、`@modelcontextprotocol/sdk` 1.26（含 streamable-http）、`@anthropic-ai/claude-agent-sdk`（注意其迭代节奏快，建议 renovate/dependabot 盯住 minor 版本）。

---

## 三、功能完整性及业界标准适配

### 3.1 SKILL.md：自定义格式与业界标准的三重差距（P0）

**现状**：技能 = SKILL.md（frontmatter + `### action` 标题）+ **必须存在** `index.ts/js` 导出同名函数。`loader.ts` 用正则从 markdown 正文提取动作和参数生成工具 schema；无实现文件时动作全部变成抛错的 placeholder（degraded）。

**问题 1 — 正则解析脆弱**（`registry.ts:52-107`）：
- 参数只支持扁平原语类型，无 enum、嵌套 object、数组 item 类型、默认值；
- required 的判定依赖描述文字里是否出现"可选"二字，格式稍有出入即静默丢参；
- 参数 schema 与实现签名之间没有任何一致性校验。

**问题 2 — 与 Anthropic Agent Skills 开放标准不兼容**：业界标准的 SKILL.md（anthropics/skills 生态、Claude Code / claude.ai 通用格式）是"**指令型技能**"：frontmatter 仅 `name` + `description`（可选 `allowed-tools`、`metadata`），正文是给模型的操作指南，按需渐进加载（progressive disclosure），可执行脚本放 `scripts/` 由模型经 shell 调用，**不要求可执行入口**。CMaster 的 SKILL.md 实际是"**工具插件**"格式，无法直接安装社区标准技能，也无法把自己的技能分发到标准生态。

**问题 3 — 生产加载链路断裂**：`tsconfig.json` 明确 `exclude: ["skills"]`、`rootDir: "./src"`，即技能 `index.ts` **不参与编译**；而技能实现 `import '../../../src/skills/utils.js'`。这意味着：
- `npm run build && npm start` 时，动态 import 的是裸 `.ts` 文件，依赖 Node 22.18+ 的默认类型剥离才能跑（Node 22.0–22.17 直接失败，与 `engines: ">=22.0.0"` 声明冲突）；
- npm 发布包 `files` 只含 `dist/ config/ skills/built-in/ scripts/`，**不含 `src/`**——安装后技能 import `../../../src/skills/utils.js` 必然找不到，所有内置技能在发布包中全部 degraded。

**整改方案（双轨制）**：

1. **可执行技能（Tool Plugin）规范化**：
   - 动作定义从"正则解析正文"迁移到 frontmatter 结构化声明（YAML 内嵌 JSON Schema），zod 校验后直接生成 `ToolDefinition`，正文 markdown 只做给人/模型看的文档；
   - 修复构建链：为 `skills/` 增加独立 `tsconfig.skills.json` 编译到 `dist/skills/`，或将 `skills/utils.ts` 等共享代码发布为包内子路径导出（`cmaster-bot/skill-kit`），杜绝 `../../../src/` 相对引用；
   - 加载器按 `dist/skills/*/index.js → skills/*/index.ts` 顺序探测，保证 dev/prod/npm 三种形态一致。
2. **新增标准 Agent Skills 支持**：识别"无 actions 声明"的 SKILL.md 为指令型技能——`description` 注入系统提示做技能发现，被触发时全文注入上下文，`scripts/` 经现有 shell 沙箱执行，`allowed-tools` 映射到 `FilteredSkillRegistry`。这样 anthropics/skills 及社区技能可直接放入 `skills/installed/` 使用，CMaster 也自然成为标准技能的运行时。

### 3.2 SOUL.md / AgentSpec：建议对齐 Claude Code subagent 约定（P2）

`agents/builtin/*/SOUL.md` 是自定义 frontmatter（engine/tools/resources/hooks/outcome）。业界最接近的事实标准是 Claude Code 的 subagent 格式（`.claude/agents/*.md`：`name`/`description`/`tools`/`model`）与 `AGENTS.md` 约定。AgentSpec 能力超集更丰富（Outcome/Grader 是差异化优势，应保留），但建议：
- 字段命名向 subagent 靠拢（如 `tools.allow` 支持逗号分隔字符串简写）；
- 提供 `claude-agent-to-soul` 转换器，让用户已有的 subagent 定义可一键导入 AgentPool。

### 3.3 企业连接器：自定义 YAML → OpenAPI（P2）

`connector-source.ts` 用自定义 YAML/JSON 描述企业 API。业界标准做法是直接消费 **OpenAPI 3.x spec** 生成工具（operationId → 工具名，requestBody schema → 参数 schema）。建议连接器源增加 `openapi:` 类型，自定义 YAML 保留为轻量捷径。

### 3.4 已达标/领先的能力（确认项）

- **MCP 双向支持**：client（stdio/SSE/streamable-http + 指数退避重连）+ server 网关（`mcp-server.ts`），同类开源项目中少见；
- **可观测性**：agent_spans + OTLP 导出，达标；
- **Evals**：自研 assertions/runner 够用；若要复用生态可加一层 promptfoo 兼容的 task YAML 导入，非优先。
- **Agent 间互操作（远期观察）**：AgentBus 是进程内 EventEmitter；若未来需要跨进程/跨厂商 Agent 协作，A2A（Agent2Agent，Linux Foundation）是值得跟踪的互操作协议，当前不建议投入。

---

## 四、Skill 与 Agent 的划分（claude-code / gemini-cli 迁移）

### 4.1 问题定性

`skills/built-in/claude-code` 与 `gemini-cli` 把**完整的自治 Agent 当作无状态一次性 CLI 工具**调用（`spawnCli` + 300 秒超时 + 字符串返回）。这违反了系统自身已建立的分层，具体危害：

1. **无流式**：子 CLI 运行 5 分钟期间前端只有黑盒等待，ExecutionStep 事件流断档；
2. **治理穿透失效**：CMaster 的 shell 沙箱、approve hook、工具白名单对子 CLI 内部的文件写/命令执行完全不可见——claude-code skill 里的子进程可以做任何事，等于开了治理后门；
3. **会话串扰风险**：`continue_session` 不带 session_id 时执行 `claude --continue`（全局最近会话），多用户/多会话并发下会续到别人的会话；
4. **无质量闭环**：绕过了 Grader/Outcome 修订循环，结果质量不可评估；
5. **错误退化为字符串**：`return \`Error: ${error.message}\``，上游无法区分成功与失败。

而系统**已经拥有正确的承载物**：`AgentSpec.engine: 'claude-agent-sdk'` + `ClaudeAgentSdkEngine`（canUseTool 沙箱、流式 ExecutionStep 转译、降级链）+ `delegate_to_agent` 工具 + AgentPool 并发治理。coder Agent v3 已经用上了。

### 4.2 划分原则（建议写入 skills-guide.md）

| 维度 | Skill（工具） | Managed Agent |
|------|--------------|---------------|
| 执行形态 | 确定性、单步、有界 I/O | 开放式、多步推理循环 |
| 结果 | 结构化返回值 | 流式 ExecutionStep + Outcome 评分 |
| 治理 | 参数校验 + 沙箱 | 工具白名单 + Hook + Grader 修订 |
| 状态 | 无状态 | 会话/记忆命名空间 |
| 例子 | http 请求、读 PDF、发通知、SQL 查询 | 编码、代码审查、调研、浏览器多步操作 |

**判据一句话**：如果这个能力内部自己会调用 LLM 做多步决策，它就是 Agent，不是 Skill。

### 4.3 迁移方案

| 现状 | 目标 | 说明 |
|------|------|------|
| `claude-code` skill | **删除**，由 `coder` / 新增 `code-reviewer-sdk` AgentSpec 承接 | ClaudeAgentSdkEngine 已覆盖 ask/code_review 全部场景且更强（真流式、canUseTool 治理、Grader）；`continue_session` 由 AgentHarness 的 session 机制承接 |
| `gemini-cli` skill 的 `ask`/`analyze_code` | 新增 `gemini-researcher` AgentSpec，`engine: native` + `resources.preferredProvider: gemini`（factory 已支持 gemini OpenAI 兼容路由） | 不再依赖本地安装 gemini CLI，纯 API 路径可治理、可流式；如必须复用 CLI 免费额度，则实现 `GeminiCliEngine implements IAgentEngine`（gemini CLI 支持 stream-json 输出），归入引擎层而非技能层 |
| `gemini-cli` skill 的 `search_web` | **保留为独立 skill**（如 `web-search`） | 搜索是确定性单步 I/O，本来就是工具；建议底层换成可配置的搜索 API（Tavily/Brave/SearXNG），摆脱对 gemini CLI 的绑定 |
| `browser-automation` skill | 拆分：原子操作（截图、抓取单页）留 skill；"完成一个网页任务"新增 `browser-operator` AgentSpec | Playwright 多步操作本质是 Agent 循环 |
| `skill-generator` | 扩展为也能生成 AgentSpec（SOUL.md） | self-improvement 引擎目前只会造工具，应能按上表判据自动选择产出 Skill 还是 Agent |

迁移期兼容：保留 `claude-code`/`gemini-cli` 技能一个版本，动作实现改为内部转发 `delegate_to_agent`，并在返回中提示 deprecated，下版本删除目录。

---

## 五、记忆子系统专项审查（2026-07 补充）

> 触发背景：用户反馈"记忆能力验证应该不生效，目前无 embedding 模型可用"。经代码走读确认属实，且根因不止一个。

### 5.1 结论先行：向量层从未生效，主检索路径对中文也近乎失效

**Bug 1 — embedder 装配方法名错误（`src/index.ts:91`）**：

```ts
if (typeof (embeddingLlm as any).embed === 'function') {
    return (texts) => (embeddingLlm as any).embed(texts);
}
```

而 `LLMAdapter` 实现的方法名是 **`embeddings`**（`openai.ts:145`），不是 `embed`。因此即使配置了 `models.embeddingModel`，embedder 也永远装配不上——向量检索、混合召回、`_scheduleEmbedding` 全部是死代码，启动日志静默显示 `search: FTS5`，无人察觉。`(as any)` 类型逃逸正是 1.2 节所述问题的直接受害案例：若走接口类型，编译器当场就会报错。

**Bug 2 — FTS5 `unicode61` 分词器对中文不分词**：`unicode61` 把连续的 CJK 字符串当作**单个 token**（它只按空格/标点切分）。即"我们的数据库配置在 config 目录"整句是一个 token，查询"数据库"永远 MATCH 不中。中文内容的 FTS5 召回率接近零。

**Bug 3 — 兜底路径同样失效**：FTS 无结果时回落 `_likeSearch`，即 `LIKE '%整个查询串%'`；而自动注入（`agent.ts:159`）拿**完整用户输入原句**当查询——一整句话作为子串精确匹配记忆内容，命中率≈0。`memory_recall` 工具和 MemoryGovernor 的查重候选检索走同一条链路，一并失效（Governor 实际只剩 `listRecent` 时间维度候选在起作用）。

**综合判定**：记忆的**写入链路完好**（SQLite + 文件 + MEMORY.md 索引都在正常落盘），但**召回链路在中文场景下三条路全断**。"没有 embedding 模型"只是表象，即使配上 embedding 模型，Bug 1 也会让它继续不生效。

### 5.2 记忆分层现状评估

| 层 | 实现 | 评估 |
|----|------|------|
| 短期记忆 | `SessionMemoryManager`：会话级 KV + TTL + LRU | **近乎空转**：`search()` 恒返回 `[]`；`MemoryRouter` 构造函数接收它但从不查询；与对话历史 + ContextManager 职责重叠 |
| 长期记忆 v3 | 文件（宣称真相源）+ SQLite + FTS5 + 可选向量 | 结构最完整但有**双真相源漂移**：读路径全走 SQLite，文件只写不读；`forget()`/`supersede()` 只改 DB，不删除/更新对应 md 文件和 MEMORY.md 索引行 |
| 知识图谱 | SQLite GraphRAG（实体/边 + BFS） | 定位合理（企业文档实体网络），与个人记忆分开是对的 |
| MemoryRouter | LT + KG 并行归并 top-N | 归并设计合理；800ms 超时的 `setTimeout` 未 clear（小泄漏）；short-term 参数属僵尸代码 |
| MemoryGovernor | LLM 查重/冲突判定 + 置信度衰减 + supersede | **设计亮点，且天然不依赖 embedding**，应保留；置信度 × 时近性加权召回也是好设计 |
| CMASTER.md + MEMORY.md 注入 | `agent.ts:_loadGlobalInstructions()` 注入系统提示 | **已是 Claude Code 形态的雏形** ✓；但 `_globalInstructions` 进程级缓存，新记忆写入后索引不刷新，直到重启才可见 |

**分层结论**：概念分层（会话暂存 / 事实记忆 / 实体图谱 / 治理）本身是合理的，甚至比多数同类项目完整。问题集中在两点：① 长期记忆内部"SQLite 与文件双真相源单向同步"造成漂移；② 检索技术选型（unicode61 FTS + 整句 LIKE + 未接通的向量）与中文场景完全不适配。短期记忆层建议裁撤或重新定位。

### 5.3 推荐主路线：Claude Code 式无 embedding 记忆（agentic 检索）

Claude Code 的记忆机制不做任何向量/语义检索，核心是**索引常驻 + 模型自主读取**：

1. 一条事实 = 一个 Markdown 文件（frontmatter：`name`/`description`/`type`）；
2. `MEMORY.md` 索引每行一条（标题 + 一句钩子），**始终注入上下文**；
3. 召回是 agentic 的：模型看索引 → 判断相关 → 用文件读取工具打开具体记忆文件——检索智能来自模型本身，而非检索算法；
4. 写入前模型先查索引/读现有文件，决定"更新旧文件"还是"新建"，天然完成查重；
5. 记忆之间用 `[[name]]` 链接组网。

CMaster 已具备该形态约 70% 的地基（文件层、MEMORY.md、CMASTER.md 注入、分类目录）。补齐清单：

| # | 改造项 | 说明 |
|---|--------|------|
| M1 | 新增内置工具 `memory_read(category, topic)` | 读取 `data/.memory/{category}/{topic}.md` 全文；配合常驻索引构成召回主路径，**零 embedding 依赖，中文天然无碍** |
| M2 | 索引每次 `run()` 实时加载（或写入时失效缓存） | 修复 `_globalInstructions` 进程级缓存导致的新记忆不可见 |
| M3 | 文件为唯一真相源 | SQLite/FTS 降级为**可由文件全量重建的派生索引**；`forget()`/`supersede()` 同步删除/标注 md 文件并更新 MEMORY.md |
| M4 | 索引行摘要由 LLM 生成 | `memory_remember` 时让模型附带一句 description，替代当前"截取内容前 100 字符" |
| M5 | 自动注入策略调整 | 停止拿整句用户输入做 top-3 检索；索引已常驻，模型按需 `memory_read` 即可（如仍要主动注入，用 LLM 提取的关键词查 FTS） |
| M6 | FTS5 tokenizer 改 `trigram` | Node 22 内置 SQLite ≥ 3.45 支持 trigram，中文子串匹配立即可用；FTS 保留为辅助关键词检索（`memory_recall` 的实现） |
| M7 | 向量层降级为可选增强 | 修复 Bug 1（`embed` → `embeddings`）后，仅在明确配置 embedding provider 时启用混合召回；原 P1-6 的 sqlite-vec 相应降为 P2 可选项 |
| M8 | 短期记忆层处置 | 从 MemoryRouter 移除僵尸参数；层本身或裁撤（职责并入对话历史 + `session_recall`），或明确定位为"工具执行的会话内暂存" |

### 5.4 目标形态

```
上下文常驻:  CMASTER.md(全局指令) + MEMORY.md(索引, 每行一条)
                         │  模型判断相关性
召回主路径:  memory_read(category, topic)  ←─ agentic，零检索依赖
召回辅路径:  memory_recall(keywords)  ←─ FTS5 trigram 关键词检索
可选增强:    embedding 混合召回（仅当配置了 embedding provider）
真相源:      data/.memory/**/*.md（SQLite/FTS 为派生索引，可重建）
治理:        MemoryGovernor 查重/冲突/置信度衰减（保留，不依赖 embedding）
实体网络:    KnowledgeGraph（独立，面向企业文档）
```

该路线把"检索质量"从算法问题转化为模型能力问题，与系统"零外部服务依赖"的架构承诺一致，也是当前无 embedding 模型环境下唯一能立即生效的方案。

---

## 六、优先级路线图

### P0（当前迭代，风险/安全类）

| # | 事项 | 涉及 | 验收标准 |
|---|------|------|----------|
| P0-1 | 替换 `xlsx` 为 `exceljs`（CVE） | `skills/built-in/document-processor` | read_xlsx/write_xlsx 测试通过，`npm audit` 无该项 |
| P0-2 | 移除冗余依赖 `https-proxy-agent` | package.json | 构建/测试通过 |
| P0-3 | 修复技能生产加载链路（编译进 dist 或 skill-kit 子路径导出） | tsconfig、loader.ts、全部内置技能 | `npm run build && npm start` 及 npm pack 安装后技能均为 active |
| P0-4 | `server.ts` 按 Fastify 插件拆分 | src/gateway/ | 单文件 < 400 行，路由行为回归测试通过 |
| P0-5 | claude-code skill 治理后门处置：至少先给子进程加 allowedTools 收敛与 cwd 白名单，并修复 `--continue` 会话串扰 | skills/built-in/claude-code | 并发会话不串；为 4.3 完整迁移争取时间 |
| P0-6 | 记忆召回止血：修复 embedder 装配方法名 bug（`embed`→`embeddings`，index.ts:91）+ FTS5 tokenizer 改 `trigram` | index.ts、memory/long-term.ts | 中文关键词可召回记忆；配置 embedding provider 后混合检索真实生效（见 5.1） |

### P1（下一迭代，架构与能力）

| # | 事项 | 涉及 |
|---|------|------|
| P1-1 | SKILL.md 双轨制：frontmatter 结构化 actions（zod + JSON Schema）+ 标准 Agent Skills（指令型）支持 | loader.ts、registry.ts、skills-guide.md |
| P1-2 | claude-code / gemini-cli → Managed Agent 迁移（4.3 全表） | skills/、agents/builtin/ |
| P1-3 | 收敛双多智能体体系：删除 MultiAgentOrchestrator，统一 AgentPool | multi-agent.ts、agent.ts |
| P1-4 | LLM 层现代化：EnvHttpProxyAgent 统一代理、anthropic prompt caching、structured outputs、max_completion_tokens 路由 | src/llm/ |
| P1-5 | Agent 依赖注入接口化（消除 `any` 协作者） | agent.ts、types.ts |
| P1-6 | 记忆召回 Claude Code 化：`memory_read` agentic 检索 + 索引常驻实时加载 + 文件唯一真相源 + forget/supersede 同步文件与索引（5.3 节 M1–M5、M8） | memory/、agent.ts、agent-tools.ts |
| P1-7 | token_usage 记录移出 LLM 适配器（回调/事件） | llm/openai.ts、index.ts |

### P2（后续规划，锦上添花）

| # | 事项 |
|---|------|
| P2-1 | OpenTelemetry JS SDK 升级 2.x |
| P2-2 | OpenAI Responses API 支持（官方端点优先，兼容端点保留 Chat Completions） |
| P2-3 | gpt-tokenizer 精确计数（启发式作 fallback） |
| P2-4 | 企业连接器支持 OpenAPI 3.x spec 导入 |
| P2-5 | SOUL.md ↔ Claude Code subagent 格式转换器 |
| P2-6 | claude-sdk-engine 消息类型化（使用 SDK 自带 SDKMessage 类型） |
| P2-7 | zod 校验推广到全部外部输入边界 |
| P2-8 | 大查询移入 worker_threads（审计导出、向量扫描） |
| P2-9 | skill-generator 支持产出 AgentSpec |
| P2-10 | sqlite-vec 接入（仅当配置了 embedding provider，替换 JS 全表余弦；由原 P1 降级，见 5.3 M7） |
| P2-11 | 短期记忆层裁撤或重新定位（5.3 M8），MemoryRouter 移除僵尸参数与未清理的超时定时器 |

---

## 附录：本次审查中确认无需处理的事项

- 前后端主要框架版本均为当前主流最新（fastify 5 / next 16 / react 19 / vitest 4 / zod 4 / MCP SDK 1.26）；
- `pdf-parse` v2、`nodemailer` 8、`jsonwebtoken` 9 均为可用的现行版本，无紧迫替换需求（`jose` 可作为 jsonwebtoken 的 ESM 备选，非必要）；
- ContextManager 溢出压缩、MCP 重连退避等健壮性设计经代码走读确认良好（注意：记忆检索的 FTS5→LIKE 降级**机制**本身健壮，但检索**效果**在中文场景失效，见第五节）；
- 188 个测试用例全部通过，核心模块（harness、loop、memory、sandbox、registry）均有覆盖。
