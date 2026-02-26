# CMaster Bot — 自我进化的企业 AI 智能体平台

> 竞赛项目介绍文档 | v0.3.0

---

## 项目简介

**CMaster Bot** 是一个面向企业内网场景的 AI 智能体平台，核心设计理念是**工具无关、协议驱动、零侵入扩展**。它不仅能执行任务，还能在运行时自动生成新技能、热加载到系统中，并立即投入使用，全程无需重启服务、无需人工编写代码。

Phase 14–18 进一步补全了企业运维、数据分析、RPA 三大核心场景，实现了 **7×24 无人值守运维自动化**、**自然语言直连数据仓库**和**跨平台遗留系统接管**。

### 一句话描述

> "告诉 AI 你需要什么能力，它会在 60 秒内为自己造一把新工具；告诉它系统告警了，它会自动执行 Runbook 完成修复。"

---

## 解决的核心问题

### 企业 AI 落地的五大痛点

| 痛点 | 传统方案 | CMaster 方案 |
|------|---------|-------------|
| **集成成本高** | 每接一个系统需开发团队定制 | 30 行 YAML 声明式连接器，自动生成完整技能 |
| **能力扩展慢** | 新增功能需走研发迭代流程（周级） | AI 自动生成技能，60 秒热加载（秒级） |
| **知识孤岛** | 文档散落各系统，检索不精准 | 知识图谱 + 多跳推理 + 自动增量同步 |
| **运维响应慢** | 告警靠人工值班，MTTR 高 | Webhook → Runbook → 自动修复，7×24 无人值守 |
| **数据壁垒** | 业务数据查询需等数据分析师 2–3 天 | 自然语言 → SQL → ECharts，3 分钟自助分析 |

---

## 核心创新点

### 1. Auto-Skill Generator — 运行时自我进化
系统旗舰创新。用户用自然语言描述需求，Agent 全自动：
- 生成 `SKILL.md`（元数据 + 动作协议）
- 生成 `index.ts`（完整实现代码）
- 沙箱验证（静态分析 + 受限试运行）
- 热加载进注册中心，**同一对话中立即可用**

```
用户: "我需要一个能查询我们 CRM 系统客户信息的技能"
      ↓ < 60 秒
Agent: "技能 crm-query 已生成并加载，你现在可以说：查询客户 ID 10086 的信息"
```

### 2. AIOps 运维中枢 — 声明式 Runbook 自动执行
YAML 驱动的告警分诊与自动响应：

```yaml
# runbooks/service-oom.yaml
trigger:
  type: webhook
  condition: "alert contains 'OOMKilled'"
steps:
  - tool: log-analyzer.fetch_logs
    params: { service: "{{ service_name }}", lines: 100 }
  - tool: shell.execute
    command: "kubectl rollout restart deployment/{{ service_name }}"
    condition: "previous_output contains 'OOM'"
  - tool: notification-hub.send
    params: { message: "{{ service_name }} OOM 已自动修复" }
```

外部监控系统发送 Webhook → HMAC 验签 → Agent 执行 Runbook → 根因分析 → 自动修复 + 通知。**MTTR 降低 70%**。

### 3. NL2Insight — 自然语言数据分析
```
用户: "查询上个月各城市订单转化率，用柱状图展示"
         ↓
[Agent]
  1. 获取数据库 Schema
  2. NL → SQL（Schema-Aware Prompting）
  3. 只读沙箱执行（SELECT only，自动 mask 敏感字段）
  4. 生成 ECharts 配置 → 前端渲染为交互图表
```

**数据需求响应：3 天（等分析师）→ 3 分钟（自助）**

### 4. GraphRAG 活知识体系
- 自动增量同步内部 Wiki/文档系统（Cron + Webhook 双触发）
- BFS 多跳推理："支付服务宕机影响哪些业务，oncall 是谁？"
- `findExperts(topic)` — 基于贡献历史发现领域专家
- `detectConflicts()` — 两文档矛盾时自动预警

### 5. AI-RPA — 遗留系统无 API 接管
- Playwright 驱动，跨平台：Windows 优先 Edge（内置），macOS 优先 Chrome
- 自然语言指令 → 截图理解 → 自动操作 Web UI
- 操作前截图预览，人工确认安全门

### 6. 能力适配层（Capability Adapter Layer）
所有外部系统接入通过**抽象接口 + SKILL.md 协议**实现零侵入解耦：

```
业务场景
   ↓ 调用抽象能力接口
能力适配层（Capability Adapters）
   ├─ IKnowledgeBase    →  knowledge-base 适配器（任意 Wiki/文档系统）
   ├─ INotificationHub  →  notification-hub 适配器（任意内部 IM）
   └─ IDataWarehouse    →  database-connector（任意数据库）
         ↓ 具体实现
   ConnectorManager（YAML 连接器配置）
```

**接入新工具只需：** 编写一个 `SKILL.md` + `index.ts` 适配器，现有 Agent 无需任何改动。

---

## 技术栈

### 后端
- **运行时**: Node.js 20+ (ESM, NodeNext 模块系统)
- **框架**: Fastify 5（HTTP / SSE / WebSocket）
- **语言**: TypeScript（严格模式，ES2022 目标）
- **数据库**: SQLite via `node:sqlite` DatabaseSync（WAL 模式，无额外依赖）
- **Agent**: ReAct 模式，async generator 流式输出
- **LLM**: OpenAI / Anthropic 双适配器，工厂模式统一接口
- **RPA**: Playwright（跨平台浏览器自动化）

### 前端
- **框架**: Next.js 16（App Router）+ React 19
- **聊天 UI**: `@assistant-ui/react` 自定义适配器
- **样式**: Tailwind CSS 4 + shadcn/ui 组件库
- **图表**: ECharts（动态加载，渲染 AI 生成的图表配置）
- **实时通信**: SSE 流式传输

### 扩展能力
- **技能协议**: `SKILL.md`（YAML frontmatter + Markdown 动作文档）
- **MCP 协议**: stdio / SSE / Streamable-HTTP 三种传输
- **运维**: YAML Runbook → DAG 执行引擎（声明式，工具无关）
- **数据安全**: SQL 只读沙箱、PII 字段自动 Mask、HMAC-SHA256 Webhook 验签

---

## 与竞品的核心差异

| 能力 | CMaster | Dify | Coze | LangChain |
|------|---------|------|------|-----------|
| 自动生成技能 | ✅ 运行时 AI 生成 | 手动配置 | 手动配置 | 手动编码 |
| 零代码企业集成 | ✅ 30 行 YAML | 需配置 | 有限支持 | 需编码 |
| MCP 生态兼容 | ✅ 原生支持 | 部分 | 无 | 需插件 |
| 知识图谱多跳推理 | ✅ GraphRAG + BFS | 向量 RAG | 向量 RAG | 需自建 |
| 多 Agent 并行 | ✅ DAG 编排 | 有限 | 工作流 | 需框架 |
| AIOps Runbook | ✅ YAML 声明式 | 无 | 无 | 无 |
| 自然语言数据分析 | ✅ NL2SQL + ECharts | 有限 | 无 | 需自建 |
| 遗留系统 RPA | ✅ Playwright 跨平台 | 无 | 无 | 无 |
| 完全开源可自部署 | ✅ | ✅ | 商业 SaaS | ✅ |

---

## 能力覆盖全景

```
"一个普通工作日，CMaster Bot 是这样运作的..."

08:55 → 自动推送今日工作日报（定时调度）
09:00 → 夜间 OOM 告警 → Webhook 触发 Runbook → AI 自动修复 → 通知相关人员
10:30 → 产品经理: "上周留存最差的功能是哪个？" → 30 秒给出 SQL 分析 + ECharts 图表
11:00 → 工程师: "帮我生成一个对接 CRM 的技能" → 60 秒热加载新技能
14:00 → 知识库更新 → AI 增量摄入知识图谱 → 专家匹配更新
16:30 → 遗留 OA 系统: "帮我填报销单" → AI 截图理解 + 自动填写 + 截图确认
23:00 → 定时巡检: "预测服务 X 磁盘 72h 后满" → 创建运维任务
```

---

## 快速启动

### 环境要求
- Node.js >= 20, npm >= 10

```bash
# 克隆 & 安装
git clone <repo-url> && cd cmasterBot
npm install && cd web && npm install && cd ..

# 配置
cp .env.example .env  # 填入 OPENAI_API_KEY + OPENAI_BASE_URL

# 启动
npm run dev            # 后端 :3000
cd web && npm run dev  # 前端 :3001
```

### 健康检查

```bash
curl http://localhost:3000/health
# {"status":"ok","version":"0.3.0"}
```

---

## 项目结构

```
cmasterBot/
├── src/
│   ├── core/              # Agent · DAG · Runbook · Webhook · NL2SQL · KnowledgeSync
│   ├── gateway/           # 全部 API 路由（30+ 端点）
│   ├── llm/               # LLM 适配器工厂
│   ├── memory/            # 短期 + 长期 + 知识图谱（BFS GraphRAG）
│   └── skills/            # 技能加载器 · 注册中心 · 连接器 · MCP 客户端
├── skills/
│   ├── built-in/          # 内置技能（14 模块）
│   └── adapters/          # 企业能力适配器（IKnowledgeBase · INotificationHub）
├── runbooks/              # YAML 运维手册示例
├── connectors/            # 连接器配置示例
├── web/src/app/           # 12 个前端页面
└── docs/                  # 路线图 · 架构文档 · 竞赛文档
```

---

## 测试覆盖

```bash
npm run test:run
# 90 tests, 8 files — all passing ✅
```

---

## 联系与致谢

本项目为竞赛演示版本，基于真实企业 AI 落地工程实践构建，所有核心功能均已实现并通过测试验证。
