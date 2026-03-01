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
