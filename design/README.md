# CMaster Bot 设计系统

## 目录结构

```
design/
├── tokens/
│   ├── color.ts        # 颜色 token（品牌色、语义色、表面色、边框色）
│   ├── typography.ts   # 排版 token（字体、字号、字重、行高）
│   ├── spacing.ts      # 间距 token（8px 基础栅格）
│   ├── radius.ts       # 圆角 token
│   ├── shadow.ts       # 阴影 token
│   └── motion.ts       # 动效 token（时长、缓动函数）
├── index.ts            # 统一导出所有 token
├── README.md           # 本文档
└── CONTRIBUTING.md     # 贡献指南
```

## 如何使用 Token

Design tokens 是纯 TypeScript 常量对象，可直接导入使用：

```typescript
import { colorTokens, spacingTokens, motionTokens } from '@/design';
// 或从根路径导入（需配置路径别名）：
import { colorTokens } from '../../design';

// 使用示例
const brandColor = colorTokens.brand[500]; // '#8b5cf6'
const gap = spacingTokens['2'];            // '16px'
const duration = motionTokens.duration.normal; // '200ms'
```

在 Tailwind CSS 中，请优先使用 CSS 变量语义类名（`bg-background`、`text-foreground` 等），设计 token 主要用于组件库、文档和一致性校验。

## 主题切换方式

本项目支持三种主题：

| 主题 | class | 说明 |
|------|-------|------|
| `light` | 默认（无 class） | 浅色模式 |
| `dark` | `.dark` | 暗色模式 |
| `high-contrast` | `.high-contrast` | 高对比度模式（无障碍） |

主题通过 `next-themes` 管理，存储在 `localStorage` 中。使用 `ModeToggle` 组件切换主题，或在代码中调用：

```typescript
import { useTheme } from 'next-themes';
const { setTheme } = useTheme();
setTheme('high-contrast');
```

高对比度模式可与暗色模式叠加：在 `html` 元素上同时有 `.high-contrast.dark` class 时，会应用高对比度暗色变量。

## 组件目录

### UI 基础组件（`web/src/components/ui/`）
23 个基础组件：accordion, alert-dialog, avatar, badge, button, card, checkbox, collapsible, dialog, dropdown-menu, input, label, popover, progress, radio-group, scroll-area, select, separator, sheet, sidebar, skeleton, sonner, switch, tabs, textarea, tooltip

### 业务组件（`web/src/components/`）
| 组件 | 用途 |
|------|------|
| `chat-message.tsx` | 用户/助手消息气泡 |
| `tool-call-card.tsx` | 折叠式工具调用展示 |
| `thinking-panel.tsx` | 思考过程展示 |
| `hitl-approval-dialog.tsx` | Human-in-the-Loop 审批对话框 |
| `skill-card.tsx` | 技能卡片 |
| `skill-factory-wizard.tsx` | 技能工厂向导 |
| `command-palette.tsx` | ⌘K 全局命令面板 |
| `citation-link.tsx` | 引用链接（角标式） |
| `status-indicator.tsx` | Agent 状态指示器 |
| `connector-card.tsx` | 连接器卡片 |

### 布局组件（`web/src/components/layout/`）
| 组件 | 用途 |
|------|------|
| `header.tsx` | 顶部导航栏 |
| `empty-state.tsx` | 空状态展示 |
| `main-layout.tsx` | 主布局（Sidebar + 内容区） |
| `auth-layout.tsx` | 认证页面布局 |

## Storybook

```bash
cd web
npm run storybook      # 启动开发服务器（端口 6006）
npm run build-storybook # 生产构建
```
