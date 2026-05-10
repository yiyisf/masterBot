# Langfuse Self-Hosted 部署指南

本文档说明如何在本地启动 Langfuse 可观测性栈，查看 masterBot 的 OTel traces。

---

## 快速启动

```bash
# 1. 进入 observability 配置目录
cd deploy/observability

# 2. 复制并填写环境变量
cp .env.example .env
# 编辑 .env，至少修改 LANGFUSE_SECRET 和密码

# 3. 启动所有服务（后台运行）
docker-compose up -d

# 4. 等待约 30 秒后访问 Langfuse UI
open http://localhost:3001
```

### 初始账号

- **Email**：`admin@masterbot.local`（或 `.env` 中的 `LANGFUSE_ADMIN_EMAIL`）
- **Password**：`admin123`（或 `LANGFUSE_ADMIN_PASSWORD`）

---

## masterBot 侧配置

在项目根目录 `.env` 中添加：

```env
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

然后启动 masterBot：

```bash
npm run dev
```

---

## 查看 Traces

1. 打开 `http://localhost:3001`，登录
2. 进入 **Traces** 页面
3. 向 masterBot 发送一条消息（如 `curl -X POST http://localhost:3000/api/chat -d '{"message":"hello"}'`）
4. 刷新 Traces 页面，应看到新 trace：
   - Root span: `agent.run` — 带 `gen_ai.system`、`gen_ai.request.model` 等属性
   - Child spans: `test_tool` 或实际工具名

---

## OTel Attributes 检查清单

| Attribute | 位置 | 说明 |
|-----------|------|------|
| `gen_ai.system` | agent.run span | LLM provider（如 `anthropic`）|
| `gen_ai.request.model` | agent.run span | 使用的模型 |
| `gen_ai.operation.name` | agent.run span | 固定值 `agent_loop` |
| `gen_ai.usage.input_tokens` | agent.run span | 输入 token 数 |
| `gen_ai.usage.output_tokens` | agent.run span | 输出 token 数 |
| `gen_ai.usage.cache_read_input_tokens` | agent.run span | cache read token |
| `agent.session_id` | agent.run span | 会话 ID |
| `tool.name` | tool.* spans | 工具名称 |

---

## 停止服务

```bash
docker-compose -f deploy/observability/docker-compose.yml down
# 清除数据卷（重置数据）：
docker-compose -f deploy/observability/docker-compose.yml down -v
```

---

## 故障排查

**Q: Langfuse UI 打不开**
- 检查端口 3001 是否被占用：`lsof -i :3001`
- 查看容器日志：`docker-compose logs langfuse-web`

**Q: Traces 中没有数据**
- 确认 `.env` 中 `OTEL_ENABLED=true`
- 确认 OTel Collector 容器正常：`docker-compose logs otel-collector`
- 确认端口 4318 可访问：`curl http://localhost:4318/`

**Q: 连接数据库失败**
- `docker-compose logs langfuse-db`
- 等待 db healthcheck 通过后再启动 web：`docker-compose up -d langfuse-db && sleep 10 && docker-compose up -d`
