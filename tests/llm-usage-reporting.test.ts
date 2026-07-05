import { describe, it, expect, vi, beforeEach } from 'vitest';

// P1-7: LLM 适配器不再直接写 DB，改为通过构造函数注入的 onUsage 回调上报用量。
// mock 底层 SDK 客户端，验证适配器把 SDK 原始 usage 归一化为 TokenUsageEvent 后正确回调。

const openaiCreateMock = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
    default: class {
        chat = { completions: { create: openaiCreateMock } };
    },
}));

const anthropicCreateMock = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', () => ({
    default: class {
        messages = { create: anthropicCreateMock };
    },
}));

import { OpenAIAdapter } from '../src/llm/openai.js';
import { AnthropicAdapter } from '../src/llm/anthropic.js';
import type { LLMConfig } from '../src/types.js';

const baseConfig: LLMConfig = {
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
};

describe('LLM adapters: token usage reporting via onUsage callback (P1-7)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('OpenAIAdapter reports normalized usage after chat()', async () => {
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: 'hi', tool_calls: undefined } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });

        const onUsage = vi.fn();
        const adapter = new OpenAIAdapter(baseConfig, onUsage);
        await adapter.chat([{ role: 'user', content: 'hello' }]);

        expect(onUsage).toHaveBeenCalledTimes(1);
        expect(onUsage).toHaveBeenCalledWith({
            model: 'gpt-4o-mini',
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
        });
    });

    it('OpenAIAdapter does not throw when no onUsage is provided', async () => {
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: 'hi', tool_calls: undefined } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });

        const adapter = new OpenAIAdapter(baseConfig);
        await expect(adapter.chat([{ role: 'user', content: 'hello' }])).resolves.toBeTruthy();
    });

    it('OpenAIAdapter swallows a throwing onUsage callback without failing the chat call', async () => {
        openaiCreateMock.mockResolvedValue({
            choices: [{ message: { content: 'hi', tool_calls: undefined } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });

        const onUsage = vi.fn(() => { throw new Error('db down'); });
        const adapter = new OpenAIAdapter(baseConfig, onUsage);
        const result = await adapter.chat([{ role: 'user', content: 'hello' }]);
        expect(result.content).toBe('hi');
    });

    it('AnthropicAdapter reports normalized usage after chat()', async () => {
        anthropicCreateMock.mockResolvedValue({
            content: [{ type: 'text', text: 'hi' }],
            usage: { input_tokens: 20, output_tokens: 8 },
        });

        const onUsage = vi.fn();
        const adapter = new AnthropicAdapter(
            { type: 'anthropic', baseUrl: '', apiKey: 'k', model: 'claude-opus-4' },
            onUsage
        );
        await adapter.chat([{ role: 'user', content: 'hello' }]);

        expect(onUsage).toHaveBeenCalledWith({
            model: 'claude-opus-4',
            promptTokens: 20,
            completionTokens: 8,
            totalTokens: 28,
        });
    });
});
