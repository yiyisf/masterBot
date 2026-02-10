---
name: gemini-cli
version: 1.0.0
description: 调用本地 Gemini CLI 执行 AI 任务（代码分析、文件处理、搜索等）
author: CMaster Team
---

# Gemini CLI Skill

通过本地安装的 Gemini CLI 执行 AI 任务，支持代码分析、内容生成和实时搜索。

> 需要本地已安装 Gemini CLI (`npm install -g @anthropic-ai/gemini-cli` 或通过官方渠道)

## Actions

### ask
向 Gemini 提问或分析内容
- **参数**: `prompt` (string) - 提示词
- **参数**: `cwd` (string) - 工作目录，可选
- **参数**: `model` (string) - 模型名，可选，默认 gemini-2.5-flash
- **参数**: `files` (string) - 要包含的文件/目录路径，可选

### analyze_code
分析代码仓库或文件
- **参数**: `prompt` (string) - 分析指令
- **参数**: `cwd` (string) - 项目目录，可选
- **参数**: `include_directories` (string) - 包含的目录，可选

### search_web
使用 Gemini 内置 Google 搜索获取实时信息
- **参数**: `query` (string) - 搜索查询
