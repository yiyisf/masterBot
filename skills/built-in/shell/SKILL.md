---
name: shell
version: 1.0.0
description: Shell 命令执行技能，支持在系统终端运行命令
author: CMaster Team
---

# Shell Skill

执行系统 Shell 命令的技能，提供命令执行和输出获取能力。

> ⚠️ 注意：此技能可执行任意 Shell 命令，请谨慎使用。

## Actions

### execute
执行 Shell 命令并返回输出结果
- **参数**: `command` (string) - 要执行的命令
- **参数**: `cwd` (string) - 工作目录，可选
- **参数**: `timeout` (number) - 超时时间(毫秒)，可选，默认 30000
- **返回**: 命令输出结果

### execute_background
在后台执行命令（不等待完成）
- **参数**: `command` (string) - 要执行的命令
- **参数**: `cwd` (string) - 工作目录，可选
- **返回**: 进程 ID
