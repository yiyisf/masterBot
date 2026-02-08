# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指引。

## 项目概述

CMaster Bot 是一个企业级 AI 助手系统，采用 ReAct 模式 Agent、可热重载的技能系统和现代化 Web UI。后端为 TypeScript/Fastify 服务器，前端为 Next.js 16 应用，使用 @assistant-ui/react 构建聊天界面。

## 常用命令

### 后端（根目录）
```bash
npm run dev          # 开发模式，支持热重载（tsx watch）
npm run build        # 编译 TypeScript 到 dist/
npm start            # 运行编译产物（node dist/index.js）
npm test             # 运行测试（vitest watch 模式）
npm run test:run     # 单次运行测试
npm run lint         # 对 src/ 执行 ESLint
```

### 前端（web/ 目录）
```bash
cd web
npm run dev          # Next.js 开发服务器
npm run build        # 生产构建
npm run lint         # ESLint
```

### 全栈开发
同时运行后端（根目录 `npm run dev`）和前端（`web/` 目录 `npm run dev`）。生产环境下后端从 `web/out` 提供前端静态文件。

## 架构

### 后端（`src/`）

**入口文件**：`src/index.ts` — 加载配置、初始化技能系统、内存、Agent，然后启动 Fastify 网关服务器。

**核心模块**：
- `src/core/agent.ts` — ReAct 循环编排器，使用 async generator 实现。内置工具：`plan_task`、`memory_remember`/`memory_recall`、`dag_create_task`/`dag_get_status`/`dag_execute`。通过 yield `ExecutionStep` 对象实现流式输出。
- `src/core/context-manager.ts` — 上下文窗口管理器，滑动窗口 + LLM 摘要压缩，防止超出模型上下文限制。
- `src/core/database.ts` — SQLite（`node:sqlite` DatabaseSync），WAL 模式。表：sessions、messages、attachments、tasks、long_term_memories。数据存储于 `data/cmaster.db`。
- `src/core/repository.ts` — 会话和消息的数据访问层。
- `src/core/task-repository.ts` — Task DAG 持久化仓库，支持依赖声明、就绪任务查询。
- `src/core/dag-executor.ts` — DAG 并行执行引擎，Promise.allSettled 并行执行就绪任务。

**LLM 层**（`src/llm/`）：
- `factory.ts` — 适配器工厂，按 `provider:baseUrl:model` 缓存实例。
- `openai.ts` / `anthropic.ts` — 实现 `LLMAdapter` 接口（定义在 `src/types.ts`）的提供商适配器，均支持通过 `chatStream()` 流式响应。

**技能系统**（`src/skills/`）：
- `loader.ts` — 扫描目录中的 `SKILL.md` 文件，用 gray-matter 解析元数据，动态导入 `index.ts/js` 实现。支持 `reloadSkill()` 热重载。
- `registry.ts` — 多源技能注册中心（Local + MCP）。将技能转换为 LLM 工具定义，通过 `SkillContext` 执行动作。
- `mcp-source.ts` — MCP 协议客户端（stdio/SSE 传输），支持指数退避重连。
- `sandbox.ts` — Shell 命令沙箱校验器，支持黑名单/白名单模式，默认拦截 `rm -rf`、`mkfs`、fork bomb 等危险命令。

**内存**（`src/memory/`）：
- `short-term.ts` — 基于内存的按会话隔离的键值存储，支持 TTL 和 LRU 淘汰。`SessionMemoryManager` 管理多个会话。
- `long-term.ts` — SQLite 持久化 + 向量余弦检索（LIKE 降级），Agent 内置 `memory_remember`/`memory_recall` 工具，自动注入 top-3 相关记忆到系统提示。

**网关**（`src/gateway/`）：
- `server.ts` — Fastify 服务器，提供 HTTP/WS/SSE 端点 + MCP 配置管理 API。
- `auth.ts` — 认证中间件，支持 API Key（`X-API-Key` header）和 JWT（`Authorization: Bearer`）两种模式，默认禁用。跳过 `/health`。

端点列表：
- `/health` — 健康检查（认证豁免）
- `/api/chat` — 非流式聊天
- `/api/chat/stream` — SSE 流式聊天
- `/ws` — WebSocket 端点
- `/api/mcp/config` — MCP 服务配置（GET / POST / DELETE）
- `/api/sessions` — 会话管理
- 静态文件服务（`web/out`），带 SPA 回退路由

### 前端（`web/src/`）

基于 Next.js 16（App Router）、React 19、Tailwind CSS 4、shadcn/ui 组件库。

**核心集成**：`web/src/lib/assistant-runtime.ts` — 为 @assistant-ui/react 实现的自定义 `ChatModelAdapter`，消费后端 SSE 流（`/api/chat/stream`）。处理 content、thought、plan、action、observation、answer、task_created、task_completed、task_failed 等 chunk 类型。

**页面**（`web/src/app/`）：chat（聊天）、skills（技能）、memory（记忆）、settings（设置）、dashboard（首页）。

### 技能协议

技能通过 `SKILL.md` 定义，包含 YAML frontmatter（name、version、description、author）和以 `### action_name` 为标题的动作定义及参数文档。实现代码在同级目录的 `index.ts` 中。三个技能目录：`skills/built-in/`（shell、file-manager、http-client）、`skills/installed/`、`skills/local/`。

## 配置

- `config/default.yaml` — 主配置文件，支持 `${ENV_VAR:default}` 环境变量插值语法。
- `.env`（参考 `.env.example`）— API 密钥、URL、日志级别等环境变量。
- `mcp-servers.json` — MCP 服务配置（通过 API 管理，或手动编辑）。
- LLM 必需环境变量：`OPENAI_API_KEY` + `OPENAI_BASE_URL`（或对应的 Anthropic 变量）。

关键配置段：
- `auth` — 认证（`enabled`、`mode: api-key|jwt`、`apiKeys`、`jwtSecret`），默认禁用。
- `skills.shell.sandbox` — Shell 沙箱（`enabled`、`mode: blocklist|allowlist`），默认启用黑名单模式。
- `memory.longTerm` — 长期记忆（`enabled`、`vectorDb: sqlite`）。

## TypeScript 配置

- 目标：ES2022，模块系统：NodeNext，严格模式
- 路径别名：`@/*` → `./src/*`，`@skills/*` → `./skills/*`
- 后端通过 `tsc` 编译到 `dist/`
- 需要 Node.js >= 20
