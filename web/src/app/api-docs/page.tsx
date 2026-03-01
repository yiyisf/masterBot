"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, ChevronDown, ChevronRight, Lock, Wifi, Copy, Check } from "lucide-react";

// ─────────────────────────────────────────────
// Type definitions
// ─────────────────────────────────────────────

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "WS" | "SSE";

interface EndpointParam {
  name: string;
  in: "path" | "query" | "body";
  type: string;
  required?: boolean;
  description?: string;
}

interface Endpoint {
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  auth?: boolean;
  params?: EndpointParam[];
  requestBody?: string;       // JSON example string
  responseBody?: string;      // JSON example string
}

interface ApiGroup {
  name: string;
  description: string;
  endpoints: Endpoint[];
}

// ─────────────────────────────────────────────
// API specification data
// ─────────────────────────────────────────────

const API_GROUPS: ApiGroup[] = [
  {
    name: "系统 (System)",
    description: "健康检查与系统状态端点",
    endpoints: [
      {
        method: "GET",
        path: "/health",
        summary: "健康检查",
        description: "返回服务存活状态，不需要认证。常用于负载均衡器探针。",
        auth: false,
        responseBody: `{ "status": "ok", "timestamp": "2025-01-01T00:00:00.000Z" }`,
      },
      {
        method: "GET",
        path: "/api/status",
        summary: "系统状态",
        description: "返回已加载的技能列表、MCP 服务器状态、调度任务数量等运行时信息。",
        responseBody: `{
  "skills": [...],
  "mcpServers": [...],
  "scheduledTasks": 3,
  "uptime": 3600
}`,
      },
    ],
  },
  {
    name: "聊天 (Chat)",
    description: "AI 对话接口，支持流式（SSE）和非流式两种模式",
    endpoints: [
      {
        method: "POST",
        path: "/api/chat",
        summary: "非流式聊天",
        description: "发送消息并等待完整响应返回。适合简单问答场景，不适合长时间 Agent 执行。",
        requestBody: `{
  "message": "帮我写一个 Hello World",
  "sessionId": "abc123",
  "history": [{ "role": "user", "content": "..." }],
  "attachments": []
}`,
        responseBody: `{
  "sessionId": "abc123",
  "message": "以下是 Hello World 示例...",
  "steps": [...]
}`,
      },
      {
        method: "SSE",
        path: "/api/chat/stream",
        summary: "SSE 流式聊天（推荐）",
        description: "以 Server-Sent Events 格式返回 Agent 执行过程中的每一步。支持 thought / plan / action / observation / answer / interrupt 等事件类型。",
        requestBody: `{
  "message": "查询服务器状态并生成报告",
  "sessionId": "abc123",
  "history": [],
  "messageContent": [
    { "type": "text", "text": "..." },
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
  ]
}`,
        responseBody: `data: {"type":"thought","content":"我需要先..."}
data: {"type":"action","toolName":"shell.execute"}
data: {"type":"observation","content":"命令输出...","duration":123}
data: {"type":"answer","content":"报告如下..."}
data: {"type":"meta","assistantMessageId":"msg_xxx"}
data: {"type":"suggestions","items":["继续问...","还可以..."]}`,
      },
      {
        method: "WS",
        path: "/ws",
        summary: "WebSocket 聊天",
        description: "基于 WebSocket 的双向实时通信接口，消息格式与 SSE 流式端点一致。",
        requestBody: `{ "message": "你好", "sessionId": "abc123" }`,
      },
    ],
  },
  {
    name: "会话 (Sessions)",
    description: "会话创建、消息历史、置顶、重命名等管理操作",
    endpoints: [
      {
        method: "GET",
        path: "/api/sessions",
        summary: "获取会话列表",
        description: "返回所有历史会话，按更新时间倒序，置顶会话在前。",
        responseBody: `[{ "id": "abc", "title": "上午对话", "updatedAt": "...", "is_pinned": false }]`,
      },
      {
        method: "POST",
        path: "/api/sessions",
        summary: "创建新会话",
        requestBody: `{ "title": "新对话" }`,
        responseBody: `{ "id": "abc123", "title": "新对话", "createdAt": "..." }`,
      },
      {
        method: "GET",
        path: "/api/sessions/:id/messages",
        summary: "获取会话消息",
        description: "支持游标分页，`before` 参数为消息 ID，`limit` 默认 50。",
        params: [
          { name: "id", in: "path", type: "string", required: true, description: "会话 ID" },
          { name: "limit", in: "query", type: "number", description: "每页数量（默认 50）" },
          { name: "before", in: "query", type: "string", description: "游标（消息 ID）" },
        ],
      },
      {
        method: "GET",
        path: "/api/sessions/:id/tasks",
        summary: "获取会话 DAG 任务",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "会话 ID" }],
      },
      {
        method: "DELETE",
        path: "/api/sessions/:id",
        summary: "删除会话",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "会话 ID" }],
      },
      {
        method: "PATCH",
        path: "/api/sessions/:id/title",
        summary: "重命名会话",
        requestBody: `{ "title": "新标题" }`,
      },
      {
        method: "PATCH",
        path: "/api/sessions/:id/pin",
        summary: "置顶 / 取消置顶",
        requestBody: `{ "isPinned": true }`,
      },
      {
        method: "POST",
        path: "/api/sessions/:id/interrupt-response",
        summary: "响应高危操作确认",
        description: "Human-in-the-Loop 机制：当 Agent 检测到危险工具调用时暂停并等待此接口响应后继续执行。",
        requestBody: `{ "approved": true }`,
        responseBody: `{ "ok": true }`,
      },
    ],
  },
  {
    name: "技能 (Skills)",
    description: "技能管理、AI 代码生成与修复",
    endpoints: [
      {
        method: "GET",
        path: "/api/skills",
        summary: "获取所有技能",
        description: "返回已注册的所有技能，包括名称、描述、动作列表和加载状态。",
      },
      {
        method: "POST",
        path: "/api/skills/generate",
        summary: "AI 生成技能",
        description: "根据描述自动生成 SKILL.md + index.ts 并安装到 skills/installed/。",
        requestBody: `{
  "name": "my-skill",
  "description": "查询天气的技能",
  "actions": [{ "name": "get_weather", "description": "获取指定城市天气" }]
}`,
      },
      {
        method: "POST",
        path: "/api/skills/:name/repair",
        summary: "修复技能",
        description: "重新生成指定技能的实现代码（当技能加载失败时使用）。",
        params: [{ name: "name", in: "path", type: "string", required: true, description: "技能名称" }],
      },
    ],
  },
  {
    name: "MCP 服务 (MCP)",
    description: "MCP (Model Context Protocol) 服务配置与注册中心",
    endpoints: [
      {
        method: "GET",
        path: "/api/mcp/config",
        summary: "获取 MCP 配置",
        responseBody: `[{ "id": "1", "name": "GitHub MCP", "type": "stdio", "enabled": true }]`,
      },
      {
        method: "POST",
        path: "/api/mcp/config",
        summary: "添加 MCP 服务",
        requestBody: `{
  "id": "gh",
  "name": "GitHub MCP",
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_TOKEN": "ghp_xxx" },
  "enabled": true
}`,
      },
      {
        method: "DELETE",
        path: "/api/mcp/config/:id",
        summary: "删除 MCP 服务",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "MCP 服务 ID" }],
      },
      {
        method: "GET",
        path: "/api/mcp/registry",
        summary: "浏览 MCP 注册中心",
        params: [
          { name: "cursor", in: "query", type: "string", description: "分页游标" },
          { name: "count", in: "query", type: "number", description: "每页数量" },
        ],
      },
      {
        method: "GET",
        path: "/api/mcp/registry/search",
        summary: "搜索 MCP 包",
        params: [{ name: "q", in: "query", type: "string", required: true, description: "搜索关键词" }],
      },
      {
        method: "GET",
        path: "/api/mcp/registry/:name",
        summary: "获取 MCP 包详情",
        params: [{ name: "name", in: "path", type: "string", required: true, description: "包名称" }],
      },
      {
        method: "POST",
        path: "/api/mcp/registry/install",
        summary: "安装 MCP 包",
        requestBody: `{ "name": "@modelcontextprotocol/server-github", "env": { "GITHUB_TOKEN": "ghp_xxx" } }`,
      },
    ],
  },
  {
    name: "知识图谱 (Knowledge)",
    description: "知识录入、全文检索与 GraphRAG 遍历",
    endpoints: [
      {
        method: "GET",
        path: "/api/knowledge/stats",
        summary: "知识库统计",
        responseBody: `{ "nodes": 120, "edges": 350 }`,
      },
      {
        method: "POST",
        path: "/api/knowledge/ingest",
        summary: "录入知识",
        requestBody: `{
  "content": "CMaster 是一个企业级 AI 助手...",
  "title": "CMaster 简介",
  "type": "document",
  "source": "内部文档"
}`,
      },
      {
        method: "GET",
        path: "/api/knowledge/search",
        summary: "知识搜索",
        params: [
          { name: "q", in: "query", type: "string", required: true, description: "搜索关键词" },
          { name: "depth", in: "query", type: "number", description: "图遍历深度（默认 2）" },
          { name: "limit", in: "query", type: "number", description: "返回数量（默认 10）" },
        ],
      },
    ],
  },
  {
    name: "长期记忆 (Memory)",
    description: "Agent 长期记忆的查询与管理",
    endpoints: [
      {
        method: "GET",
        path: "/api/memories",
        summary: "搜索长期记忆",
        params: [
          { name: "q", in: "query", type: "string", description: "相似度搜索关键词" },
          { name: "limit", in: "query", type: "number", description: "返回数量（默认 50）" },
        ],
        responseBody: `[{ "id": "1", "content": "用户偏好暗色模式", "metadata": {}, "createdAt": "..." }]`,
      },
      {
        method: "DELETE",
        path: "/api/memories/:id",
        summary: "删除记忆条目",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "记忆 ID" }],
      },
    ],
  },
  {
    name: "工作流 (Workflows)",
    description: "可视化工作流的 CRUD 与执行",
    endpoints: [
      { method: "GET", path: "/api/workflows", summary: "获取工作流列表" },
      {
        method: "POST",
        path: "/api/workflows",
        summary: "创建工作流",
        requestBody: `{ "name": "每日报告", "description": "...", "definition": {} }`,
      },
      {
        method: "PUT",
        path: "/api/workflows/:id",
        summary: "更新工作流",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "工作流 ID" }],
        requestBody: `{ "name": "新名称", "definition": {} }`,
      },
      {
        method: "DELETE",
        path: "/api/workflows/:id",
        summary: "删除工作流",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "工作流 ID" }],
      },
      {
        method: "POST",
        path: "/api/workflows/:id/execute",
        summary: "执行工作流",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "工作流 ID" }],
      },
    ],
  },
  {
    name: "Webhook",
    description: "Webhook 管理与入站触发（支持 HMAC-SHA256 签名校验）",
    endpoints: [
      { method: "GET", path: "/api/webhooks", summary: "获取 Webhook 列表" },
      {
        method: "POST",
        path: "/api/webhooks",
        summary: "创建 Webhook",
        requestBody: `{ "name": "GitHub Push", "description": "GitHub 推送事件" }`,
        responseBody: `{ "id": "wh_xxx", "secret": "whsec_xxx", "url": "/api/webhooks/wh_xxx/trigger" }`,
      },
      {
        method: "PATCH",
        path: "/api/webhooks/:id",
        summary: "更新 Webhook",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "Webhook ID" }],
      },
      {
        method: "DELETE",
        path: "/api/webhooks/:id",
        summary: "删除 Webhook",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "Webhook ID" }],
      },
      {
        method: "POST",
        path: "/api/webhooks/:id/trigger",
        summary: "入站触发（外部调用）",
        description: "外部系统向此端点发送 POST 请求以触发 Webhook。需在 `X-Webhook-Signature` header 中携带 HMAC-SHA256 签名。",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "Webhook ID" }],
        requestBody: `{ "event": "push", "ref": "refs/heads/main", "repository": {...} }`,
      },
    ],
  },
  {
    name: "企业连接器 (Connectors)",
    description: "YAML/JSON 定义的企业系统连接器管理",
    endpoints: [
      { method: "GET", path: "/api/connectors", summary: "获取连接器列表" },
      {
        method: "POST",
        path: "/api/connectors",
        summary: "创建连接器",
        requestBody: `{
  "name": "jira-connector",
  "baseUrl": "https://your-company.atlassian.net",
  "auth": { "type": "bearer", "token": "..." },
  "actions": [{ "name": "get_issue", "method": "GET", "path": "/rest/api/3/issue/{issueId}" }]
}`,
      },
      {
        method: "DELETE",
        path: "/api/connectors/:name",
        summary: "删除连接器",
        params: [{ name: "name", in: "path", type: "string", required: true, description: "连接器名称" }],
      },
    ],
  },
  {
    name: "定时任务 (Scheduled)",
    description: "基于 Cron 表达式的定时 Agent 任务",
    endpoints: [
      { method: "GET", path: "/api/scheduled-tasks", summary: "获取定时任务列表" },
      {
        method: "POST",
        path: "/api/scheduled-tasks",
        summary: "创建定时任务",
        requestBody: `{
  "name": "每日报告",
  "prompt": "生成今日系统运行报告",
  "cron": "0 9 * * 1-5",
  "enabled": true
}`,
      },
      {
        method: "PATCH",
        path: "/api/scheduled-tasks/:id",
        summary: "更新定时任务",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "任务 ID" }],
      },
      {
        method: "DELETE",
        path: "/api/scheduled-tasks/:id",
        summary: "删除定时任务",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "任务 ID" }],
      },
      {
        method: "POST",
        path: "/api/scheduled-tasks/:id/trigger",
        summary: "立即触发任务",
        description: "跳过 Cron 计划，立即执行一次定时任务。",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "任务 ID" }],
      },
    ],
  },
  {
    name: "Runbook",
    description: "YAML 定义的 AIOps Runbook 执行引擎",
    endpoints: [
      { method: "GET", path: "/api/runbooks", summary: "获取 Runbook 列表" },
      {
        method: "POST",
        path: "/api/runbooks",
        summary: "创建 Runbook",
        requestBody: `{
  "filename": "restart-service.yaml",
  "content": "name: Restart Service\\nsteps:\\n  - action: shell.execute\\n    command: systemctl restart nginx"
}`,
      },
      {
        method: "POST",
        path: "/api/runbooks/:filename/execute",
        summary: "执行 Runbook",
        params: [{ name: "filename", in: "path", type: "string", required: true, description: "Runbook 文件名" }],
        requestBody: `{ "variables": { "SERVICE_NAME": "nginx" } }`,
      },
    ],
  },
  {
    name: "AI-RPA",
    description: "基于 Playwright 的浏览器自动化接口",
    endpoints: [
      {
        method: "POST",
        path: "/api/rpa/execute",
        summary: "执行 RPA 动作",
        description: "执行结构化的浏览器自动化步骤（navigate, click, fill, extract 等）。",
        requestBody: `{
  "type": "navigate",
  "params": { "url": "https://example.com" }
}`,
      },
      {
        method: "POST",
        path: "/api/rpa/prompt",
        summary: "自然语言 RPA",
        description: "用自然语言描述 RPA 任务，由 AI 解析后执行浏览器操作。",
        requestBody: `{
  "prompt": "打开 GitHub 并搜索 CMaster Bot",
  "url": "https://github.com"
}`,
      },
    ],
  },
  {
    name: "Prompt 模板库 (Prompts)",
    description: "内置及自定义 Prompt 模板管理",
    endpoints: [
      {
        method: "GET",
        path: "/api/prompts",
        summary: "获取模板列表",
        params: [
          { name: "category", in: "query", type: "string", description: "按分类筛选" },
          { name: "q", in: "query", type: "string", description: "关键词搜索" },
        ],
      },
      {
        method: "POST",
        path: "/api/prompts",
        summary: "创建自定义模板",
        requestBody: `{
  "title": "代码审查",
  "description": "对代码进行专业审查",
  "prompt": "请对以下代码进行审查，关注...",
  "category": "开发"
}`,
      },
      {
        method: "PATCH",
        path: "/api/prompts/:id",
        summary: "更新模板",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "模板 ID" }],
      },
      {
        method: "DELETE",
        path: "/api/prompts/:id",
        summary: "删除模板",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "模板 ID" }],
      },
      {
        method: "POST",
        path: "/api/prompts/:id/use",
        summary: "记录模板使用",
        description: "增加模板的使用计数，用于排行统计。",
        params: [{ name: "id", in: "path", type: "string", required: true, description: "模板 ID" }],
      },
    ],
  },
  {
    name: "配置 (Config)",
    description: "模型提供商、安全与 Agent 运行时配置（运行时修改，无需重启）",
    endpoints: [
      { method: "GET", path: "/api/config/models", summary: "获取模型配置" },
      {
        method: "PATCH",
        path: "/api/config/models",
        summary: "更新模型配置",
        requestBody: `{ "default": "gpt-4o", "providers": { "openai": { "apiKey": "sk-xxx" } } }`,
      },
      {
        method: "POST",
        path: "/api/config/models/test",
        summary: "测试模型连接",
        requestBody: `{ "providerName": "openai" }`,
        responseBody: `{ "ok": true, "latencyMs": 450 }`,
      },
      { method: "GET", path: "/api/config/security", summary: "获取安全配置" },
      {
        method: "PATCH",
        path: "/api/config/security",
        summary: "更新安全配置",
        requestBody: `{ "sandbox": { "enabled": true, "mode": "blocklist" }, "auth": { "enabled": false } }`,
      },
      { method: "GET", path: "/api/config/agent", summary: "获取 Agent 配置" },
      {
        method: "PATCH",
        path: "/api/config/agent",
        summary: "更新 Agent 配置",
        requestBody: `{ "maxIterations": 20, "maxContextTokens": 32000 }`,
      },
    ],
  },
  {
    name: "用量统计 (Usage)",
    description: "Token 用量与自改进事件查询",
    endpoints: [
      {
        method: "GET",
        path: "/api/usage/daily",
        summary: "每日用量统计",
        params: [{ name: "limit", in: "query", type: "number", description: "返回天数（默认 30）" }],
        responseBody: `[{ "date": "2025-01-01", "inputTokens": 12000, "outputTokens": 5400, "totalCost": 0.18 }]`,
      },
      {
        method: "GET",
        path: "/api/usage/summary",
        summary: "用量汇总",
        responseBody: `{ "totalMessages": 1200, "totalInputTokens": 450000, "totalOutputTokens": 180000, "estimatedCost": 5.40 }`,
      },
      {
        method: "GET",
        path: "/api/improvements",
        summary: "自改进事件列表",
        description: "负面反馈触发的自改进记录（分类、触发的技能生成等）。",
        params: [{ name: "limit", in: "query", type: "number", description: "返回数量（默认 50）" }],
      },
    ],
  },
  {
    name: "反馈 (Feedback)",
    description: "消息评分与质量反馈",
    endpoints: [
      {
        method: "POST",
        path: "/api/feedback",
        summary: "提交消息反馈",
        requestBody: `{
  "messageId": "msg_xxx",
  "sessionId": "abc123",
  "rating": "positive"
}`,
        responseBody: `{ "ok": true }`,
      },
    ],
  },
];

// ─────────────────────────────────────────────
// Helper components
// ─────────────────────────────────────────────

const METHOD_STYLES: Record<HttpMethod, string> = {
  GET:    "bg-blue-500/10 text-blue-400 border-blue-500/30",
  POST:   "bg-green-500/10 text-green-400 border-green-500/30",
  PATCH:  "bg-amber-500/10 text-amber-400 border-amber-500/30",
  PUT:    "bg-orange-500/10 text-orange-400 border-orange-500/30",
  DELETE: "bg-red-500/10 text-red-400 border-red-500/30",
  WS:     "bg-violet-500/10 text-violet-400 border-violet-500/30",
  SSE:    "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
};

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0 ${METHOD_STYLES[method]}`}>
      {method}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1 rounded hover:bg-muted/80 transition-colors"
      title="复制"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative rounded-md bg-zinc-900/60 border border-zinc-700/50 overflow-hidden">
      <div className="absolute top-1.5 right-1.5">
        <CopyButton text={code} />
      </div>
      <pre className="p-3 pr-8 text-xs font-mono text-zinc-300 overflow-x-auto whitespace-pre">{code}</pre>
    </div>
  );
}

const PARAM_IN_LABELS: Record<string, string> = {
  path: "路径",
  query: "Query",
  body: "Body",
};

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!(endpoint.description || endpoint.params?.length || endpoint.requestBody || endpoint.responseBody);

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
        onClick={() => hasDetail && setExpanded(v => !v)}
      >
        <MethodBadge method={endpoint.method} />
        <code className="flex-1 text-sm font-mono text-foreground/90">{endpoint.path}</code>
        <span className="text-sm text-muted-foreground hidden sm:block">{endpoint.summary}</span>
        {endpoint.auth === false && (
          <span className="text-[10px] text-muted-foreground/60 border border-muted-foreground/30 px-1 py-0.5 rounded shrink-0">公开</span>
        )}
        {hasDetail && (
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </button>

      {/* Summary on mobile */}
      <div className="sm:hidden px-4 py-1.5 text-xs text-muted-foreground bg-muted/10 border-t border-border/30">
        {endpoint.summary}
      </div>

      {/* Expanded detail */}
      {expanded && hasDetail && (
        <div className="px-4 py-4 space-y-4 border-t border-border/30">
          {endpoint.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">{endpoint.description}</p>
          )}

          {endpoint.params && endpoint.params.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">参数</h4>
              <div className="space-y-1.5">
                {endpoint.params.map((p) => (
                  <div key={p.name} className="flex items-start gap-3 text-sm">
                    <code className="text-primary font-mono text-xs shrink-0 mt-0.5">{p.name}</code>
                    <span className="text-[10px] text-muted-foreground bg-muted/50 px-1 py-0.5 rounded shrink-0 mt-0.5">
                      {PARAM_IN_LABELS[p.in] ?? p.in}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70 shrink-0 mt-0.5 font-mono">{p.type}</span>
                    {p.required && <span className="text-[10px] text-red-400 shrink-0 mt-0.5">必填</span>}
                    {p.description && <span className="text-xs text-muted-foreground">{p.description}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {endpoint.requestBody && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">请求体示例</h4>
              <CodeBlock code={endpoint.requestBody} />
            </div>
          )}

          {endpoint.responseBody && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">响应示例</h4>
              <CodeBlock code={endpoint.responseBody} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GroupSection({ group, defaultOpen }: { group: ApiGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 py-3 text-left group"
      >
        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        <h2 className="text-base font-semibold group-hover:text-primary transition-colors">{group.name}</h2>
        <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full ml-1">
          {group.endpoints.length}
        </span>
        <span className="text-xs text-muted-foreground ml-2 hidden sm:block">{group.description}</span>
      </button>
      {open && (
        <div className="space-y-2 ml-6 mb-6">
          {group.endpoints.map((ep) => (
            <EndpointCard key={`${ep.method}-${ep.path}`} endpoint={ep} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────

export default function ApiDocsPage() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return API_GROUPS;
    const q = query.toLowerCase();
    return API_GROUPS.map((g) => ({
      ...g,
      endpoints: g.endpoints.filter(
        (ep) =>
          ep.path.toLowerCase().includes(q) ||
          ep.summary.toLowerCase().includes(q) ||
          ep.description?.toLowerCase().includes(q) ||
          ep.method.toLowerCase().includes(q)
      ),
    })).filter((g) => g.endpoints.length > 0);
  }, [query]);

  const totalEndpoints = API_GROUPS.reduce((n, g) => n + g.endpoints.length, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Wifi className="w-5 h-5 text-primary" />
                API 参考文档
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                CMaster Bot Backend · <span className="font-mono">http://localhost:3000</span> ·{" "}
                <span className="text-foreground">{totalEndpoints}</span> 个端点
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded-md border shrink-0">
              <Lock className="w-3 h-3" />
              认证：X-API-Key / Bearer JWT
            </div>
          </div>

          {/* Method legend */}
          <div className="flex flex-wrap gap-2">
            {(Object.entries(METHOD_STYLES) as [HttpMethod, string][]).map(([method, cls]) => (
              <span key={method} className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${cls}`}>
                {method}
              </span>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="搜索端点路径、描述或 HTTP 方法…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="max-w-4xl mx-auto px-4 py-4 divide-y divide-border/30">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">未找到匹配的端点</div>
          ) : (
            filtered.map((group, i) => (
              <GroupSection key={group.name} group={group} defaultOpen={i < 2} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
