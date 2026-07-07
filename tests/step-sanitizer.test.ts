import { describe, it, expect } from 'vitest';
import { sanitizeStepForStream, MAX_STEP_CONTENT_CHARS, MAX_TOOL_OUTPUT_CHARS } from '../src/core/step-sanitizer.js';
import type { ExecutionStep } from '../src/types.js';

const bigText = 'x'.repeat(MAX_STEP_CONTENT_CHARS * 3);

describe('sanitizeStepForStream', () => {
    it('小步骤原样返回（引用相等）', () => {
        const step: ExecutionStep = { type: 'observation', content: 'ok', toolName: 't', timestamp: new Date() };
        expect(sanitizeStepForStream(step)).toBe(step);
    });

    it('截断超长 observation content 并标注原始长度', () => {
        const step: ExecutionStep = { type: 'observation', content: bigText, timestamp: new Date() };
        const out = sanitizeStepForStream(step);
        expect(out).not.toBe(step);
        expect(out.content.length).toBeLessThan(bigText.length);
        expect(out.content).toContain(`${bigText.length} 字符`);
    });

    it('content / answer 类型永不截断', () => {
        for (const type of ['content', 'answer'] as const) {
            const step: ExecutionStep = { type, content: bigText, timestamp: new Date() };
            expect(sanitizeStepForStream(step)).toBe(step);
        }
    });

    it('超大 toolOutput 被替换为占位对象', () => {
        const step = {
            type: 'observation',
            content: 'ok',
            toolOutput: { data: 'y'.repeat(MAX_TOOL_OUTPUT_CHARS * 2) },
            timestamp: new Date(),
        } as ExecutionStep;
        const out = sanitizeStepForStream(step) as any;
        expect(out.toolOutput._truncated).toBe(true);
        expect(out.toolOutput.originalChars).toBeGreaterThan(MAX_TOOL_OUTPUT_CHARS);
        expect(out.content).toBe('ok');
    });

    it('循环引用 toolOutput 不抛错', () => {
        const circular: any = { a: 1 };
        circular.self = circular;
        const step = { type: 'observation', content: 'ok', toolOutput: circular, timestamp: new Date() } as ExecutionStep;
        const out = sanitizeStepForStream(step) as any;
        expect(out.toolOutput._truncated).toBe(true);
        expect(() => JSON.stringify(out)).not.toThrow();
    });

    it('小 toolOutput 保持不变', () => {
        const step = { type: 'observation', content: 'ok', toolOutput: { id: 1 }, timestamp: new Date() } as ExecutionStep;
        expect(sanitizeStepForStream(step)).toBe(step);
    });
});
