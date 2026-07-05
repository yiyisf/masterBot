import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        globals: true,
    },
    resolve: {
        alias: {
            '@': './src',
        },
        // P0-3: skills/**/*.ts 通过 #skill-kit/* subpath import 引用 src/ 下的共享工具，
        // 测试环境需解析到 TS 源码（而非要求预先 npm run build 产出 dist/），与 dev 模式行为一致。
        conditions: ['development'],
    },
});
