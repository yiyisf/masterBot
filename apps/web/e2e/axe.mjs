import { createRequire } from 'node:module';
import { expect } from 'playwright/test';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

export async function expectNoAxeViolations(page) {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
    return result.violations.map(({ id, impact, nodes }) => ({
      id, impact, targets: nodes.map((node) => node.target),
    }));
  });
  expect(violations).toEqual([]);
}
