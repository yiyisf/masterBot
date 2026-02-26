---
name: database-connector
version: 1.0.0
description: 安全只读数据库连接器，支持 NL2SQL 场景。支持 MySQL、PostgreSQL、SQLite 等数据源，内置 SQL 安全沙箱（仅允许 SELECT），自动 mask 敏感字段。
author: CMaster Bot
---

# database-connector

企业数据仓库连接技能，为 NL2Insight 场景提供只读数据访问能力。

### list_tables

列出指定数据源中的所有数据表。

**参数：**
- `datasource` (string, required): 数据源名称（对应 connectors/ 目录下的配置文件名）

### get_schema

获取指定表的完整 Schema（字段名、类型、注释）。

**参数：**
- `datasource` (string, required): 数据源名称
- `table` (string, required): 表名
- `tables` (array, optional): 批量获取多个表 Schema，传入表名数组

### execute_query

执行只读 SQL 查询（仅允许 SELECT 语句）。内置安全沙箱：阻止 INSERT/UPDATE/DELETE/DROP，限制返回行数，自动 mask 手机号/身份证/薪资等敏感字段。

**参数：**
- `datasource` (string, required): 数据源名称
- `sql` (string, required): SQL 查询语句（必须是 SELECT）
- `limit` (number, optional): 最大返回行数，默认 1000，最大 10000
- `format` (string, optional): 输出格式 `table`|`json`|`csv`，默认 `json`
