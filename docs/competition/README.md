# CMaster Bot — 自我进化的企业 AI 智能体平台

> 评委参阅文档 | 竞赛项目介绍

---

## 项目简介

**CMaster Bot** 是一个面向企业场景的 AI 智能体平台，核心能力是**自我进化**：它不仅能执行任务，还能在运行时根据自然语言描述生成新技能、热加载到系统中，并立即投入使用，全程无需重启服务器、无需人工编写代码。

### 一句话描述

> "告诉 AI 你需要什么能力，它会在 60 秒内为自己造一把新工具。"

---

## 解决的核心问题

### 企业 AI 落地的三大痛点

| 痛点 | 传统方案 | CMaster 方案 |
|------|---------|-------------|
| **集成成本高** | 每接一个系统需开发团队定制 | 30 行 YAML 声明式连接器，自动生成完整技能 |
| **能力扩展慢** | 新增功能需走研发迭代流程（周级） | AI 自动生成技能，60 秒热加载（秒级） |
| **知识孤岛** | 文档散落在各系统，检索不精准 | 知识图谱 + 多跳推理，结构化企业知识 |

---

## 核心创新点

### 1. Auto-Skill Generator（自动技能生成器）
系统的旗舰创新。用户用自然语言描述需求，Agent 自动：
- 生成 `SKILL.md`（元数据 + 动作定义）
- 生成 `index.ts`（完整实现代码）
- 沙箱验证（静态分析 + 受限试运行）
- 热加载进注册中心，**同一对话中立即可用**

```
用户: "我需要一个查询 HR 系统员工信息的技能"
      ↓ 60 秒后
Agent: "技能 hr-query 已生成并加载，现在可以用它查询了"
```

### 2. Visual Workflow Builder（可视化工作流编排）
拖拽式无代码工作流构建器：
- 节点类型：触发器、Agent 步骤、技能调用、条件分支、循环、合并
- 工作流序列化为 JSON，由 DAG 引擎执行
- 实时执行可视化（节点状态 + 数据流动）

### 3. GraphRAG 知识图谱
超越向量检索的结构化企业知识：
- 从文档、对话、结构化数据中自动抽取实体和关系
- 多跳推理：回答"负责支付服务的团队的上级是谁？"
- 向量相似度 + 图邻域扩展的混合检索

### 4. Multi-Agent 多智能体编排
多个专业子 Agent 并行协作：
- Supervisor Agent 分解任务、分配子任务、汇总结果
- Sub-Agent 角色：研究员、写作者、程序员、审阅者
- 基于 DAG 的输出依赖管理
- 月末汇报场景：3 个 Agent 并行处理，效率提升 3 倍

---

## 技术栈

### 后端
- **运行时**: Node.js 20+ (ESM, NodeNext 模块系统)
- **框架**: Fastify 5（HTTP/SSE/WebSocket）
- **语言**: TypeScript（严格模式，ES2022 目标）
- **数据库**: SQLite via `node:sqlite` DatabaseSync（WAL 模式，无额外依赖）
- **Agent**: ReAct 模式，async generator 流式输出
- **LLM**: OpenAI / Anthropic 双适配器，接口统一抽象

### 前端
- **框架**: Next.js 16（App Router）+ React 19
- **聊天 UI**: `@assistant-ui/react` 自定义适配器
- **样式**: Tailwind CSS 4 + shadcn/ui 组件库
- **实时通信**: SSE 流式传输（EventSource）

### 扩展能力
- **技能协议**: `SKILL.md`（YAML frontmatter + Markdown 动作文档）
- **MCP 协议**: stdio/SSE/Streamable-HTTP 三种传输，兼容 MCP 生态
- **沙箱**: Shell 命令黑名单/白名单校验器
- **记忆**: 短期（LRU + TTL）+ 长期（SQLite 向量检索）双层架构

---

## 与竞品的核心差异

| 能力 | CMaster | Dify | Coze | LangChain |
|------|---------|------|------|-----------|
| 自动生成技能 | ✅ 运行时 AI 生成 | 手动配置 | 手动配置 | 手动编码 |
| 零代码企业集成 | ✅ 30 行 YAML | 需配置 | 有限支持 | 需编码 |
| MCP 生态兼容 | ✅ 原生支持 | 部分 | 无 | 需插件 |
| 知识图谱推理 | ✅ GraphRAG | 向量 RAG | 向量 RAG | 需自建 |
| 多 Agent 并行 | ✅ DAG 编排 | 有限 | 工作流 | 需框架 |
| 完全开源可自部署 | ✅ | ✅ | 商业 SaaS | ✅ |

---

## 快速启动

### 环境要求
- Node.js >= 20
- npm >= 10

### 1. 克隆并安装依赖

```bash
git clone <repo-url>
cd cmasterBot
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入 API Key
```

`.env` 最小配置：

```env
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
```

### 3. 启动后端

```bash
npm run dev
# 服务启动于 http://localhost:3000
```

### 4. 启动前端

```bash
cd web
npm install
npm run dev
# 前端启动于 http://localhost:3001
```

### 5. 访问系统

打开浏览器访问 `http://localhost:3001`，即可开始与 CMaster Bot 交互。

### 健康检查

```bash
curl http://localhost:3000/health
# {"status":"ok","version":"0.1.0"}
```

---

## 项目结构一览

```
cmasterBot/
├── src/                    # 后端源码 (TypeScript)
│   ├── core/               # Agent、数据库、上下文管理
│   ├── gateway/            # Fastify HTTP/WS/SSE 服务器
│   ├── llm/                # LLM 适配器 (OpenAI/Anthropic)
│   ├── memory/             # 短期 + 长期记忆
│   └── skills/             # 技能加载、注册、MCP 客户端
├── skills/                 # 技能目录
│   ├── built-in/           # 内置技能 (shell, file-manager, http-client)
│   ├── installed/          # 安装的技能
│   └── local/              # 本地自定义技能
├── web/                    # 前端 (Next.js 16)
│   └── src/
│       ├── app/            # 页面 (chat, skills, memory, settings)
│       ├── components/     # UI 组件
│       └── lib/            # 工具函数 + SSE 适配器
├── config/
│   └── default.yaml        # 主配置文件
└── docs/
    └── competition/        # 竞赛文档（本目录）
```

---

## 测试覆盖

```bash
npm run test:run
# 90 tests, 8 files — all passing
```

---

## 联系与致谢

本项目为竞赛演示版本，基于真实工程实践构建，所有核心功能均已实现并通过测试。
