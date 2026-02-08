import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillRegistry } from '../src/skills/registry.js';
import type { SkillSource, SkillContext, ToolDefinition } from '../src/types.js';

const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

function createMockSource(name: string, tools: ToolDefinition[]): SkillSource {
    return {
        name,
        type: 'local',
        initialize: vi.fn().mockResolvedValue(undefined),
        getTools: vi.fn().mockResolvedValue(tools),
        execute: vi.fn().mockResolvedValue({ success: true }),
        destroy: vi.fn().mockResolvedValue(undefined),
    };
}

function createToolDef(name: string, description = 'test tool'): ToolDefinition {
    return {
        type: 'function',
        function: {
            name,
            description,
            parameters: { type: 'object', properties: {} },
        },
    };
}

describe('SkillRegistry', () => {
    let registry: SkillRegistry;

    beforeEach(() => {
        registry = new SkillRegistry(mockLogger);
    });

    describe('registerSource', () => {
        it('should register and initialize a source', async () => {
            const source = createMockSource('test', [createToolDef('test.action')]);
            await registry.registerSource(source);

            expect(source.initialize).toHaveBeenCalled();
            expect(registry.getAllSources()).toHaveLength(1);
        });

        it('should overwrite existing source with same name', async () => {
            const source1 = createMockSource('test', [createToolDef('test.a')]);
            const source2 = createMockSource('test', [createToolDef('test.b')]);

            await registry.registerSource(source1);
            await registry.registerSource(source2);

            expect(source1.destroy).toHaveBeenCalled();
            expect(registry.getAllSources()).toHaveLength(1);
        });

        it('should throw and not register if initialize fails', async () => {
            const source = createMockSource('bad', []);
            (source.initialize as any).mockRejectedValue(new Error('init failed'));

            await expect(registry.registerSource(source)).rejects.toThrow('init failed');
            expect(registry.getAllSources()).toHaveLength(0);
        });
    });

    describe('getToolDefinitions', () => {
        it('should aggregate tools from all sources', async () => {
            const source1 = createMockSource('s1', [createToolDef('s1.a'), createToolDef('s1.b')]);
            const source2 = createMockSource('s2', [createToolDef('s2.c')]);

            await registry.registerSource(source1);
            await registry.registerSource(source2);

            const tools = await registry.getToolDefinitions();
            expect(tools).toHaveLength(3);
        });

        it('should handle source errors gracefully', async () => {
            const goodSource = createMockSource('good', [createToolDef('good.a')]);
            const badSource = createMockSource('bad', []);
            (badSource.getTools as any).mockRejectedValue(new Error('failed'));

            await registry.registerSource(goodSource);
            await registry.registerSource(badSource);

            const tools = await registry.getToolDefinitions();
            expect(tools).toHaveLength(1); // Only from good source
        });
    });

    describe('searchTools', () => {
        it('should find tools by name', async () => {
            const source = createMockSource('shell', [
                createToolDef('shell.execute', 'Execute a shell command'),
                createToolDef('shell.read', 'Read a file'),
            ]);
            await registry.registerSource(source);

            const results = await registry.searchTools('execute');
            expect(results).toHaveLength(1);
            expect(results[0].function.name).toBe('shell.execute');
        });

        it('should find tools by description', async () => {
            const source = createMockSource('file', [
                createToolDef('file.read', 'Read file contents'),
                createToolDef('file.write', 'Write data to disk'),
            ]);
            await registry.registerSource(source);

            const results = await registry.searchTools('disk');
            expect(results).toHaveLength(1);
            expect(results[0].function.name).toBe('file.write');
        });
    });

    describe('executeAction', () => {
        it('should route to correct source', async () => {
            const source = createMockSource('shell', [createToolDef('shell.execute')]);
            (source.execute as any).mockResolvedValue('output');
            await registry.registerSource(source);

            const ctx: SkillContext = {
                sessionId: 's1',
                memory: { get: vi.fn(), set: vi.fn(), search: vi.fn() },
                logger: mockLogger,
                config: {},
            };

            const result = await registry.executeAction('shell.execute', { cmd: 'ls' }, ctx);
            expect(result).toBe('output');
            expect(source.execute).toHaveBeenCalledWith('shell.execute', { cmd: 'ls' }, ctx);
        });

        it('should throw for unknown tool', async () => {
            const ctx: SkillContext = {
                sessionId: 's1',
                memory: { get: vi.fn(), set: vi.fn(), search: vi.fn() },
                logger: mockLogger,
                config: {},
            };

            await expect(registry.executeAction('unknown.tool', {}, ctx))
                .rejects.toThrow('not found');
        });
    });

    describe('unregister', () => {
        it('should unregister and destroy source', async () => {
            const source = createMockSource('test', []);
            await registry.registerSource(source);

            await registry.unregisterSource('test');
            expect(source.destroy).toHaveBeenCalled();
            expect(registry.getAllSources()).toHaveLength(0);
        });

        it('should unregister all sources', async () => {
            await registry.registerSource(createMockSource('s1', []));
            await registry.registerSource(createMockSource('s2', []));

            await registry.unregisterAll();
            expect(registry.getAllSources()).toHaveLength(0);
        });
    });
});
