import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { read_xlsx, write_xlsx } from '../skills/built-in/document-processor/index.js';
import type { SkillContext } from '../src/types.js';

const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

function makeContext(): SkillContext {
    return {
        sessionId: 'test-session',
        memory: { get: vi.fn(), set: vi.fn(), search: vi.fn() },
        logger: mockLogger,
        config: {},
        llm: {} as any,
    };
}

describe('document-processor: xlsx (exceljs migration, P0-1)', () => {
    let dir: string;
    let ctx: SkillContext;

    beforeEach(() => {
        vi.clearAllMocks();
        dir = mkdtempSync(join(tmpdir(), 'cmaster-xlsx-test-'));
        ctx = makeContext();
    });

    afterEach(() => {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    });

    it('should write and read back a round-trip Excel file', async () => {
        const filePath = join(dir, 'test.xlsx');
        const data = [
            { name: 'Alice', age: 30, city: '北京' },
            { name: 'Bob', age: 25, city: '上海' },
        ];

        const writeResult = await write_xlsx(ctx, { path: filePath, data });
        expect(writeResult).toContain('已写入');
        expect(existsSync(filePath)).toBe(true);

        const readResult = await read_xlsx(ctx, { path: filePath });
        expect(readResult).toContain('name');
        expect(readResult).toContain('Alice');
        expect(readResult).toContain('北京');
        expect(readResult).toContain('Bob');
        expect(readResult).toContain('上海');
    });

    it('should respect max_rows when reading', async () => {
        const filePath = join(dir, 'many-rows.xlsx');
        const data = Array.from({ length: 10 }, (_, i) => ({ idx: i }));
        await write_xlsx(ctx, { path: filePath, data });

        const readResult = await read_xlsx(ctx, { path: filePath, max_rows: 3 });
        expect(readResult).toContain('10 行，显示前 3 行');
    });

    it('should throw a clear error for a non-existent sheet name', async () => {
        const filePath = join(dir, 'sheet-test.xlsx');
        await write_xlsx(ctx, { path: filePath, data: [{ a: 1 }], sheet: 'Sheet1' });

        await expect(read_xlsx(ctx, { path: filePath, sheet: 'NoSuchSheet' }))
            .rejects.toThrow(/不存在/);
    });

    it('should throw a clear error for a non-existent file', async () => {
        await expect(read_xlsx(ctx, { path: join(dir, 'missing.xlsx') }))
            .rejects.toThrow(/文件不存在/);
    });

    it('should report an empty sheet distinctly', async () => {
        const filePath = join(dir, 'empty.xlsx');
        await write_xlsx(ctx, { path: filePath, data: [] });

        const readResult = await read_xlsx(ctx, { path: filePath });
        expect(readResult).toContain('为空');
    });
});
