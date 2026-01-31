# CMaster Bot - 企业级 AI 助手

一个功能完备、可扩展的企业级 AI 助手系统，集成了现代化的 Web 控制台、可热加载的 LLM 引擎以及强大的插件系统。

## 🌟 核心特性

- 🖥️ **现代化 Web 控制台** - 基于 Next.js + shadcn/ui 构建，提供仪表盘、聊天、技能管理等全方位界面。
- 🤖 **多 LLM 适配** - 同时支持 OpenAI 和 Anthropic API 标准，支持模型热加载。
- 🔧 **可扩展技能系统** - 基于 `SKILL.md` 协议，支持 Shell 执行、文件管理、HTTP 请求等扩展。
- 🌓 **个性化体验** - 全局支持亮色/暗色模式切换，适配各种办公环境。
- 🧠 **长效对话记忆** - 解决了会话上下文丢失问题，支持稳定的多轮对话。
- 🏢 **企业级自托管** - 支持内网隔离部署，所有资源本地化。

## 🚀 快速开始

### 安装依赖

```bash
# 安装服务端依赖
npm install

# 安装 Web UI 依赖
cd web && npm install && cd ..
```

### 配置

1. 复制环境配置文件：
```bash
cp .env.example .env
```

2. 编辑 `.env` 文件，配置你的 LLM 服务地址和密钥：
```env
OPENAI_BASE_URL=http://your-internal-ai-gateway/v1
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=gpt-4
```

### 启动服务

```bash
# 开发模式 (服务端)
npm run dev

# 只有在需要修改 UI 时执行 (Web 端)
cd web && npm run dev

# 生产部署 (构建并由服务端托管)
npm run build          # 构建后端
cd web && npm run build # 构建前端
cd ..
npm start              # 启动统一服务
```

## 🖥️ Web 控制台

项目集成了基于 Next.js 的现代化管理后台，默认访问地址为 `http://localhost:3000`。

- **仪表盘**：查看系统概览。
- **智能对话**：体验 ReAct 增强的 AI 交互，支持主题切换。
- **技能管理**：实时查看后端加载的扩展插件。

## API 使用

### 聊天 API

```bash
# 单次对话
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "帮我列出当前目录的文件"}'

# 流式响应
curl -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "写一个 Hello World 程序"}'
```

### WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
ws.send(JSON.stringify({ type: 'chat', message: '你好' }));
```

## 技能系统

技能是扩展 AI 助手能力的模块。每个技能是一个独立目录，包含 `SKILL.md` 描述文件。

### 目录结构

```
skills/
├── built-in/         # 内置技能
│   ├── shell/
│   ├── file-manager/
│   └── http-client/
├── installed/        # 安装的第三方技能
└── local/            # 本地开发的技能
```

### 创建新技能

1. 在 `skills/local/` 下创建技能目录
2. 创建 `SKILL.md` 文件定义技能元数据和 actions
3. 创建 `index.ts` 实现 action 处理函数

示例 `SKILL.md`:

```yaml
---
name: my-skill
version: 1.0.0
description: 我的自定义技能
---

# My Skill

## Actions

### do_something
执行某个操作
- **参数**: `input` (string) - 输入内容
- **返回**: 操作结果
```

## 技术架构

```
┌─────────────────────────────────────┐
│           Gateway Layer             │
│  (Fastify HTTP/WebSocket Server)    │
├─────────────────────────────────────┤
│           Agent Core                │
│  (Orchestrator + ReAct Pattern)     │
├─────────────────────────────────────┤
│         LLM Adapter Layer           │
│   (OpenAI / Anthropic / Custom)     │
├─────────────────────────────────────┤
│          Skill System               │
│   (SKILL.md Protocol + Loader)      │
└─────────────────────────────────────┘
```

## License

MIT
