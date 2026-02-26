---
name: notification-hub
version: 1.0.0
description: 通知中枢适配器（INotificationHub 接口实现）。统一接入公司内部通知渠道（企业微信/钉钉/飞书/内部 IM），支持消息发送、群组创建。底层通过 http-client 技能调用内部通知 API，Runbook 引擎通过此技能发送故障通知。
author: CMaster Bot
---

# notification-hub

内部通知系统统一适配器。Runbook 和 Agent 均可调用此技能发送通知，无需关心底层实现。

## 配置

在 `connectors/notification-hub.yaml` 中配置内部通知 API：

```yaml
name: notification-hub
type: http
baseUrl: ${NOTIFY_BASE_URL:http://internal-notify.company.com/api}
auth:
  type: bearer
  key: ${NOTIFY_API_TOKEN}
defaultChannel: ops-alerts
```

### send

发送消息到指定渠道或人员。支持 Markdown 格式。

**参数：**
- `to` (string, required): 接收方，可以是用户 ID、群组 ID 或渠道名称
- `message` (string, required): 消息内容（支持 Markdown）
- `title` (string, optional): 消息标题
- `level` (string, optional): 消息级别 `info`|`warn`|`error`|`critical`，默认 `info`
- `template` (string, optional): 使用预定义模板 `incident_resolved`|`incident_triggered`|`daily_report`

### create_group

在内部 IM 系统中创建临时群组（如故障响应群）。

**参数：**
- `name` (string, required): 群组名称
- `members` (array, required): 成员用户 ID 列表
- `description` (string, optional): 群组描述

### broadcast

向多个渠道/人员批量发送消息。

**参数：**
- `targets` (array, required): 接收方列表（用户 ID 或渠道名称）
- `message` (string, required): 消息内容
- `level` (string, optional): 消息级别
