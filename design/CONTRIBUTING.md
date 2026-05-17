# 贡献指南

## 新增组件的流程

### 1. 分析需求

在新增组件前，检查：
- 现有 `web/src/components/ui/` 中是否已有类似组件
- 是否是业务组件（放 `components/`）还是基础 UI 组件（放 `components/ui/`）
- 是否需要对应的 Storybook story

### 2. 创建组件文件

**UI 基础组件规范**：
```typescript
// web/src/components/ui/my-component.tsx
import * as React from "react"
import * as MyPrimitive from "radix-ui/react-my-primitive"  // 如果有对应 Radix primitive
import { cn } from "@/lib/utils"

function MyComponent({ className, ...props }: React.ComponentProps<typeof MyPrimitive.Root>) {
  return (
    <MyPrimitive.Root
      data-slot="my-component"
      className={cn("/* tailwind classes */", className)}
      {...props}
    />
  )
}

export { MyComponent }
```

**业务组件规范**：
```typescript
// web/src/components/my-business-component.tsx
"use client"  // 如果使用 hooks

import * as React from "react"
import { cn } from "@/lib/utils"

interface MyComponentProps {
  // 明确定义 props 类型
}

export function MyComponent({ ...props }: MyComponentProps) {
  return (
    <div>
      {/* 使用 CSS 变量语义类名，不硬编码颜色 */}
    </div>
  )
}
```

### 3. 编码规范

| 规范 | 说明 |
|------|------|
| `"use client"` | 仅在使用 hooks 或浏览器 API 时添加 |
| 颜色 | 使用 CSS 变量类名（`bg-background`、`text-foreground`），不硬编码 |
| 图标 | 只使用 `lucide-react`，不引入其他图标库 |
| 动画 | 使用 CSS 动画或 `framer-motion`（已安装） |
| 导入路径 | Next.js bundler 无需 `.js` 后缀 |
| Radix UI | 通过 `radix-ui` 整包导入：`import * as X from 'radix-ui/react-xxx'` |
| 新依赖 | 不新增 `radix-ui` 以外的 UI 库依赖 |

### 4. 写 Storybook Story

每个新组件至少写 3 个 story：

```typescript
// web/src/components/my-component.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { MyComponent } from './my-component';

const meta: Meta<typeof MyComponent> = {
  component: MyComponent,
  title: 'Business/MyComponent',  // 或 'UI/MyComponent'
};
export default meta;

type Story = StoryObj<typeof MyComponent>;

export const Default: Story = { args: { /* props */ } };
export const Variant2: Story = { args: { /* props */ } };
export const Variant3: Story = { args: { /* props */ } };
```

### 5. 提交前检查

```bash
# TypeScript 类型检查
cd web && npx tsc --noEmit

# 生产构建验证
cd web && npm run build

# Storybook 构建（可选）
cd web && npm run build-storybook
```

### 6. Design Token 更新

如需新增 token：

1. 在 `design/tokens/` 对应文件中添加（保持 `as const` 类型）
2. 确保 `design/index.ts` 有导出
3. 在 `design/README.md` 中更新说明

### 7. PR 描述模板

```markdown
## 新增组件：ComponentName

### 功能
- 简要说明组件用途

### 使用方式
\`\`\`tsx
<ComponentName prop="value" />
\`\`\`

### 测试
- [ ] TypeScript 类型检查通过（`npx tsc --noEmit`）
- [ ] 生产构建成功（`npm run build`）
- [ ] Storybook story 已添加
- [ ] 无障碍性检查通过（Storybook a11y addon）
```
