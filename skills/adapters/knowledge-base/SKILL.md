---
name: knowledge-base
version: 1.0.0
description: 知识库适配器（IKnowledgeBase 接口实现）。通过 HTTP API 连接公司内部 Wiki/知识管理系统，支持文档读取、增量同步、内容回写。底层通过 http-client 技能调用内部 API，无需改动 Agent 核心代码。
author: CMaster Bot
---

# knowledge-base

内部知识库系统适配器。实现 IKnowledgeBase 接口，供知识自动同步（knowledge-sync）和 Agent 使用。

## 配置

在 `connectors/knowledge-base.yaml` 中配置内部知识库的 API 地址和认证信息：

```yaml
name: knowledge-base
type: http
baseUrl: ${KB_BASE_URL:http://internal-wiki.company.com/api}
auth:
  type: bearer
  key: ${KB_API_TOKEN}
```

### list_updated_pages

获取指定时间之后更新的文档页面列表。用于增量同步——只处理有变化的内容。

**参数：**
- `since` (string, required): ISO 8601 时间戳，获取此时间之后更新的页面
- `limit` (number, optional): 最大返回数量，默认 50
- `space` (string, optional): 限定 Wiki 空间/命名空间

### get_page_content

读取单个文档页面的完整内容（Markdown 或纯文本格式）。

**参数：**
- `pageId` (string, required): 页面 ID
- `format` (string, optional): 内容格式 `markdown`|`text`，默认 `markdown`

### write_page

将 AI 生成的内容回写到知识库（如会议纪要、自动生成的技术文档）。

**参数：**
- `pageId` (string, optional): 已有页面 ID（更新模式）
- `parentId` (string, optional): 父页面 ID（新建模式）
- `title` (string, required): 页面标题
- `content` (string, required): 页面内容（Markdown 格式）
- `space` (string, optional): 目标 Wiki 空间

### search_pages

在知识库中全文搜索文档。

**参数：**
- `query` (string, required): 搜索关键词
- `limit` (number, optional): 最大返回数量，默认 10
- `space` (string, optional): 限定搜索空间
