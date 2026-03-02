---
name: im-bot
version: 1.0.0
description: IM 机器人主动发送消息技能，支持向飞书等 IM 平台主动推送文本消息和通知卡片
author: CMaster
---

# im-bot

## 功能说明

允许 Agent 主动通过 IM 渠道向指定用户或群组发送消息，适用于异步任务完成通知、告警推送等场景。

## 动作

### send_message

向指定 IM 会话发送纯文本消息。

**参数：**
- `platform` (string, required): IM 平台，如 `feishu`
- `conversationId` (string, required): 目标会话 ID（飞书 chat_id）
- `userId` (string, required): 接收方用户 ID
- `text` (string, required): 消息内容

**示例：**
```json
{
  "platform": "feishu",
  "conversationId": "oc_xxx",
  "userId": "ou_xxx",
  "text": "您的报表已生成完毕，请查收。"
}
```

### send_card

向指定 IM 会话发送信息卡片（标题 + 内容）。

**参数：**
- `platform` (string, required): IM 平台
- `conversationId` (string, required): 目标会话 ID
- `userId` (string, required): 接收方用户 ID
- `title` (string, required): 卡片标题
- `content` (string, required): 卡片正文（支持 Markdown）
- `template` (string, optional): 卡片颜色主题，默认 `blue`，可选 `orange`/`red`/`green`

### get_session_info

查询当前 IM 会话映射信息（IM 对话 ID → CMaster Session ID）。

**参数：**
- `platform` (string, optional): 过滤平台
