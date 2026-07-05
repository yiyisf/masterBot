import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolve as pathResolve, join as pathJoin } from 'path';
import { homedir } from 'os';

const spawnCliMock = vi.hoisted(() => vi.fn());

vi.mock('#skill-kit/skills/utils.js', () => ({
    expandPath: (p: unknown) => {
        if (!p || typeof p !== 'string') throw new Error('缺少必要参数 path：请提供文件路径');
        if (p.startsWith('~/') || p === '~') return pathResolve(pathJoin(homedir(), p.slice(1)));
        return pathResolve(p);
    },
    resolveCliCommand: (name: string) => name,
    spawnCli: spawnCliMock,
}));

import { ask, analyze_code } from '../skills/built-in/gemini-cli/index.js';
import type { SkillContext } from '../src/types.js';

const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeContext(): SkillContext {
    return {
        sessionId: 'test-session',
        memory: { get: vi.fn(), set: vi.fn(), search: vi.fn() },
        logger: mockLogger,
        config: {},
        llm: {} as any,
    };
}

describe('gemini-cli skill: cwd sandboxing (P1-2, parity with claude-code)', () => {
    let ctx: SkillContext;

    beforeEach(() => {
        vi.clearAllMocks();
        ctx = makeContext();
        spawnCliMock.mockResolvedValue(JSON.stringify({ response: 'ok' }));
    });

    it('ask: accepts cwd within the project root', async () => {
        const result = await ask(ctx, { prompt: 'x', cwd: process.cwd() });
        expect(result).not.toMatch(/^Error:/);
        expect(spawnCliMock).toHaveBeenCalled();
    });

    it('ask: rejects cwd outside the project root', async () => {
        const result = await ask(ctx, { prompt: 'x', cwd: '/etc' });
        expect(result).toMatch(/Error:.*项目根目录/);
        expect(spawnCliMock).not.toHaveBeenCalled();
    });

    it('analyze_code: rejects an out-of-root cwd', async () => {
        const result = await analyze_code(ctx, { prompt: 'x', cwd: '/etc' });
        expect(result).toMatch(/Error:.*项目根目录/);
        expect(spawnCliMock).not.toHaveBeenCalled();
    });

    it('analyze_code: accepts cwd within the project root', async () => {
        const result = await analyze_code(ctx, { prompt: 'x', cwd: process.cwd() });
        expect(result).not.toMatch(/^Error:/);
        expect(spawnCliMock).toHaveBeenCalled();
    });
});
