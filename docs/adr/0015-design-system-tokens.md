# ADR 0015: UI/UX 设计系统 — Design Tokens + 三主题 + Storybook

**Status**: Accepted  
**Date**: 2026-05-17  
**Phase**: P9.7 — UI/UX Design System  
**Deciders**: yiyisf  

---

## Context

Phase 9.7 前，前端无统一的设计语言：
- 颜色/间距/字体在各页面组件中硬编码，修改一处需全局搜索替换
- 只有 light/dark 两套主题（通过 `next-themes`），缺少面向残障用户的高对比度主题（WCAG AAA）
- 业务组件（ChatMessage、ToolCallCard 等）散落在各页面，无法在隔离环境预览或文档化
- 不同页面对同一 UI 概念（如"空状态"、"状态指示器"）有不同实现，不一致

**主题需求**：企业客户要求支持无障碍访问（Accessibility），WCAG AA 是最低标准，某些政府/金融客户要求 AAA。

---

## Decision

### 1. Design Tokens — 零构建步骤，纯 TypeScript 常量

```
design/tokens/
├── color.ts       — 品牌色 + 语义色 + 中性色梯度
├── typography.ts  — 字号阶梯 / 行高 / 字重
├── spacing.ts     — 4px 基准的 8 级间距
├── radius.ts      — 圆角梯度
├── shadow.ts      — 阴影层级
└── motion.ts      — 缓动函数 + 过渡时长
```

**决策**：纯 TypeScript 常量，不引入 Style Dictionary 或 Figma Tokens 插件。理由：
- 当前规模（6 个 token 文件）不值得引入 token 构建工具链
- TypeScript 常量有完整类型检查；未来可按需迁移到 Style Dictionary

### 2. 三主题系统（light / dark / high-contrast）

CSS 变量方案：
```css
:root           { /* light 默认 */ }
.dark           { /* dark 覆盖 */ }
.high-contrast  { /* AAA 高对比度 */ }
.high-contrast.dark { /* 高对比度暗色 */ }
```

- `ThemeProvider`（`web/src/components/theme-provider.tsx`）：`light | dark | high-contrast` 三选一，localStorage 持久化
- `next-themes` 的 `class` 策略与高对比度 class 共存
- WCAG AAA 对比度要求（≥7:1 正文，≥4.5:1 大文字）通过 CSS 变量覆盖实现，不修改组件代码

### 3. 组件库结构（26 个组件）

| 类型 | 数量 | 示例 |
|------|------|------|
| 基础 UI（Radix 封装）| 3 | checkbox / radio-group / popover |
| 业务组件 | 10 | chat-message / tool-call-card / thinking-panel / hitl-approval-dialog / skill-card / skill-factory-wizard / command-palette / citation-link / status-indicator / connector-card |
| 布局组件 | 5 | header / empty-state / main-layout / auth-layout + barrel index |
| 现有升级 | 8 | sidebar / settings/tabs 等复用 P9.7 tokens |

### 4. Storybook 8.6.18（@storybook/nextjs）

- 7 个 stories 文件，28+ stories，`addon-a11y` 无障碍检查
- `tsconfig.json` 排除 `*.stories.tsx/ts`，防止 Next.js 生产构建类型冲突
- `npm run storybook` 启动隔离预览（不影响 `next build`）

---

## Consequences

**正面影响**：
- 新页面直接引用 token 常量，样式变更有单一修改点
- 高对比度主题开箱即用，满足政府/金融企业 WCAG AAA 要求
- Storybook 提供组件文档和 a11y 检查，降低跨团队沟通成本

**负面影响**：
- Storybook 构建是独立进程，不集成到 `next build`；CI 未加入 `npm run build-storybook` 步骤（Phase 11 补充）
- Design Token TypeScript 常量与 Tailwind CSS 变量并存，两套方案需手动保持同步（未来统一到 CSS 变量）
- `tsconfig.json` stories 排除需在每次新增 stories 文件后检查路径是否正确

---

## Alternatives Considered

1. **Style Dictionary 生成多格式 token**：适合设计师-开发者协作工作流，但项目无 Figma 设计师参与，引入复杂度不合理。
2. **CSS-in-JS（styled-components）替代 Tailwind**：项目已大量使用 Tailwind 4，迁移成本高，且 CSS-in-JS 在 Next.js App Router（RSC）中有兼容问题。拒绝。
3. **仅 2 主题（light/dark）**：无法满足 WCAG AAA 企业要求，且 high-contrast 是纯 CSS 变量覆盖，新增成本极低。拒绝。
4. **Chromatic（云端 Storybook）**：需要付费订阅，本地 Storybook 已满足当前需求。推迟。

---

## References

- `design/tokens/` — 6 个 Token 文件
- `web/src/components/theme-provider.tsx` — 三主题 Provider
- `web/src/app/globals.css` — `.high-contrast` CSS 变量
- `.storybook/main.ts` + `preview.ts` — Storybook 配置
- `web/tsconfig.json` — stories 文件排除配置
