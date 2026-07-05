import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { resolve } from 'path';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '..');
const distExists = existsSync(resolve(repoRoot, 'dist', 'index.js'));

/**
 * P0-3 回归测试：技能实现文件曾通过 `../../../src/x.js` 相对路径跨目录引用共享工具
 * （src/skills/utils.ts 等）。这类导入只在 tsx（dev）/ vitest（自带别名解析）下能工作，
 * 用纯 `node`（无 loader，模拟 `npm start` / Docker 运行时）加载会抛 ERR_MODULE_NOT_FOUND。
 *
 * 现已改为 `#skill-kit/*` subpath import（package.json `imports` 字段，prod 下指向已编译的
 * dist/）。本测试用纯 node 子进程直接 import 编译后的技能文件，复现当年会失败的确切场景。
 *
 * 依赖 dist/ 已存在（`npm run build`）；CI 应在测试前先构建。fresh checkout 尚未构建时跳过，
 * 而非误报失败。
 */
describe.skipIf(!distExists)('skill production loading (P0-3 regression)', () => {
    const skillsToCheck = [
        'claude-code',
        'shell',
        'document-processor',
        'im-bot',
        'vision',
        'gemini-cli',
        'database-connector',
        'file-manager',
        'browser-automation',
    ];

    beforeAll(() => {
        if (!distExists) {
            // eslint-disable-next-line no-console
            console.warn('[skill-prod-loading.test.ts] dist/ not found — run `npm run build` first. Skipping.');
        }
    });

    for (const skillName of skillsToCheck) {
        it(`${skillName} loads under plain node (no tsx/vitest loader)`, async () => {
            const skillPath = `./skills/built-in/${skillName}/index.ts`;
            const { stdout } = await execFileAsync(
                process.execPath,
                ['-e', `import('${skillPath}').then(m => console.log(JSON.stringify(Object.keys(m)))).catch(e => { console.error(e.stack); process.exit(1); })`],
                { cwd: repoRoot, timeout: 15_000 }
            );
            const exportedNames = JSON.parse(stdout.trim());
            expect(Array.isArray(exportedNames)).toBe(true);
            expect(exportedNames.length).toBeGreaterThan(0);
        }, 20_000);
    }
});
