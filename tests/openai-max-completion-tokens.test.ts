import { describe, it, expect, vi, beforeEach } from 'vitest';

// P1-4: OpenAI 推理模型（o1/o3/o4/gpt-5 系列）已弃用 max_tokens，须用 max_completion_tokens，
// 否则请求报 400。验证适配器按模型名正确路由参数，且不会同时发送两个字段。

const openaiCreateMock = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
    default: class {
        chat = { completions: { create: openaiCreateMock } };
    },
}));

import { OpenAIAdapter } from '../src/llm/openai.js';
import type { LLMConfig } from '../src/types.js';

function makeConfig(model: string): LLMConfig {
    return { type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model };
}

describe('OpenAIAdapter: max_tokens vs max_completion_tokens routing (P1-4)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: 'ok', tool_calls: undefined } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
    });

    const reasoningModels = ['o1', 'o1-mini', 'o3-mini', 'o4-mini', 'gpt-5', 'gpt-5-mini'];
    const legacyModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'moonshot-v1-8k'];

    for (const model of reasoningModels) {
        it(`uses max_completion_tokens for reasoning model "${model}"`, async () => {
            const adapter = new OpenAIAdapter(makeConfig(model));
            await adapter.chat([{ role: 'user', content: 'hi' }], { maxTokens: 123 });

            const callArgs = openaiCreateMock.mock.calls[0][0];
            expect(callArgs.max_completion_tokens).toBe(123);
            expect(callArgs.max_tokens).toBeUndefined();
        });
    }

    for (const model of legacyModels) {
        it(`uses max_tokens for non-reasoning model "${model}"`, async () => {
            const adapter = new OpenAIAdapter(makeConfig(model));
            await adapter.chat([{ role: 'user', content: 'hi' }], { maxTokens: 456 });

            const callArgs = openaiCreateMock.mock.calls[0][0];
            expect(callArgs.max_tokens).toBe(456);
            expect(callArgs.max_completion_tokens).toBeUndefined();
        });
    }

    it('routes correctly for chatStream too', async () => {
        openaiCreateMock.mockResolvedValue((async function* () {
            yield { choices: [{ delta: {} }], usage: null };
        })());
        const adapter = new OpenAIAdapter(makeConfig('o3-mini'));
        const gen = adapter.chatStream([{ role: 'user', content: 'hi' }], { maxTokens: 77 });
        for await (const _ of gen) { /* drain */ }

        const callArgs = openaiCreateMock.mock.calls[0][0];
        expect(callArgs.max_completion_tokens).toBe(77);
        expect(callArgs.max_tokens).toBeUndefined();
    });
});
