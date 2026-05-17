/**
 * Accessibility (a11y) 检查说明
 *
 * 本项目使用 Storybook @storybook/addon-a11y 插件进行无障碍性检查。
 * 在 Storybook 中运行时，每个 story 的 "Accessibility" 面板会自动显示
 * axe-core 的检查结果，包括违规、通过和不适用的规则。
 *
 * 如需在 Vitest 中运行 a11y 测试，可在后续版本中引入 @axe-core/react：
 *
 * ```bash
 * npm install --save-dev @axe-core/react axe-core
 * ```
 *
 * 示例测试（不包含在当前测试运行中，避免破坏现有测试套件）：
 *
 * ```typescript
 * import React from 'react';
 * import { render } from '@testing-library/react';
 * import axe from 'axe-core';
 * import { StatusIndicator } from '../status-indicator';
 *
 * test('StatusIndicator has no a11y violations', async () => {
 *   const { container } = render(<StatusIndicator status="idle" label="空闲" />);
 *   const results = await axe.run(container);
 *   expect(results.violations).toHaveLength(0);
 * });
 * ```
 *
 * 关键 a11y 规范：
 * 1. 所有交互元素（按钮、链接）必须有 aria-label 或可见文本
 * 2. 图标按钮必须有 <span className="sr-only"> 或 aria-label
 * 3. 表单控件必须关联 <label>（通过 htmlFor/id 或 aria-labelledby）
 * 4. 颜色对比度：普通文本 ≥ 4.5:1，大文本 ≥ 3:1（WCAG AA）
 * 5. 高对比度模式（.high-contrast）满足 WCAG AAA 标准（≥ 7:1）
 * 6. 所有动画遵守 prefers-reduced-motion 媒体查询
 */

export {};
