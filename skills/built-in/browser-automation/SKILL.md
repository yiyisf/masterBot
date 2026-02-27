---
name: browser-automation
version: 1.0.0
description: AI-RPA 浏览器自动化技能，基于 Playwright。支持截图、点击、键盘输入、文件上传、表格提取。跨平台：Windows 优先驱动 Edge（内置），macOS 优先驱动 Chrome。适合操作无 API 的内部遗留系统（ERP/OA/财务）。
author: CMaster Bot
dependencies:
  playwright: "^1.40.0"
---

# browser-automation

Playwright 驱动的浏览器 RPA 技能。用于自动化操作无 API 的内部 Web 系统。

⚠️ **依赖安装**：使用前需安装 Playwright：
```bash
npm install playwright
npx playwright install msedge chromium
```

### screenshot

截取当前浏览器页面截图。

**参数：**
- `url` (string, optional): 导航到此 URL 后截图（不传则截取当前页面）
- `selector` (string, optional): 只截取特定元素
- `fullPage` (boolean, optional): 是否截取完整页面，默认 false

### navigate

导航浏览器到指定 URL。

**参数：**
- `url` (string, required): 目标 URL
- `waitFor` (string, optional): 等待条件 `load`|`domcontentloaded`|`networkidle`，默认 `load`

### click

点击页面元素。

**参数：**
- `selector` (string, optional): CSS 选择器
- `text` (string, optional): 通过可见文本定位元素
- `coordinate` (object, optional): 像素坐标 `{x, y}`

### type

在输入框中输入文本。

**参数：**
- `selector` (string, required): 输入框 CSS 选择器
- `text` (string, required): 要输入的文本
- `clear` (boolean, optional): 输入前先清空，默认 true

### upload_file

上传文件到 input[type=file] 控件。自动处理 Windows/macOS 路径格式。

**参数：**
- `selector` (string, required): 文件输入控件 CSS 选择器
- `filePath` (string, required): 本地文件路径（支持 ~ 和相对路径）

### extract_table

提取页面中的表格数据为 JSON。

**参数：**
- `selector` (string, optional): 表格 CSS 选择器，默认取第一个 table
- `headers` (boolean, optional): 是否提取表头，默认 true

### close_browser

关闭浏览器实例，释放资源。

**参数：**（无）
