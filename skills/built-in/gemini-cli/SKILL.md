---
name: gemini-cli
version: 1.0.0
description: 调用本地 Gemini CLI 执行 AI 任务（代码分析、文件处理、搜索等）
author: CMaster Team
---

# Gemini CLI Skill

通过本地安装的 Gemini CLI 执行 AI 任务，支持代码分析、内容生成和实时搜索。

> ⚠️ **Deprecated（P1-2）**：`ask`/`analyze_code` 依赖本地 Gemini CLI 安装、无流式、无质量评分。
> **优先使用 `delegate_to_agent` 委托给 `gemini-researcher` Managed Agent** —— 纯 API 直连
> （无需本地安装 CLI），支持流式输出、工具白名单治理、Grader 质量闭环。`search_web` 是确定性
> 单步 I/O，继续作为 skill 保留。
>
> 需要本地已安装 Gemini CLI (`npm install -g @anthropic-ai/gemini-cli` 或通过官方渠道)
>
> ⚠️ 治理边界：与 claude-code skill 一致，子进程内部的工具调用不受 CMaster 沙箱/Hook 管辖，
> 因此 `cwd` 必须位于项目根目录内，拒绝越权路径。

## Actions

### ask
向 Gemini 提问或分析内容
- **参数**: `prompt` (string) - 提示词
- **参数**: `cwd` (string) - 工作目录，可选，须在项目根目录内
- **参数**: `model` (string) - 模型名，可选，默认 gemini-2.5-flash
- **参数**: `files` (string) - 要包含的文件/目录路径，可选

### analyze_code
分析代码仓库或文件
- **参数**: `prompt` (string) - 分析指令
- **参数**: `cwd` (string) - 项目目录，可选，须在项目根目录内
- **参数**: `include_directories` (string) - 包含的目录，可选

### search_web
使用 Gemini 内置 Google 搜索获取实时信息
- **参数**: `query` (string) - 搜索查询
