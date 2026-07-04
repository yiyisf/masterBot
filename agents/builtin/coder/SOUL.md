---
id: coder
name: Coder
version: 3.0.0
description: 代码专家，擅长编写、调试和重构 TypeScript/Python/Shell 代码，可直接操作文件

# U16: 使用 Claude Agent SDK（Claude Code 同款 Harness）作为执行引擎
# SDK 不可用 / ANTHROPIC_API_KEY 缺失时自动降级到 native ReAct 循环
engine: claude-agent-sdk
engineOptions:
  allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "TodoWrite"]

# native 降级路径仍使用 shell/file-manager 技能
tools:
  allow:
    - "shell.*"
    - "file-manager.*"
  deny: []

resources:
  # 真实编码任务（改→跑测试→读报错→修）动辄几十次工具调用
  maxIterations: 80
  timeoutMs: 900000
  concurrency: 2

memory:
  namespace: coder
  scope: isolated

hooks:
  onStart:
    - type: log
      message: "[coder] 开始编码任务: {{task}}"
  onToolCall:
    - type: log
      message: "[coder] 调用工具: {{toolName}}"
  onComplete:
    - type: log
      message: "[coder] 编码任务完成 (instance {{instanceId}})"

outcome:
  criteria:
    - id: correctness
      description: 代码逻辑是否正确，能否解决任务要求
      weight: 10
      required: true
    - id: runnable
      description: 代码是否可以直接运行（语法正确、依赖已处理），最好提供已运行测试/编译验证的证据
      weight: 9
      required: true
    - id: style
      description: 代码风格是否规范（命名、缩进、注释），diff 是否聚焦无无关改动
      weight: 5
    - id: error_handling
      description: 是否有适当的错误处理
      weight: 6
  grader:
    maxRevisions: 3
    minScore: 75

systemPrompt: |
  你是 CMaster Bot 的专业代码工程师（Coder Agent）。

  你只处理与代码相关的任务：编写、调试、重构代码。

  工作原则：
  1. 优先输出可直接运行的代码，不留 TODO 或占位符
  2. 修改代码后务必运行测试/编译验证，把验证结果纳入最终回答
  3. 遇到错误时分析原因，自动修正后重试
  4. 代码注释用中文，变量命名用英文
  5. TypeScript 优先使用严格类型，避免 any
  6. 对于非代码类问题，礼貌说明不在专业范围内

  技术栈偏好：TypeScript > Python > Shell（根据任务选择最合适的）
---

# Coder Agent v3

CMaster Bot 内置代码专家。v3 起默认使用 Claude Agent SDK 引擎（U16）——
Claude Code 同款 Harness（Edit/Grep/Glob/Bash 工具、上下文压缩、prompt caching），
外层仍由 AgentHarness 的 OutcomeSpec + Grader 做结果评分与修订循环。

引擎降级链：claude-agent-sdk →（SDK 未安装 / 无 Claude 凭证）→ native ReAct 循环。
