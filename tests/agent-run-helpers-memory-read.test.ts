import { describe, it, expect, vi } from 'vitest';
import { handleBuiltinToolCall, type BuiltinHandlerDeps, type RunContext } from '../src/core/agent-run-helpers.js';
import type { Message } from '../src/types.js';

// P1-6 (M1): memory_read 是新的 agentic 检索主路径工具，验证其在 handleBuiltinToolCall 中的接线。

const mockLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeContext(): RunContext {
    return {
        sessionId: 'sess-1',
        memory: { get: vi.fn(), set: vi.fn(), search: vi.fn() },
        traceId: 'trace-1',
        agentSpanId: 'span-1',
    };
}

function makeDeps(longTermMemory: BuiltinHandlerDeps['longTermMemory']): BuiltinHandlerDeps {
    return {
        logger: mockLogger as any,
        longTermMemory,
        skillRegistry: {} as any,
        skillConfig: {},
        llm: {} as any,
    };
}

async function drain(gen: AsyncGenerator<any>) {
    const steps: any[] = [];
    for await (const step of gen) steps.push(step);
    return steps;
}

describe('handleBuiltinToolCall: memory_read (P1-6 M1)', () => {
    it('returns the memory file content as an observation and pushes a tool message', async () => {
        const readMemoryFile = vi.fn().mockResolvedValue('---\nname: topic-1\n---\n\nremembered fact');
        const deps = makeDeps({ readMemoryFile } as any);
        const messages: Message[] = [];
        const toolCall = { id: 'call-1', function: { name: 'memory_read', arguments: '{}' } };

        const steps = await drain(handleBuiltinToolCall(toolCall, { category: 'user', topic: 'topic-1' }, makeContext(), deps, messages));

        expect(readMemoryFile).toHaveBeenCalledWith('user', 'topic-1');
        const observation = steps.find(s => s.type === 'observation');
        expect(observation.content).toContain('remembered fact');
        expect(messages[0]).toMatchObject({ role: 'tool', toolCallId: 'call-1' });
        expect(messages[0].content).toContain('remembered fact');
    });

    it('reports not-found for a missing category/topic without throwing', async () => {
        const readMemoryFile = vi.fn().mockResolvedValue(null);
        const deps = makeDeps({ readMemoryFile } as any);
        const messages: Message[] = [];
        const toolCall = { id: 'call-2', function: { name: 'memory_read', arguments: '{}' } };

        const steps = await drain(handleBuiltinToolCall(toolCall, { category: 'user', topic: 'missing' }, makeContext(), deps, messages));

        const observation = steps.find(s => s.type === 'observation');
        expect(observation.content).toMatch(/not found/i);
        expect(observation.toolOutput).toEqual({ found: false });
    });

    it('is a no-op branch when longTermMemory is not configured', async () => {
        const deps = makeDeps(undefined);
        const messages: Message[] = [];
        const toolCall = { id: 'call-3', function: { name: 'memory_read', arguments: '{}' } };

        // 没有匹配分支时函数体直接结束，不 yield 任何 step，也不 push 任何 message
        const steps = await drain(handleBuiltinToolCall(toolCall, { category: 'user', topic: 'x' }, makeContext(), deps, messages));
        expect(steps).toEqual([]);
        expect(messages).toEqual([]);
    });
});
