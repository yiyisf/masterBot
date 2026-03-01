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
