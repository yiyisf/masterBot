---
name: claude-code
version: 1.0.0
description: 调用本地 Claude Code CLI 执行编码任务（代码分析、审查、生成等）
author: CMaster Team
---

# Claude Code Skill

通过本地安装的 Claude Code CLI 执行编码任务，支持代码分析、审查和会话续接。

> ⚠️ **Deprecated（P1-2）**：本 skill 只保留只读分析场景作为过渡兼容。
> **需要完整编码能力（写文件、跑命令、多步迭代）请优先使用 `delegate_to_agent` 委托给 `coder` Managed Agent** ——
> 其 `claude-agent-sdk` 引擎具备 `canUseTool` 治理、流式输出、Grader 质量闭环，能力是本 skill 的超集。
>
> 需要本地已安装 Claude Code CLI
>
> ⚠️ 治理边界：子进程内部的工具调用不受 CMaster 沙箱/Hook 管辖，因此本 skill 强制：
> - `allowed_tools` 会被裁剪到只读上限 `Read,Grep,Glob`，无法通过本 skill 获得 Write/Edit/Bash；
> - `cwd` 必须位于项目根目录内，拒绝越权路径；
> - `continue_session` 必须显式传入 `session_id`（不再支持隐式 `--continue` 续接全局最近会话，避免多会话并发串扰）。

## Actions

### ask
向 Claude Code 提问或执行只读分析任务
- **参数**: `prompt` (string) - 提示词
- **参数**: `cwd` (string) - 工作目录，可选，须在项目根目录内
- **参数**: `allowed_tools` (string) - 允许的工具，可选，会被裁剪到只读上限 "Read,Grep,Glob"
- **参数**: `system_prompt` (string) - 附加系统提示，可选

### code_review
代码审查
- **参数**: `target` (string) - 要审查的文件或 diff
- **参数**: `cwd` (string) - 项目目录，可选，须在项目根目录内
- **参数**: `focus` (string) - 审查重点，可选，如 security/performance

### continue_session
继续指定的 Claude Code 会话
- **参数**: `prompt` (string) - 后续提示
- **参数**: `session_id` (string, required) - 会话 ID，必填，防止跨会话串扰
