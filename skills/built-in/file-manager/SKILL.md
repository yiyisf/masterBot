---
name: file-manager
version: 1.0.0
description: 文件管理技能，支持文件读写、目录操作和搜索
author: CMaster Team
dependencies:
  - glob: ^11.0.0
---

# File Manager Skill

文件系统操作技能，提供文件和目录的基础操作能力。

## Actions

### read_file
读取文件内容
- **参数**: `path` (string) - 文件路径
- **参数**: `encoding` (string) - 编码格式，可选，默认 utf-8
- **返回**: 文件内容字符串

### write_file
写入内容到文件
- **参数**: `path` (string) - 文件路径
- **参数**: `content` (string) - 文件内容
- **参数**: `append` (boolean) - 是否追加模式，可选，默认 false
- **返回**: 写入成功状态

### list_directory
列出目录内容
- **参数**: `path` (string) - 目录路径
- **参数**: `recursive` (boolean) - 是否递归，可选，默认 false
- **返回**: 文件和目录列表

### search_files
搜索文件
- **参数**: `pattern` (string) - glob 匹配模式
- **参数**: `cwd` (string) - 搜索根目录，可选
- **返回**: 匹配的文件路径列表

### delete_file
删除文件
- **参数**: `path` (string) - 文件路径
- **返回**: 删除成功状态

### copy_file
复制文件
- **参数**: `source` (string) - 源文件路径
- **参数**: `destination` (string) - 目标文件路径
- **返回**: 复制成功状态
