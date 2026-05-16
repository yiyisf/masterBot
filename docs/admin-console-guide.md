# Admin Console 使用手册

> 适用人群：IT 管理员、安全团队、财务团队

## 访问方式

访问 `http://<your-server>/admin`，输入 Admin API Key 登录。

### 配置 Admin API Key

在 `.env` 文件中设置：

```env
ADMIN_API_KEY=your-secure-admin-key-here
```

或在 `config/default.yaml` 中修改：

```yaml
admin:
  apiKeys:
    - your-secure-admin-key-here
```

支持配置多个 key（多人管理员共用）。Admin Key 通过 `X-Admin-Key` HTTP header 传递，与普通用户 API Key 完全隔离。

---

## 模块说明

### 1. 概览（/admin）

展示系统核心指标：

| 指标 | 说明 |
|------|------|
| 今日 Agent 调用量 | 当天执行记录数量 |
| 待审批技能数 | status=pending 的技能审批数 |
| 待审批 HitL | 未决定的人工审批请求 |
| 今日 Token 用量 | token_usage 表当日累计 |

底部展示最近 5 条管理操作记录。

---

### 2. 技能审批（/admin/skills/review）

所有通过 `skill_generate` 工具自动生成的技能，初始状态为 `pending`，须经管理员审批后方可使用。

#### 操作流程

1. 在列表中找到 `pending` 状态的技能
2. 填写审批备注（可选）
3. 点击 **批准** 或 **拒绝**

#### 状态说明

| 状态 | 含义 |
|------|------|
| `pending` | 待审批，技能暂不可用 |
| `approved` | 已批准，技能可正常使用 |
| `rejected` | 已拒绝，技能不可使用 |

所有审批操作均写入 `admin_audit_log`，不可篡改。

---

### 3. RBAC 配置（/admin/rbac）

细粒度权限控制：限制特定用户/角色使用特定技能。

#### 规则格式

```
Subject → Scope : Effect
```

| 字段 | 说明 | 示例 |
|------|------|------|
| Subject | 用户/角色标识 | `user:alice`, `role:dev`, `*`（所有人）|
| Scope | 技能名或分类 | `shell`, `database-connector`, `*`（所有技能）|
| Effect | 效果 | `allow`（允许）, `deny`（拒绝）|

#### 示例规则

```
user:alice  →  shell         : deny     # 禁止 alice 使用 shell
role:hr     →  hr-portal     : allow    # 允许 HR 角色使用 hr-portal
*           →  rm-rf-skill   : deny     # 全员禁止使用危险技能
```

> ⚠️ 当前 RBAC 规则存储在数据库，服务器重读策略需重启或调用 `/api/config/reload`（待实现）。

---

### 4. 审计查询（/admin/audit）

查询所有 Agent 执行记录、Workflow 运行、Webhook 触发等。

#### 过滤条件

- **User ID**：按用户筛选
- **Session ID**：按会话筛选
- **类型**：agent / workflow / webhook / scheduled
- **状态**：success / failed / running
- **时间范围**：开始/结束时间

#### 导出 CSV

点击右上角「导出 CSV」按钮，下载当前过滤条件的完整记录（最多 10,000 条）。

> ⚠️ 审计日志只读，任何修改操作将被拒绝。审计日志保留 90 天（可在 `config/default.yaml` 中的 `audit.retentionDays` 调整）。

---

### 5. 成本看板（/admin/cost）

按日/模型/会话维度统计 Token 用量。

| 视图 | 说明 |
|------|------|
| 每日 Token 用量 | 条形图展示近 N 天每日消耗 |
| 按模型分布 | 各模型 Token 用量和调用次数排名 |
| Top 10 会话 | 按 Token 消耗排名的前 10 个会话 |

支持切换 7 天 / 30 天 / 90 天视图。

---

## 安全注意事项

1. **Admin Key 请勿泄漏**：建议通过环境变量注入，不要硬编码在代码中
2. **定期轮换 Key**：更换 key 后更新 `config/default.yaml` 并重启服务
3. **所有管理操作均有审计**：`admin_audit_log` 表记录谁、何时、做了什么
4. **审计日志不可修改**：admin 操作记录同样受保护

---

## API 参考

所有 Admin API 均需携带 `X-Admin-Key: <your-key>` header。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/stats` | 概览统计 |
| GET | `/api/admin/skills/review` | 技能审批列表（?status=pending） |
| POST | `/api/admin/skills/review/:name` | 审批技能（body: {status, notes}）|
| GET | `/api/admin/rbac` | RBAC 规则列表 |
| POST | `/api/admin/rbac` | 创建规则（body: {subject, scope, effect}）|
| DELETE | `/api/admin/rbac/:id` | 删除规则 |
| GET | `/api/admin/audit` | 审计查询（支持多条件过滤和分页）|
| GET | `/api/admin/cost` | 成本数据（?days=30）|
| GET | `/api/admin/log` | 管理操作日志 |
