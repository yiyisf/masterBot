# CMaster Bot - 架构评审与未来规划

## 当前架构评审

### 技术栈总览

| 层级 | 技术 | 评价 |
|------|------|------|
| 后端框架 | Fastify 5 + TypeScript | 性能优于 Express，插件生态丰富 |
| 前端框架 | Next.js 16 + React 19 | 前沿但稳定，静态导出模式部署简单 |
| 聊天 UI | @assistant-ui/react | 专业级聊天组件库 |
| 数据库 | node:sqlite (DatabaseSync) | 轻量适合本地，但同步 API 有阻塞风险 |
| LLM 集成 | OpenAI + Anthropic SDK | 双提供商 + 工厂模式，扩展性好 |
| Agent 模式 | ReAct + Think-Plan-Act | 业界主流，plan_task 设计不错 |
| 技能系统 | SKILL.md + 动态导入 | 声明式协议清晰，三级目录合理 |

### 架构优势

1. **流式优先设计** — async generator 贯穿全链路
2. **技能协议** — SKILL.md 声明式 + 热重载
3. **多源技能注册** — SkillSource 抽象预留 MCP/OpenAPI
4. **LLM 热切换** — lambda getter + 工厂缓存
5. **Think-Plan-Act 双循环** — plan_task 结构化推理
6. **前端 ReAct 可视化** — 四阶段透明展示

### 已解决的问题 (Phase 5)

| 问题 | 解决方案 |
|------|----------|
| 无上下文窗口管理 | `ContextManager` 滑动窗口 + LLM 摘要压缩 |
| SessionMemory 无 LRU 淘汰 | `SessionMemoryManager` LRU 淘汰 + 定时清理 |
| 工具执行无超时 | `executeWithTimeout` 60 秒超时保护 |
| 依赖残留 | 移除 sql.js, @types/better-sqlite3, bullmq |
| 无测试 | 28 个测试覆盖核心模块 |

### 待解决问题

#### P0
- **DatabaseSync 同步阻塞** — 建议 Worker Thread 包装
- **无认证/鉴权** — Gateway 预留中间件插槽

#### P1
- Shell 技能无沙箱
- 错误处理不够一致

#### P2
- 前端无全局状态管理
- 无可观测性 (metrics/tracing)

---

## 未来路线图

### Phase 6: 能力扩展

- **6.1 MCP 协议完整实现** — McpSkillSource 接入社区工具
- **6.2 长期记忆** — 本地向量数据库 (vectra/lancedb)
- **6.3 任务 DAG** — 有向无环图任务编排
- **6.4 RAG 知识库** — 文档上传 + 分块嵌入 + 检索

### Phase 7: 生产化

- **7.1 安全加固** — JWT/API Key + Shell 沙箱 + Zod 校验
- **7.2 插件市场** — 技能包格式 + 在线仓库
- **7.3 可观测性** — trace_id 链路追踪 + Dashboard 指标
- **7.4 本地模型** — Ollama 接入

### 实施优先级

```
立即做（已完成）  → 上下文窗口管理 ✓ | 基础测试 ✓ | 清理依赖 ✓ | 内存 LRU ✓
短期做（Phase 6） → MCP 完整实现 > 长期记忆 > 任务 DAG
中期做           → RAG 知识库 > 多模态增强
长期做（Phase 7） → 安全加固 > 插件市场 > 可观测性 > 本地模型
```

### 保留的设计决策

- Fastify + Next.js 静态导出
- SKILL.md 协议
- async generator 流式架构
- @assistant-ui/react

### 建议调整方向

- **不建议** 引入 Redis/BullMQ（本地场景不需要）
- **不建议** 切换到 PostgreSQL
- **建议** 引入 drizzle-orm 替代手写 SQL
- **建议** 前端引入 SWR/TanStack Query
- **认证层预留** — Gateway 中间件插槽
- **用户隔离预留** — sessions 表已有 user_id 字段
