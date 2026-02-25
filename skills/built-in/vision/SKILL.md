---
name: vision
version: 1.0.0
description: 图像理解技能，使用 LLM 的视觉能力分析图像、执行 OCR 和描述图表。
author: CMaster Team
---

### analyze_image

分析图像内容，回答关于图像的问题。

**Parameters:**
- `image_path` (string): 本地图像文件路径（与 image_url 二选一）
- `image_url` (string): 图像 URL（与 image_path 二选一）
- `question` (string, required): 关于图像的问题或分析指令

### ocr

对图像执行文字识别（OCR），提取图像中的所有文本。

**Parameters:**
- `image_path` (string): 本地图像文件路径（与 image_url 二选一）
- `image_url` (string): 图像 URL（与 image_path 二选一）

### describe_diagram

分析并描述技术图表（流程图、架构图、ER 图等）的内容和结构。

**Parameters:**
- `image_path` (string): 本地图像文件路径（与 image_url 二选一）
- `image_url` (string): 图像 URL（与 image_path 二选一）
- `diagram_type` (string): 图表类型提示，如 "flowchart"、"architecture"、"ER diagram"，帮助提高分析精度
