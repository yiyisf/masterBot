# 企业生产环境部署指南

## Docker Compose 部署

```bash
# 拉取代码
git clone https://github.com/YOUR_ORG/cmaster-bot.git
cd cmaster-bot

# 配置环境变量
cp .env.example .env
vim .env

# 启动
docker compose up -d

# 查看日志
docker compose logs -f cmaster
```

---

## Nginx 反向代理

```nginx
server {
    listen 443 ssl http2;
    server_name ai.your-company.com;

    ssl_certificate /etc/ssl/your-cert.pem;
    ssl_certificate_key /etc/ssl/your-key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;

        # SSE 必须禁用缓冲
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```

---

## 开启认证

编辑 `config/default.yaml`：

```yaml
auth:
  enabled: true
  mode: api-key      # 或 jwt
  apiKeys:
    - ${API_KEY_1}
    - ${API_KEY_2}
```

或在系统设置页面的"安全配置"中开启。

---

## 权限控制（企业多部门）

```yaml
permissions:
  enabled: true
  rules:
    - skills: ['database-connector']
      roles: ['admin', 'analyst']
    - skills: ['shell']
      roles: ['admin', 'developer']
    - skills: ['hr-portal', 'hr-api']
      roles: ['hr', 'admin']
```

用户角色通过 JWT payload 的 `role` 字段传入：

```json
{
  "sub": "user123",
  "role": "analyst",
  "exp": 1234567890
}
```

---

## 备份策略

```bash
# 备份 SQLite 数据库（建议每日）
cp data/cmaster.db data/backups/cmaster-$(date +%Y%m%d).db

# 或使用 cron
0 2 * * * cp /app/data/cmaster.db /backup/cmaster-$(date +\%Y\%m\%d).db
```

数据库文件位于 `data/cmaster.db`（Docker volume 映射到宿主机 `./data/`）。

---

## 监控

```bash
# 健康检查端点
curl http://localhost:3000/health
# → {"status":"ok","timestamp":"2026-01-01T00:00:00.000Z"}

# 系统状态
curl http://localhost:3000/api/status
```

集成到 Prometheus/Datadog 等监控系统时，可定期采集 `/api/status` 的响应指标。

---

## 扩展配置

```yaml
# config/default.yaml
agent:
  maxIterations: 15      # 复杂任务可适当调大
  maxContextTokens: 200000  # 根据模型上下文窗口调整

memory:
  shortTerm:
    maxMessages: 100
    maxSessions: 500
    ttlSeconds: 7200
```

---

## IM 集成配置（Phase 20）

### 飞书集成

1. 在[飞书开放平台](https://open.feishu.cn/)创建企业自建应用
2. 获取 App ID、App Secret、Verification Token、Encrypt Key
3. 配置环境变量：

```env
FEISHU_APP_ID=cli_xxxx
FEISHU_APP_SECRET=your_app_secret
FEISHU_VERIFY_TOKEN=your_verify_token
FEISHU_ENCRYPT_KEY=your_encrypt_key
```

4. 在 `config/default.yaml` 中启用 IM：

```yaml
im:
  enabled: true
  platform: feishu
  feishu:
    appId:             ${FEISHU_APP_ID}
    appSecret:         ${FEISHU_APP_SECRET}
    verificationToken: ${FEISHU_VERIFY_TOKEN}
    encryptKey:        ${FEISHU_ENCRYPT_KEY}
  defaultRole: user      # 新 IM 用户的默认角色
  hitlTimeoutMinutes: 30 # HitL 审批超时时间（分钟）
```

5. 在飞书开放平台配置事件订阅 Webhook URL：`https://your-domain.com/api/im/inbound`
6. 在 Settings 页面 → IM 集成 → 管理用户白名单（启用/禁用 IM 用户）

### 钉钉集成

钉钉适配器待接入，配置结构类似飞书，`platform: dingtalk`，支持 HMAC 签名验证。

---

## 审计日志配置（Phase 20）

```yaml
# config/default.yaml
audit:
  enabled: true
  retentionDays: 90    # 审计记录保留天数（超期自动清理）
```

### 审计日志表

| 表名 | 内容 |
|------|------|
| `execution_records` | 所有 Agent 执行记录（输入/输出/耗时/状态） |
| `audit_approvals` | HitL 审批记录（工具名/审批人/结论/理由） |
| `scheduled_task_runs` | 定时任务执行历史 |

### 访问审计数据

```bash
# REST API 导出（CSV）
curl http://localhost:3000/api/audit/export?format=csv \
  -o audit_$(date +%Y%m%d).csv

# Web UI
# 访问 /audit → 执行记录 / 审批记录 / 合规报告
```

### 数据保留策略建议

| 场景 | `retentionDays` | 说明 |
|------|----------------|------|
| 开发测试 | 7 | 减少磁盘占用 |
| 一般企业 | 90 | 满足常规审计 |
| 金融/医疗 | 365+ | 监管合规要求 |
