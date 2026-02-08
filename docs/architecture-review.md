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
| Agent 模式 | ReAct + Think-Plan-Act + DAG | 业界主流，plan_task + dag_* 结构化推理 |
| 技能系统 | SKILL.md + MCP + 动态导入 | 声明式协议清晰，多源注册(Local/MCP) |
| 记忆系统 | 短期 LRU + 长期向量检索 | 双层记忆，跨会话知识持久化 |
| 安全 | Auth 中间件 + Shell 沙箱 | API Key/JWT + 命令黑白名单 |

### 架构优势

1. **流式优先设计** — async generator 贯穿全链路
2. **技能协议** — SKILL.md 声明式 + 热重载 + MCP 协议接入社区工具
3. **多源技能注册** — SkillRegistry 支持 Local + MCP 多源
4. **LLM 热切换** — lambda getter + 工厂缓存
5. **Think-Plan-Act + DAG** — plan_task 结构化推理 + dag_* 任务并行编排
6. **双层记忆** — 短期 LRU 会话隔离 + 长期 SQLite 向量余弦检索
7. **前端 ReAct 可视化** — thought/plan/action/observation/task 全阶段透明展示
8. **安全防护** — 认证中间件 + Shell 命令沙箱

### 已解决的问题 (Phase 5)

| 问题 | 解决方案 |
|------|----------|
| 无上下文窗口管理 | `ContextManager` 滑动窗口 + LLM 摘要压缩 |
| SessionMemory 无 LRU 淘汰 | `SessionMemoryManager` LRU 淘汰 + 定时清理 |
| 工具执行无超时 | `executeWithTimeout` 60 秒超时保护 |
| 依赖残留 | 移除 sql.js, @types/better-sqlite3, bullmq |
| 无测试 | 28 个测试覆盖核心模块 |

### 已解决的问题 (Phase 6)

| 问题 | 解决方案 |
|------|----------|
| 无长期记忆 | `LongTermMemory` SQLite 存储 + 向量余弦检索 + LIKE 降级 |
| Agent 无记忆工具 | 内置 `memory_remember` / `memory_recall` + 自动注入 top-3 相关记忆 |
| 无 MCP 协议支持 | `McpSkillSource` 支持 stdio/SSE 传输，指数退避重连 |
| MCP 无运行时管理 | Gateway MCP 配置 API，支持运行时注册/卸载 |

### 已解决的问题 (Phase 7)

| 问题 | 解决方案 |
|------|----------|
| 无认证/鉴权 (原 P0) | `createAuthHook` 中间件，支持 API Key + JWT 两种模式，默认禁用 |
| Shell 技能无沙箱 (原 P1) | `CommandSandbox` 黑名单/白名单模式，拦截 rm -rf、mkfs、fork bomb 等 |
| 无任务编排能力 | Task DAG：`tasks` 表 + `TaskRepository` + `DAGExecutor` 并行执行引擎 |
| Agent 无任务分解工具 | 内置 `dag_create_task` / `dag_get_status` / `dag_execute` 工具 |
| 前端不支持任务事件 | `assistant-runtime.ts` 处理 task_created/completed/failed 事件 |

### 待解决问题

#### P0
- **DatabaseSync 同步阻塞** — 当前数据量小不构成问题，未来可用 Worker Thread 包装

#### P1
- 错误处理不够一致
- DAG 可视化组件（前端）

#### P2
- 前端无全局状态管理
- 无可观测性 (metrics/tracing)

---

## 未来路线图

### Phase 5: 核心加固 ✅

- **5.1 上下文窗口管理** ✅ — `ContextManager` 滑动窗口 + LLM 摘要
- **5.2 内存 LRU 淘汰** ✅ — `SessionMemoryManager` LRU + 定时清理
- **5.3 工具超时保护** ✅ — `executeWithTimeout` 60 秒
- **5.4 依赖清理 + 测试** ✅ — 移除残留依赖，28 个测试

### Phase 6: 能力扩展 ✅

- **6.1 MCP 协议完整实现** ✅ — McpSkillSource（stdio/SSE），指数退避重连
- **6.2 长期记忆** ✅ — SQLite 向量余弦检索 + LIKE 降级
- **6.3 Agent 记忆工具** ✅ — memory_remember / memory_recall + 自动注入

### Phase 7: 安全 + 任务编排 ✅

- **7.1 Shell 命令沙箱** ✅ — CommandSandbox 黑名单/白名单模式
- **7.2 认证中间件** ✅ — API Key + JWT，默认禁用
- **7.3 Task DAG** ✅ — tasks 表 + TaskRepository + DAGExecutor 并行执行
- **7.4 Agent DAG 工具** ✅ — dag_create_task / dag_get_status / dag_execute

### Phase 8: 未来方向

- **8.1 RAG 知识库** — 文档上传 + 分块嵌入 + 检索增强
- **8.2 插件市场** — 技能包格式 + 在线仓库
- **8.3 可观测性** — trace_id 链路追踪 + Dashboard 指标
- **8.4 本地模型** — Ollama 接入
- **8.5 DAG 可视化** — 前端任务依赖图可视化组件
- **8.6 多模态增强** — 图像/文件上传处理

### 实施优先级

```
已完成 (Phase 5) → 上下文窗口管理 ✓ | 基础测试 ✓ | 清理依赖 ✓ | 内存 LRU ✓
已完成 (Phase 6) → MCP 协议 ✓ | 长期记忆 ✓ | Agent 记忆工具 ✓
已完成 (Phase 7) → Shell 沙箱 ✓ | 认证中间件 ✓ | Task DAG ✓ | 90 个测试 ✓
下一步 (Phase 8) → RAG 知识库 > DAG 可视化 > 插件市场 > 可观测性 > 本地模型
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
- **认证已实现** — API Key + JWT 中间件（默认禁用）
- **用户隔离预留** — sessions 表已有 user_id 字段
- **测试覆盖** — 90 个测试覆盖 8 个文件
