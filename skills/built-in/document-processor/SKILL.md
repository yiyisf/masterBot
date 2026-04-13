---
name: document-processor
version: 1.0.0
description: 处理各种文档格式，包括 PDF、Word、Excel 文件的读取、转换和写入。
author: CMaster Team
dependencies:
  pdf-parse: "^1.1.0"
  mammoth: "^1.5.0"
  xlsx: "^0.18.5"
---

### read_pdf

读取 PDF 文件内容并提取文本，支持按页码范围分批读取，避免超大 PDF 导致上下文溢出。

**Parameters:**
- `path` (string, required): PDF 文件的本地路径
- `start_page` (number): 起始页码（从 1 开始），默认 1
- `end_page` (number): 结束页码（含），默认由 max_pages 决定
- `max_pages` (number): 本次最多读取页数，默认 50。适用于超大 PDF 分批处理

### read_docx

读取 Word (.docx) 文件内容并提取纯文本或 Markdown。

**Parameters:**
- `path` (string, required): DOCX 文件的本地路径
- `format` (string): 输出格式，"text" 或 "markdown"，默认 "markdown"

### read_xlsx

读取 Excel (.xlsx/.xls) 文件内容并转换为表格。

**Parameters:**
- `path` (string, required): Excel 文件的本地路径
- `sheet` (string): 要读取的工作表名称，默认读取第一个工作表
- `max_rows` (number): 最大读取行数，默认 100

### write_xlsx

将数据写入 Excel 文件。

**Parameters:**
- `path` (string, required): 输出 Excel 文件路径
- `data` (array, required): 数据行数组，每行是一个对象
- `sheet` (string): 工作表名称，默认 "Sheet1"

### convert_to_markdown

将文档文件（PDF/DOCX）转换为 Markdown 格式。

**Parameters:**
- `path` (string, required): 源文件路径（支持 .pdf、.docx）
- `output_path` (string): 输出 Markdown 文件路径，不指定则返回内容字符串
- `start_page` (number): PDF 起始页码，默认 1
- `end_page` (number): PDF 结束页码
- `max_pages` (number): PDF 最多读取页数，默认 50
