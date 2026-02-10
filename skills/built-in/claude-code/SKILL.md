---
name: claude-code
version: 1.0.0
description: 调用本地 Claude Code CLI 执行编码任务（代码分析、审查、生成等）
author: CMaster Team
---

# Claude Code Skill

通过本地安装的 Claude Code CLI 执行编码任务，支持代码分析、审查和会话续接。

> 需要本地已安装 Claude Code CLI

## Actions

### ask
向 Claude Code 提问或执行编码任务
- **参数**: `prompt` (string) - 提示词
- **参数**: `cwd` (string) - 工作目录，可选
- **参数**: `allowed_tools` (string) - 允许的工具，可选，如 "Read,Edit,Bash"
- **参数**: `system_prompt` (string) - 附加系统提示，可选

### code_review
代码审查
- **参数**: `target` (string) - 要审查的文件或 diff
- **参数**: `cwd` (string) - 项目目录，可选
- **参数**: `focus` (string) - 审查重点，可选，如 security/performance

### continue_session
继续上一次 Claude Code 会话
- **参数**: `prompt` (string) - 后续提示
- **参数**: `session_id` (string) - 会话 ID，可选，不填则继续最近会话
