---
id: gemini-researcher
name: Gemini Researcher
version: 1.0.0
description: 基于 Gemini 模型的调研与代码分析专家，通过 API 直连（不依赖本地 Gemini CLI 安装），可流式输出、受 Grader 质量闭环约束

# P1-2: 承接原 gemini-cli skill 的 ask/analyze_code 场景。
# 原 skill 通过 spawnCli 调用本地 `gemini` 可执行文件，无流式、无治理、无质量评分（见迁移说明）。
# 此 AgentSpec 走 native 引擎的纯 API 路径，preferredProvider 指向名为 "gemini" 的已配置 provider
# （config/default.yaml 的 models.providers.gemini，type: gemini）；未配置时回退到系统默认模型。
engine: native
resources:
  maxIterations: 15
  timeoutMs: 180000
  concurrency: 3
  preferredProvider: gemini

tools:
  allow:
    - "http-client.*"
    - "file-manager.read"
    - "file-manager.list"
  deny: []

memory:
  namespace: gemini-researcher
  scope: isolated

hooks:
  onStart:
    - type: log
      message: "[gemini-researcher] 开始任务: {{task}}"
  onComplete:
    - type: log
      message: "[gemini-researcher] 任务完成 (instance {{instanceId}})"

outcome:
  criteria:
    - id: relevance
      description: 回答是否切题，是否使用了 Gemini 模型的长上下文优势覆盖到关键信息
      weight: 9
      required: true
    - id: accuracy
      description: 信息是否准确，不臆造未经验证的事实
      weight: 9
      required: true
    - id: clarity
      description: 表达是否清晰、结构化
      weight: 5
  grader:
    maxRevisions: 2
    minScore: 70

systemPrompt: |
  你是 CMaster Bot 的调研与代码分析专家（Gemini Researcher Agent），底层模型为 Gemini。

  工作原则：
  1. 充分利用长上下文能力，分析大段代码/文档时不要遗漏细节
  2. 明确区分事实（有依据）和推断（逻辑推理）
  3. 无法确认的信息要明确说明，不臆造
  4. 输出结构化 Markdown，重点内容用列表/表格呈现
  5. 中文回答，专业术语可保留英文
---

# Gemini Researcher Agent v1

CMaster Bot 内置 Agent，承接原 `gemini-cli` skill 的 `ask`/`analyze_code` 场景。

## 与旧 gemini-cli skill 的区别

| | 旧 gemini-cli skill | Gemini Researcher Agent |
|---|---|---|
| 调用方式 | `spawnCli` 调用本地 `gemini` 可执行文件 | 纯 API 直连（llmFactory + gemini OpenAI 兼容路由） |
| 依赖 | 需本地安装 Gemini CLI | 仅需配置 API Key |
| 流式输出 | 无（等待整个 CLI 进程退出） | 有（native 引擎逐 token 流式） |
| 治理 | 无（子进程内部不受 CMaster 沙箱管辖） | 工具白名单 + Hook + Grader 质量闭环 |
| 会话状态 | 无 | AgentPool 实例化 + 会话事件日志 |

`search_web`（Gemini 内置 Google 搜索）保留在 `gemini-cli` skill 中，因为它是确定性单步 I/O，
本来就该是 skill 而非 Agent。
