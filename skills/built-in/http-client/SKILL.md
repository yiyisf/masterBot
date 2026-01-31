---
name: http-client
version: 1.0.0
description: HTTP 请求技能，支持发送各种 HTTP 请求
author: CMaster Team
---

# HTTP Client Skill

HTTP 请求技能，用于与外部 API 和 Web 服务交互。

## Actions

### request
发送 HTTP 请求
- **参数**: `url` (string) - 请求 URL
- **参数**: `method` (string) - HTTP 方法，可选，默认 GET
- **参数**: `headers` (object) - 请求头，可选
- **参数**: `body` (string) - 请求体，可选
- **参数**: `timeout` (number) - 超时时间(毫秒)，可选
- **返回**: 响应对象 { status, headers, body }

### get
发送 GET 请求
- **参数**: `url` (string) - 请求 URL
- **参数**: `headers` (object) - 请求头，可选
- **返回**: 响应内容

### post
发送 POST 请求
- **参数**: `url` (string) - 请求 URL
- **参数**: `data` (object) - 请求数据，将序列化为 JSON
- **参数**: `headers` (object) - 请求头，可选
- **返回**: 响应内容
