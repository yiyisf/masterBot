# CMaster Bot — 企业员工 AI 助手操作系统

**融合知识检索、数据查询、流程自动化，会自我进化** — 面向 HR、财务、业务、运营等企业员工，无需 IT 人员维护。

[![Node.js >=22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/YOUR_ORG/cmaster-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_ORG/cmaster-bot/actions)

## 🌟 核心特性

### 基础能力
- 🤖 **多 LLM 适配** — 支持 OpenAI / Anthropic 双接口标准，模型热切换，无需重启
- 🔧 **可扩展技能系统** — `SKILL.md` 协议 + MCP 协议，内置 Shell、文件、HTTP、通知、文档处理、视觉等技能
- 🧠 **双层记忆系统** — 短期会话记忆（LRU 淘汰）+ 长期记忆（SQLite 向量余弦检索）
- 📋 **Task DAG 任务编排** — 复杂任务分解为有向无环图，支持依赖声明和并行执行
- 🪟 **上下文窗口管理** — 滑动窗口 + LLM 摘要压缩，防止超出模型上下文限制
- 🔒 **安全加固** — Shell 命令沙箱（黑名单/白名单）+ 认证中间件（API Key / JWT）

### 企业扩展能力
- ⚡ **Auto-Skill Generator** — 自然语言描述 → AI 自动生成技能代码 → 热加载，60 秒上线
- 🧬 **自我学习闭环** — 负向反馈自动触发 LLM 分析 → 按需生成新技能，持续进化
- 🕸️ **GraphRAG 知识图谱** — 实体-关系多跳推理，自动增量同步内部知识体系
- 🔀 **Multi-Agent 多智能体** — Supervisor + Worker DAG 并行编排，支持 HTTP 网关远程调度
- 🗓️ **定时主动 AI** — Cron 调度，无需用户触发自动执行任务
- 🔗 **企业连接器框架** — 30 行 YAML 连接任意 REST/GraphQL 内部系统
- 📊 **NL2Insight 数据分析** — 自然语言 → SQL → ECharts 可视化，只读安全沙箱
- 🚨 **AIOps 运维中枢** — Webhook 告警入站 + YAML Runbook 声明式自动执行
- 🖥️ **AI-RPA 浏览器自动化** — Playwright 驱动，跨平台（Windows Edge / macOS Chrome）
- 📝 **Prompt 模板库** — 20+ 内置企业场景模板（HR/数据/运维/文档/流程），支持自定义
- 🔒 **细粒度权限模型** — 按角色限制技能访问，企业多部门安全隔离
- 🐳 **Docker 一键部署** — 多阶段 node:22-alpine 镜像，SQLite volume 持久化

---

## 🚀 快速开始

### Docker 部署（推荐）

```bash
git clone https://github.com/YOUR_ORG/cmaster-bot.git && cd cmaster-bot
cp .env.example .env  # 编辑 OPENAI_API_KEY 和 OPENAI_BASE_URL
docker compose up -d
# 访问 http://localhost:3000
```

### 本地安装

```bash
# macOS/Linux 一键安装
bash scripts/install.sh

# Windows
scripts\install.bat

# 手动安装
npm install && cd web && npm install && cd ..
```

### 环境要求

- **Node.js >= 22**（`node:sqlite` 内置模块要求）
- npm >= 10

### 配置

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
OPENAI_BASE_URL=http://your-internal-ai-gateway/v1
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-4
# Anthropic (可选)
ANTHROPIC_API_KEY=your-anthropic-key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

### 启动服务

```bash
# 开发模式（双端同时启动）
npm run dev                  # 后端 :3000
cd web && npm run dev        # 前端 :3001（仅修改 UI 时需要）

# 生产部署
npm run build                # 编译后端 TypeScript
cd web && npm run build      # 构建前端静态文件
cd .. && npm start           # 统一服务 :3000（后端托管前端）
```

---

## 🖥️ Web 控制台

访问 `http://localhost:3000`，包含以下页面：

| 路由 | 页面 | 功能 |
|------|------|------|
| `/` | 仪表盘 | 系统概览、消息统计、快捷入口 |
| `/chat` | 智能对话 | ReAct Agent 对话，流式思考链展示 |
| `/skills` | 技能管理 | 查看/安装/生成技能，MCP 注册中心 |
| `/connectors` | 企业连接器 | YAML 连接器 CRUD |
| `/knowledge` | 知识图谱 | 文档摄入、多跳语义检索 |
| `/workflow` | 可视化工作流 | 拖拽编排工作流节点 |
| `/scheduled` | 定时任务 | Cron 表达式调度配置 |
| `/webhooks` | Webhook 管理 | 入站触发器 CRUD + HMAC 密钥 |
| `/runbooks` | Runbook | 上传/触发 YAML 声明式运维手册 |
| `/rpa` | AI-RPA | 浏览器自动化控制台 + 实时截图 |
| `/memory` | 对话记录 | 历史会话检索 |
| `/settings` | 系统设置 | LLM 配置/测试、Agent 参数、安全策略 |

---

## 📡 API 参考

### 聊天接口

```bash
# 单次对话
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "帮我列出当前目录的文件"}'

# SSE 流式响应
curl -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "查询本月订单转化率并以柱状图展示", "sessionId": "optional-id"}'
```

### 认证（默认关闭）

```bash
# API Key 模式
curl -X POST http://localhost:3000/api/chat \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"message": "你好"}'
```

### Webhook 触发

```bash
# 带 HMAC-SHA256 签名触发 Runbook
curl -X POST http://localhost:3000/api/webhooks/{id}/trigger \
  -H "X-Signature: sha256=<hmac>" \
  -H "Content-Type: application/json" \
  -d '{"alert": "OOMKilled", "service": "payment-api", "namespace": "production"}'
```

### 配置管理

```bash
# 读取/更新 LLM 配置（热加载）
GET/PATCH  /api/config/models

# 测试 LLM 连通性
POST /api/config/models/test   body: {"providerName": "openai"}

# 读取/更新安全配置
GET/PATCH  /api/config/security

# 读取/更新 Agent 参数
GET/PATCH  /api/config/agent
```

### MCP 服务

```bash
GET    /api/mcp/config          # 列出 MCP 服务
POST   /api/mcp/config          # 添加 MCP 服务
DELETE /api/mcp/config/:id      # 删除 MCP 服务
```

---

## 🔧 技能系统

### 目录结构

```
skills/
├── built-in/                   # 内置技能
│   ├── shell/                  # Shell 执行（跨平台 PowerShell/bash）
│   ├── file-manager/           # 文件读写
│   ├── http-client/            # HTTP 请求
│   ├── notification/           # 钉钉 / 飞书 / Email 通知
│   ├── document-processor/     # PDF / Word / Excel / Markdown
│   ├── vision/                 # 图片理解 / OCR / 图表分析
│   ├── database-connector/     # 只读 SQL 查询（NL2Insight）
│   ├── log-analyzer/           # 日志拉取 + LLM 异常聚类
│   ├── browser-automation/     # Playwright RPA（Windows Edge / macOS Chrome）
│   ├── gemini-cli/             # Google Gemini CLI 集成
│   └── claude-code/            # Claude Code CLI 集成
├── adapters/                   # 企业能力适配器
│   ├── knowledge-base/         # IKnowledgeBase 接口（任意 Wiki/文档系统）
│   └── notification-hub/       # INotificationHub 接口（任意内部 IM）
├── installed/                  # MCP 安装的技能
└── local/                      # 本地自定义技能
```

### 创建自定义技能

1. 在 `skills/local/` 下新建目录
2. 创建 `SKILL.md`（元数据 + 动作描述）
3. 创建 `index.ts`（实现逻辑）

```yaml
---
name: my-skill
version: 1.0.0
description: 我的自定义技能
---

### query_data
查询数据并返回结果
- **参数**: `keyword` (string) — 查询关键词
- **返回**: 匹配的数据列表
```

或直接在聊天界面说："**帮我生成一个能查询 XXX 系统的技能**"，Agent 自动生成并热加载。

### 企业连接器（30 行 YAML）

```yaml
# connectors/my-system.yaml
name: crm-system
type: http
baseUrl: ${CRM_BASE_URL}
auth:
  type: bearer
  token: ${CRM_TOKEN}
actions:
  - name: get_customer
    method: GET
    path: /api/customers/{id}
  - name: create_ticket
    method: POST
    path: /api/tickets
```

---

## 🚨 AIOps 运维自动化

### YAML Runbook 示例

```yaml
# runbooks/service-oom.yaml
name: OOM 自动恢复
description: 内存溢出时自动分析并重启服务
trigger:
  type: webhook
  condition: "alert contains 'OOMKilled'"
steps:
  - tool: shell.execute
    command: "kubectl top pods -n {{ service_namespace }}"
  - tool: log-analyzer.fetch_logs
    params:
      service: "{{ service_name }}"
      lines: 100
  - tool: shell.execute
    command: "kubectl rollout restart deployment/{{ service_name }} -n {{ service_namespace }}"
    condition: "previous_output contains 'OOM'"
  - tool: notification-hub.send
    params:
      message: "{{ service_name }} OOM 已自动修复"
```

### 触发 Runbook

```bash
# 外部监控系统发送告警 → 自动触发 Runbook
curl -X POST http://localhost:3000/api/webhooks/{webhook-id}/trigger \
  -H "X-Signature: sha256=$(echo -n '{"service_name":"api"}' | openssl dgst -sha256 -hmac 'your-secret' | cut -d' ' -f2)" \
  -d '{"service_name": "payment-api", "service_namespace": "production"}'
```

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    Web 控制台（12 页面）                  │
│     Next.js 16 · React 19 · Tailwind CSS · shadcn/ui    │
├─────────────────────────────────────────────────────────┤
│                   Gateway Layer                          │
│        Fastify HTTP / SSE / WebSocket + Auth            │
│   /api/chat · /api/webhooks · /api/runbooks · /api/rpa  │
│          /api/config · /api/sessions · /api/mcp         │
├───────────────┬─────────────────────────────────────────┤
│  Agent Core   │          Orchestration                   │
│  ReAct Loop   │  Multi-Agent · DAG Executor             │
│  (async gen)  │  Runbook Engine · Scheduler (Cron)      │
├───────────────┼─────────────────────────────────────────┤
│ Memory System │          Skill System                    │
│ Short-term    │  Local (SKILL.md) · MCP (stdio/SSE)     │
│ Long-term Vec │  Adapters (IKnowledgeBase/INotifHub)    │
│ Knowledge     │  database-connector · browser-auto      │
│ Graph (BFS)   │  log-analyzer · Shell Sandbox (xplat)   │
├───────────────┴─────────────────────────────────────────┤
│                  LLM Adapter Layer                       │
│              OpenAI · Anthropic · Custom                 │
├─────────────────────────────────────────────────────────┤
│                SQLite (WAL mode)                         │
│  sessions · messages · tasks · memories · webhooks      │
│  knowledge_nodes · knowledge_edges · scheduled_tasks    │
└─────────────────────────────────────────────────────────┘
```

---

## ⚙️ 配置说明

主配置文件：`config/default.yaml`（支持 `${ENV_VAR:default}` 环境变量插值）

```yaml
models:
  default: openai
  providers:
    openai:
      type: openai
      baseUrl: ${OPENAI_BASE_URL}
      apiKey: ${OPENAI_API_KEY}
      model: ${OPENAI_MODEL:gpt-4}
      maxTokens: 4096
      embeddingModel: ${EMBEDDING_MODEL:text-embedding-3-small}

agent:
  maxIterations: 10           # ReAct 最大轮次
  maxContextTokens: 120000    # 触发摘要压缩的 token 阈值

skills:
  shell:
    sandbox:
      enabled: true
      mode: blocklist          # blocklist | allowlist

auth:
  enabled: false
  mode: api-key               # api-key | jwt
```

所有配置均可在 **系统设置** 页面实时修改，无需重启。

---

## 🧪 测试

```bash
npm run test:run   # 单次运行全部测试（vitest）
npm test           # watch 模式

# TypeScript 类型检查
npx tsc --noEmit
```

当前测试覆盖：**90 tests，8 files，全部通过**

---

## 📂 项目结构

```
cmasterBot/
├── src/
│   ├── core/               # Agent、数据库、上下文、DAG、Runbook、Webhook
│   │   ├── agent.ts
│   │   ├── runbook-engine.ts
│   │   ├── webhook-repository.ts
│   │   ├── knowledge-sync.ts
│   │   └── nl2sql.ts
│   ├── gateway/server.ts   # 全部 API 路由
│   ├── llm/                # LLM 适配器工厂
│   ├── memory/             # 短期 + 长期 + 知识图谱
│   └── skills/             # 技能加载器、注册中心、连接器
├── skills/
│   ├── built-in/           # 内置技能（14 个模块）
│   ├── adapters/           # 企业能力适配器
│   ├── installed/
│   └── local/
├── runbooks/               # YAML 运维手册示例
├── connectors/             # 企业连接器配置示例
├── web/                    # Next.js 16 前端（12 个页面）
├── config/default.yaml     # 主配置
├── docs/                   # 架构文档、路线图、竞赛文档
└── data/cmaster.db         # SQLite 数据文件
```

---

## License

MIT
