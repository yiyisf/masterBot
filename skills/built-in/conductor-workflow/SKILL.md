---
name: conductor-workflow
version: 1.0.0
description: 基于自然语言生成、分析和修改 Conductor OSS v3.21.20 标准工作流定义 JSON，用于企业编排引擎
author: CMaster Bot
---

## Actions

### generate_workflow
根据自然语言描述的业务逻辑，生成符合 Conductor OSS v3.21.20 规范的 WorkflowDef JSON。支持所有标准任务类型（SIMPLE, HTTP, SWITCH, FORK_JOIN, DO_WHILE, SUB_WORKFLOW 等），复杂流程自动拆解为多个子工作流。

- `description` (string, required) — 业务流程的自然语言描述
- `name` (string, 可选) — 工作流名称，默认由 AI 根据描述自动生成

### analyze_workflow
分析已有的 Conductor 工作流 JSON 定义，输出结构解读、任务依赖关系、潜在问题和优化建议。

- `workflow_json` (string, required) — 要分析的 WorkflowDef JSON 字符串

### update_workflow
根据自然语言指令修改已有的 Conductor 工作流定义，返回更新后的完整 WorkflowDef JSON。

- `workflow_json` (string, required) — 现有的 WorkflowDef JSON 字符串
- `instruction` (string, required) — 修改指令的自然语言描述
