# 技能开发手册

## SKILL.md 协议

每个技能目录包含：
- `SKILL.md` — 元数据 + 动作描述（被 AI 用于理解何时调用）
- `index.ts` — 实现逻辑

### SKILL.md 格式

```markdown
---
name: my-skill
version: 1.0.0
description: 简短描述（AI 选择技能时参考）
author: Your Name
dependencies:           # 可选 npm 依赖（自动安装）
  axios: ^1.6.0
---

## Actions

### action_name
描述此动作的用途（越清晰 AI 越容易选择）

- `param_name` (string, required) — 参数说明
- `optional_param` (number, 可选) — 可选参数，默认 10
```

### index.ts 模板

```typescript
import type { SkillAction, SkillContext } from '../../src/types.js';

export const actions: Record<string, SkillAction> = {
    action_name: {
        name: 'action_name',
        description: '动作描述',
        parameters: {
            param_name: { type: 'string', description: '参数说明', required: true },
        },
        handler: async (ctx: SkillContext, params: Record<string, unknown>) => {
            const { param_name } = params as { param_name: string };

            // 在这里实现你的逻辑
            // ctx.logger.info('Executing...');
            // ctx.sessionId — 当前会话 ID
            // ctx.userId — 用户 ID (如果已配置认证)

            return { result: `Processed: ${param_name}` };
        },
    },
};
```

---

## SkillContext API

| 属性 | 类型 | 说明 |
|-----|------|-----|
| `ctx.sessionId` | string | 当前会话 ID |
| `ctx.userId` | string? | 当前用户 ID |
| `ctx.role` | string? | 用户角色（权限控制） |
| `ctx.logger` | Logger | 日志记录器 |
| `ctx.memory` | MemoryAccess | 短期记忆访问 |
| `ctx.config` | Record | 技能配置（来自 YAML） |

---

## 调试技巧

1. **热重载**: 修改 `index.ts` 后，在 `/skills` 页面点击"重新加载"
2. **日志**: 使用 `ctx.logger.info(...)` 输出调试信息
3. **测试**: 在聊天框直接描述需要执行的动作
4. **自动生成**: 直接告诉 AI "帮我生成一个技能..."，它会自动编写代码

---

## 企业连接器（YAML 方式）

比自写 index.ts 更快，适合简单 REST API：

```yaml
# connectors/my-system.yaml
name: hr-system
type: http
baseUrl: ${HR_BASE_URL}
auth:
  type: bearer
  token: ${HR_TOKEN}
actions:
  - name: get_employee_leave
    description: 查询员工假期余额
    method: GET
    path: /api/leave/{employee_id}
    params:
      - name: employee_id
        in: path
        required: true
```

放入 `connectors/` 目录后重启或在 `/connectors` 页面上传即生效。

---

## Managed Agent (SOUL.md) — Phase 23

Managed Agent 是具备完整 ReAct 循环的子智能体，运行在 **AgentHarness** 容器中。Phase 23 升级了声明式规格（AgentSpec）、工具权限过滤、Outcome 评分修订循环。

### 目录结构

```
agents/
  builtin/
    code-reviewer/SOUL.md   ← 内置代码审查 Agent
    coder/SOUL.md            ← 内置代码专家 Agent
    researcher/SOUL.md       ← 内置调研分析 Agent
  my-agent/
    SOUL.md                  ← 自定义 Agent
```

### SOUL.md 完整格式（Phase 23）

```yaml
---
id: my-agent                  # 唯一标识，对应 API 的 specId
name: My Agent
version: 1.0.0
description: Agent 用途描述

# 工具权限：支持 glob 模式，deny 优先于 allow
tools:
  allow:
    - "file-manager.*"        # 允许所有 file-manager 工具
    - "shell.execute"         # 仅允许 shell.execute
  deny:
    - "shell.kill"            # 明确禁止

# 资源限制
resources:
  maxIterations: 10           # 最大推理轮数（默认 10）
  timeoutMs: 60000            # 总超时毫秒（默认 60s）
  concurrency: 3              # 同时运行最大实例数（默认 3）
  preferredProvider: openai   # 指定 LLM 提供商（可选）

# 记忆隔离
memory:
  namespace: my-agent         # 长期记忆命名空间前缀
  scope: isolated             # isolated（独立）或 shared（继承父 Agent）

# 生命周期 Hook
hooks:
  onStart:
    - type: log
      message: "Agent 启动: {{task}}"
  onToolCall:
    - type: approve             # 工具调用前人工确认（HITL）
      config:
        pattern: "shell.*"      # 匹配工具名的正则
        message: "确认执行 shell 命令？"
  onComplete:
    - type: notify
      config:
        channel: feishu
        template: "任务完成: {{task}}"

# Outcome 评分（可选，启用后开启修订循环）
outcome:
  criteria:
    - id: quality
      description: 输出质量是否符合预期
      weight: 8
      required: true           # required=true 时不达标直接 failed
    - id: completeness
      description: 是否完整回答了所有问题
      weight: 5
  grader:
    maxRevisions: 2            # 最多重试次数（默认 2）
    minScore: 75               # 满足分数线（默认 75）
    provider: openai           # Grader 使用的 LLM 提供商（可选）

systemPrompt: |
  你是 My Agent，专注于...
---
```

### 兼容旧格式（Phase 21 SOUL.md）

旧格式（仅含 `name/description/skills`）仍完全兼容，`SoulLoader` 自动转换为 AgentSpec：

```yaml
---
name: coder
version: 1.0.0
description: 代码专家
skills:
  - shell
  - file-manager
systemPrompt: |
  你是专业代码工程师...
---
```

### 通过 API 动态注册

除了 SOUL.md 文件，也可以通过 REST API 动态注册 AgentSpec：

```bash
# 注册 AgentSpec
POST /api/agents/specs
Content-Type: application/json
{ "id": "my-agent", "name": "My Agent", ... }

# 创建 Agent 实例（spawn）
POST /api/agents/spawn
{ "specId": "my-agent", "task": "分析这段代码的安全性", "sessionId": "s1" }

# 查看实例状态
GET /api/agents/instances/:instanceId

# 流式获取步骤（SSE）
GET /api/agents/instances/:instanceId/steps

# 暂停 / 取消
PATCH /api/agents/instances/:instanceId
{ "action": "pause" }   # pause | resume | cancel
```

### 与 Skill 的对比

| 维度 | Skill | Managed Agent |
|------|-------|--------------|
| 触发方式 | 工具调用（`skill_name.action`） | `delegate_to_agent` 或 `/api/agents/spawn` |
| 能力范围 | 单一原子操作 | 完整 ReAct 推理循环 |
| 配置文件 | `SKILL.md` | `SOUL.md` |
| 目录位置 | `skills/` | `agents/` |
| 工具权限 | N/A（自身即工具） | allow/deny glob 精确管控 |
| 质量保障 | 无 | Outcome Grader 多维评分 + 修订循环 |
| 生命周期 | 无 | pause / resume / cancel + Hook |
| 适用场景 | 调用外部 API、执行命令 | 复杂子任务、专家代理、质量敏感任务 |

### Outcome Grader 工作流

```
spawn(specId, task)
    │
    ▼
Agent.run(task)  ──► yield ExecutionStep[]
    │
    ▼ (如果定义了 outcome)
Grader.evaluate(task, output, criteria)
    │
    ├── satisfied  → 完成 ✅
    ├── needs_revision → 注入 Grader 反馈重新执行（最多 maxRevisions 次）
    └── failed → 抛错，触发 onError hook ❌
```

### 最佳实践

1. **最小权限原则**：`tools.allow` 只列出 Agent 真正需要的工具
2. **Outcome 标准可测量**：criteria 描述应具体、可量化，Grader 才能客观评分
3. **required 慎用**：只对关键维度设 `required: true`，避免因次要问题导致整体 failed
4. **超时设置合理**：`timeoutMs` 应覆盖最坏情况（包含所有修订轮次）
5. **避免循环委托**：Agent 不应再次调用 `delegate_to_agent`，防止无限递归
---

## MCP 协议支持

系统原生支持 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)，通过 stdio 或 SSE 接入第三方工具库。

### 配置方式

在 **Skills** 页面中点击 "Add MCP Server"：

- **Stdio (本地)**:
  - `command`: 可执行文件名 (如 `npx`, `python`)
  - `args`: 参数数组 (如 `["-y", "@modelcontextprotocol/server-github"]`)
  - `env`: 环境变量 (如 `{"GITHUB_TOKEN": "..."}`) — **New!**
- **SSE/HTTP (远程)**:
  - `url`: 服务端端点 (如 `http://localhost:8000/sse`)
