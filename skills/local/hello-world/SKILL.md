---
name: hello-world
version: 1.0.0
description: 一个演示本地技能开发模式的示例技能，包含问候和计算功能。
author: CMaster Team
---

### greet

向用户发送个性化问候语。

**Parameters:**
- `name` (string, required): 要问候的人名
- `language` (string): 语言选项，支持 "zh"（中文）或 "en"（英文），默认 "zh"

### calculate

执行基础数学计算。

**Parameters:**
- `expression` (string, required): 数学表达式，如 "2 + 3 * 4"，支持 +、-、*、/ 运算
