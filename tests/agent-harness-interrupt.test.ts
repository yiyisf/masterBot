/**
 * 研发流程管理执行层基座：AgentHarness 在收到 interrupt 步骤时
 * 应该 emit('interrupt_raised', ...) 写入 session_events（"raised"一半，
 * "resolved"一半由 interrupt-coordinator.ts 的 resolveInterrupt/cancelInterrupt 写）。
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentHarness } from '../src/core/harness/agent-harness.js';
import { defaultAgentSpec } from '../src/core/harness/agent-spec.js';
import { SkillRegistry } from '../src/skills/registry.js';
import type { Logger, MemoryAccess } from '../src/types.js';

function makeLogger(): Logger {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeLLM() {
    return {
        provider: 'mock',
        chat: vi.fn().mockResolvedValue({ role: 'assistant', content: 'mock answer' }),
        chatStream: vi.fn(),
        embeddings: vi.fn().mockResolvedValue([[]]),
    };
}

function makeMemory(): MemoryAccess {
    return { get: async () => undefined, set: async () => {}, search: async () => [] };
}

describe('AgentHarness: interrupt step → emit interrupt_raised', () => {
    it('emits interrupt_raised with interruptId/interruptKind/reason when the engine yields an interrupt step', async () => {
        const logger = makeLogger();
        const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', description: 'test', systemPrompt: 'x' });
        const emitEvent = vi.fn().mockReturnValue('evt-1');

        const harness = new AgentHarness(
            spec,
            () => makeLLM() as any,
            new SkillRegistry(logger),
            logger,
            undefined,
            undefined,
            undefined,
            emitEvent
        );

        (harness as any).engine = {
            run: async function* () {
                yield {
                    type: 'interrupt',
                    interruptKind: 'question',
                    interruptId: 'int-1',
                    interruptReason: '要不要用 PostgreSQL？',
                    content: '要不要用 PostgreSQL？',
                    timestamp: new Date(),
                };
                yield { type: 'answer', content: 'done', timestamp: new Date() };
            },
        };

        const steps: any[] = [];
        for await (const s of harness.execute('task', { sessionId: 's1', memory: makeMemory() })) steps.push(s);

        const raisedCalls = emitEvent.mock.calls.filter(c => c[0] === 'interrupt_raised');
        expect(raisedCalls).toHaveLength(1);
        expect(raisedCalls[0][1]).toMatchObject({
            interruptId: 'int-1',
            interruptKind: 'question',
            reason: '要不要用 PostgreSQL？',
        });
    });

    it('does not emit interrupt_raised for non-interrupt steps', async () => {
        const logger = makeLogger();
        const spec = defaultAgentSpec({ id: 'coder', name: 'Coder', description: 'test', systemPrompt: 'x' });
        const emitEvent = vi.fn().mockReturnValue('evt-1');

        const harness = new AgentHarness(
            spec,
            () => makeLLM() as any,
            new SkillRegistry(logger),
            logger,
            undefined,
            undefined,
            undefined,
            emitEvent
        );

        (harness as any).engine = {
            run: async function* () {
                yield { type: 'content', content: 'hi', timestamp: new Date() };
                yield { type: 'answer', content: 'done', timestamp: new Date() };
            },
        };

        const steps: any[] = [];
        for await (const s of harness.execute('task', { sessionId: 's2', memory: makeMemory() })) steps.push(s);

        expect(emitEvent.mock.calls.some(c => c[0] === 'interrupt_raised')).toBe(false);
    });
});
