import { describe, it, expect } from 'vitest';
import { InterruptRelay } from '../src/core/harness/interrupt-relay.js';
import type { ExecutionStep } from '../src/types.js';

function step(content: string): ExecutionStep {
    return { type: 'interrupt', interruptKind: 'question', content, timestamp: new Date() };
}

describe('InterruptRelay', () => {
    it('resolves next() immediately when an item is already queued (push before next)', async () => {
        const relay = new InterruptRelay();
        relay.push(step('a'));
        const result = await relay.next();
        expect(result.content).toBe('a');
    });

    it('resolves a pending next() when push() arrives later (next before push)', async () => {
        const relay = new InterruptRelay();
        const pending = relay.next();
        relay.push(step('b'));
        const result = await pending;
        expect(result.content).toBe('b');
    });

    it('preserves FIFO order across multiple pushes', async () => {
        const relay = new InterruptRelay();
        relay.push(step('1'));
        relay.push(step('2'));
        relay.push(step('3'));
        expect((await relay.next()).content).toBe('1');
        expect((await relay.next()).content).toBe('2');
        expect((await relay.next()).content).toBe('3');
    });

    it('supports interleaved push/next cycles', async () => {
        const relay = new InterruptRelay();
        const p1 = relay.next();
        relay.push(step('x'));
        expect((await p1).content).toBe('x');

        relay.push(step('y'));
        const p2 = relay.next();
        expect((await p2).content).toBe('y');
    });
});
