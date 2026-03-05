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

## Worker Agent (SOUL.md) — Phase 21

Worker Agent 是具备完整 ReAct 循环的子智能体，由 Supervisor Agent 通过 `delegate_to_agent` 工具调用。

### 目录结构

```
agents/
  coder/
    SOUL.md       ← Worker Agent 定义
  analyst/
    SOUL.md
```

### SOUL.md 格式

```markdown
---
name: coder               # workerId，唯一标识（对应 delegate_to_agent 的 workerId 参数）
version: 1.0.0
description: 专业代码工程师，负责代码编写、调试和重构
skills:                   # 空列表 = 继承 Supervisor 全部技能；非空 = 限制到指定技能
  - shell
  - file-manager
systemPrompt: |
  你是专业代码工程师，专注于：
  1. 编写高质量、可维护的代码
  2. 调试和修复 Bug
  3. 代码重构和优化
  始终遵循最佳实践，优先使用已有工具完成任务。
---
```

`SoulLoader` 在服务启动时自动扫描 `agents/` 目录并注册所有 Worker Agent。

### 调用方式

Supervisor Agent 通过内置工具调用 Worker：

```
工具: delegate_to_agent
参数:
  workerId: "coder"
  task: "将 src/utils.js 中的 formatDate 函数重构为支持时区的版本"
```

### 与 Skill 的对比

| 维度 | Skill | Worker Agent |
|------|-------|-------------|
| 触发方式 | 工具调用（`skill_name.action`） | `delegate_to_agent` 内置工具 |
| 能力范围 | 单一原子操作 | 完整 ReAct 推理循环 |
| 配置文件 | `SKILL.md` | `SOUL.md` |
| 目录位置 | `skills/` | `agents/` |
| 工具访问 | N/A（自身即工具） | 可使用指定技能子集 |
| 适用场景 | 调用外部 API、执行命令 | 复杂子任务、专家代理 |

### 多 Agent 最佳实践

1. **职责分离**：每个 Worker 专注单一领域（代码、数据分析、文档处理）
2. **技能约束**：通过 `skills` 字段限制 Worker 只能访问必要工具，遵循最小权限原则
3. **任务描述精确**：`delegate_to_agent` 的 `task` 参数越具体，Worker 效果越好
4. **避免循环委托**：Worker 不应再次调用 `delegate_to_agent`，防止无限递归
5. **流式透传**：Worker 的 `ExecutionStep` 会实时透传到前端，用户可看到完整思考链
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
