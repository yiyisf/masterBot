# CMaster Bot — 10 分钟快速上手

## 步骤 1：部署

### Docker（最简单）

```bash
git clone https://github.com/YOUR_ORG/cmaster-bot.git
cd cmaster-bot
cp .env.example .env
```

编辑 `.env`：
```env
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

```bash
docker compose up -d
```

访问 http://localhost:3000

---

## 步骤 2：第一次对话

打开 `/chat` 页面，尝试以下问题：

```
你好！你能帮我做什么？
```

AI 会介绍其核心能力。接着尝试：

```
帮我列出当前目录的文件
```

观察左侧"思考链"区域展示 Agent 的 ReAct 推理过程。

---

## 步骤 3：安装新技能

进入 `/skills` 页面，点击"从注册中心安装"，搜索你需要的 MCP 工具。

或者直接在聊天中说：

```
帮我生成一个能查询我们公司 ERP 订单状态的技能，接口是 GET /api/orders/{id}，需要 Bearer Token 认证
```

AI 将自动生成并热加载该技能（无需重启）。

---

## 步骤 4：导入企业知识

进入 `/knowledge` 页面，点击"导入文档"，上传 PDF、Word 或直接粘贴文本。

然后在聊天中：

```
搜索关于报销流程的规定
```

系统会通过 GraphRAG 找到最相关的知识节点。

---

## 步骤 5：设置定时任务

进入 `/scheduled` 页面，点击"新建任务"：

- **任务名称**: 每日销售报告
- **Cron 表达式**: `0 8 * * 1-5`（工作日 8 点）
- **执行提示词**: 查询昨日销售数据，生成日报并发送到飞书群

---

## 常见问题

**Q: AI 回答不准确怎么办？**
点击回复下方的"没帮助"按钮，系统会自动分析失败原因，并在需要时生成新技能改善能力。

**Q: 如何接入自己的数据库？**
在 `/connectors` 添加数据库连接器，或使用 `database-connector` 技能（参见 [skills-guide.md](skills-guide.md)）。

**Q: 支持哪些 LLM？**
支持任何 OpenAI 兼容接口（OpenAI、Azure OpenAI、DeepSeek、本地 Ollama、etc.）。在 `/settings` 中切换。
