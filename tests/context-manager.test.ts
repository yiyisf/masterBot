import { describe, it, expect, vi } from 'vitest';
import { ContextManager } from '../src/core/context-manager.js';
import type { Message, LLMAdapter } from '../src/types.js';

const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

function createManager(maxTokens = 1000) {
    return new ContextManager({
        maxTokens,
        reservedTokens: 100,
        logger: mockLogger,
    });
}

function makeMessage(role: Message['role'], content: string): Message {
    return { role, content };
}

describe('ContextManager', () => {
    describe('estimateTokens', () => {
        it('should estimate tokens based on content length', () => {
            const cm = createManager();
            const messages: Message[] = [
                makeMessage('user', 'Hello world'),
            ];
            const tokens = cm.estimateTokens(messages);
            expect(tokens).toBeGreaterThan(0);
            expect(tokens).toBe(Math.ceil('Hello world'.length / 3));
        });

        it('should include toolCalls in token estimate', () => {
            const cm = createManager();
            const msg: Message = {
                role: 'assistant',
                content: 'Calling tool',
                toolCalls: [{
                    id: '1',
                    type: 'function',
                    function: { name: 'test', arguments: '{"a":"b"}' },
                }],
            };
            const withTools = cm.estimateTokens([msg]);
            const withoutTools = cm.estimateTokens([{ ...msg, toolCalls: undefined }]);
            expect(withTools).toBeGreaterThan(withoutTools);
        });
    });

    describe('trimMessages', () => {
        it('should return all messages when within budget', async () => {
            const cm = createManager(10000);
            const system = makeMessage('system', 'You are helpful');
            const history = [
                makeMessage('user', 'Hi'),
                makeMessage('assistant', 'Hello!'),
            ];
            const current = [makeMessage('user', 'New question')];

            const result = await cm.trimMessages(system, history, current);

            expect(result).toHaveLength(4); // system + 2 history + current
            expect(result[0].role).toBe('system');
            expect(result[1].content).toBe('Hi');
            expect(result[3].content).toBe('New question');
        });

        it('should trim when history exceeds budget', async () => {
            // Very small budget to force trimming
            const cm = createManager(200);
            const system = makeMessage('system', 'System prompt');
            const history: Message[] = [];
            for (let i = 0; i < 20; i++) {
                history.push(makeMessage('user', `Question ${i}: ${'x'.repeat(50)}`));
                history.push(makeMessage('assistant', `Answer ${i}: ${'y'.repeat(50)}`));
            }
            const current = [makeMessage('user', 'Latest')];

            const result = await cm.trimMessages(system, history, current);

            // Should be fewer messages than original
            expect(result.length).toBeLessThan(history.length + 2);
            // Should keep system and current
            expect(result[0].role).toBe('system');
            expect(result[result.length - 1].content).toBe('Latest');
        });

        it('should generate LLM summary when adapter provided', async () => {
            const cm = createManager(200);
            const system = makeMessage('system', 'System');

            const mockLLM: Partial<LLMAdapter> = {
                chat: vi.fn().mockResolvedValue({
                    role: 'assistant',
                    content: 'Summary of conversation about greetings',
                }),
            };

            const history: Message[] = [];
            for (let i = 0; i < 20; i++) {
                history.push(makeMessage('user', `Long message ${i}: ${'x'.repeat(100)}`));
                history.push(makeMessage('assistant', `Long reply ${i}: ${'y'.repeat(100)}`));
            }
            const current = [makeMessage('user', 'New')];

            const result = await cm.trimMessages(system, history, current, mockLLM as LLMAdapter);

            // Should have called LLM for summary
            expect(mockLLM.chat).toHaveBeenCalled();
            // Should contain a summary message
            const summaryMsg = result.find(m =>
                typeof m.content === 'string' && m.content.includes('摘要')
            );
            expect(summaryMsg).toBeDefined();
        });

        it('should use fallback summary when LLM fails', async () => {
            const cm = createManager(200);
            const system = makeMessage('system', 'System');

            const mockLLM: Partial<LLMAdapter> = {
                chat: vi.fn().mockRejectedValue(new Error('LLM error')),
            };

            const history: Message[] = [];
            for (let i = 0; i < 20; i++) {
                history.push(makeMessage('user', `Message ${i}: ${'x'.repeat(100)}`));
                history.push(makeMessage('assistant', `Reply ${i}: ${'y'.repeat(100)}`));
            }
            const current = [makeMessage('user', 'New')];

            const result = await cm.trimMessages(system, history, current, mockLLM as LLMAdapter);

            // Should still work with fallback
            expect(result.length).toBeGreaterThan(0);
            expect(result[0].role).toBe('system');
        });

        it('should handle empty history', async () => {
            const cm = createManager();
            const system = makeMessage('system', 'System');
            const current = [makeMessage('user', 'First message')];

            const result = await cm.trimMessages(system, [], current);

            expect(result).toHaveLength(2);
            expect(result[0].role).toBe('system');
            expect(result[1].content).toBe('First message');
        });
    });
});
