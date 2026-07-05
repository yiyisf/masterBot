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

import { ask, code_review, continue_session } from '../skills/built-in/claude-code/index.js';
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

describe('claude-code skill governance hardening (P0-5)', () => {
    let ctx: SkillContext;

    beforeEach(() => {
        vi.clearAllMocks();
        ctx = makeContext();
        spawnCliMock.mockResolvedValue(JSON.stringify({ result: 'ok' }));
    });

    describe('ask: allowed_tools capped to read-only ceiling', () => {
        it('defaults to Read,Grep,Glob when not specified', async () => {
            await ask(ctx, { prompt: 'analyze this repo' });
            const args = spawnCliMock.mock.calls[0][1] as string[];
            const idx = args.indexOf('--allowedTools');
            expect(args[idx + 1]).toBe('Read,Grep,Glob');
        });

        it('strips Bash/Write/Edit even if explicitly requested', async () => {
            await ask(ctx, { prompt: 'do something', allowed_tools: 'Read,Write,Edit,Bash' });
            const args = spawnCliMock.mock.calls[0][1] as string[];
            const idx = args.indexOf('--allowedTools');
            expect(args[idx + 1]).toBe('Read');
            expect(args[idx + 1]).not.toContain('Write');
            expect(args[idx + 1]).not.toContain('Bash');
        });

        it('falls back to default ceiling when requested set has no allowed tools', async () => {
            await ask(ctx, { prompt: 'x', allowed_tools: 'Bash,Write' });
            const args = spawnCliMock.mock.calls[0][1] as string[];
            const idx = args.indexOf('--allowedTools');
            expect(args[idx + 1]).toBe('Read,Grep,Glob');
        });
    });

    describe('ask: cwd sandboxing', () => {
        it('accepts cwd within the project root', async () => {
            const result = await ask(ctx, { prompt: 'x', cwd: process.cwd() });
            expect(result).not.toMatch(/^Error:/);
            expect(spawnCliMock).toHaveBeenCalled();
        });

        it('rejects cwd outside the project root', async () => {
            const result = await ask(ctx, { prompt: 'x', cwd: '/etc' });
            expect(result).toMatch(/Error:.*项目根目录/);
            expect(spawnCliMock).not.toHaveBeenCalled();
        });

        it('rejects cwd escaping via traversal', async () => {
            const result = await ask(ctx, { prompt: 'x', cwd: '../../../../etc' });
            expect(result).toMatch(/Error:/);
            expect(spawnCliMock).not.toHaveBeenCalled();
        });
    });

    describe('code_review: still forces Read-only and inherits cwd sandbox', () => {
        it('passes through Read allowed_tools', async () => {
            await code_review(ctx, { target: 'src/index.ts' });
            const args = spawnCliMock.mock.calls[0][1] as string[];
            const idx = args.indexOf('--allowedTools');
            expect(args[idx + 1]).toBe('Read');
        });

        it('rejects an out-of-root cwd', async () => {
            const result = await code_review(ctx, { target: 'x', cwd: '/etc' });
            expect(result).toMatch(/Error:.*项目根目录/);
            expect(spawnCliMock).not.toHaveBeenCalled();
        });
    });

    describe('continue_session: session_id required (no implicit --continue)', () => {
        it('rejects when session_id is missing', async () => {
            const result = await continue_session(ctx, { prompt: 'follow up' });
            expect(result).toMatch(/session_id parameter is required/);
            expect(spawnCliMock).not.toHaveBeenCalled();
        });

        it('uses --resume with the provided session_id, never --continue', async () => {
            await continue_session(ctx, { prompt: 'follow up', session_id: 'abc-123' });
            const args = spawnCliMock.mock.calls[0][1] as string[];
            expect(args).toContain('--resume');
            expect(args).toContain('abc-123');
            expect(args).not.toContain('--continue');
        });
    });
});
