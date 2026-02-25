---
name: notification
version: 1.0.0
description: 发送通知到各种渠道，包括钉钉、飞书、企业微信和邮件。
author: CMaster Team
---

### send_dingtalk

通过钉钉机器人 Webhook 发送通知消息。

**Parameters:**
- `webhook` (string, required): 钉钉机器人 Webhook URL
- `message` (string, required): 消息内容（支持 Markdown）
- `title` (string): 消息标题（Markdown 类型消息需要），默认 "CMaster 通知"
- `type` (string): 消息类型，"text" 或 "markdown"，默认 "markdown"

### send_feishu

通过飞书机器人 Webhook 发送通知消息。

**Parameters:**
- `webhook` (string, required): 飞书机器人 Webhook URL
- `message` (string, required): 消息内容
- `title` (string): 消息标题，默认 "CMaster 通知"

### send_email

通过 SMTP 发送邮件通知。

**Parameters:**
- `to` (string, required): 收件人邮箱，多个用逗号分隔
- `subject` (string, required): 邮件主题
- `body` (string, required): 邮件正文（支持 HTML）
- `smtp_host` (string): SMTP 服务器地址，默认读取环境变量 SMTP_HOST
- `smtp_port` (number): SMTP 端口，默认 465
- `smtp_user` (string): SMTP 用户名，默认读取环境变量 SMTP_USER
- `smtp_pass` (string): SMTP 密码，默认读取环境变量 SMTP_PASS
- `from` (string): 发件人，默认读取环境变量 SMTP_FROM
