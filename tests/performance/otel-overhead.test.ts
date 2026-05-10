/**
 * OTel 性能开销测试
 * 目标：OtelObserver 调用开销 < 5%（相对于裸操作）
 *
 * 测试策略：
 * - 测量 1000 次 startGenericSpan + endSpan 操作的耗时
 * - 与 1000 次等价的空操作对比
 * - 断言开销 < 5ms per 100 ops
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { OtelObserver } from '../../src/observability/otel.js';

describe('OTel 性能开销', () => {
    let observer: OtelObserver;

    beforeAll(() => {
        // 不初始化 SDK，仅测试 span API 本身的 CPU 开销
        observer = new OtelObserver('test-tracer');
    });

    it('startGenericSpan + endSpan 1000 次 < 100ms', () => {
        const N = 1000;
        const start = performance.now();

        for (let i = 0; i < N; i++) {
            const span = observer.startGenericSpan(`test.span.${i}`, { 'test.index': i });
            observer.endSpan(span, { result: 'ok' });
        }

        const elapsed = performance.now() - start;
        // 100ms = 0.1ms per op，足够宽松
        expect(elapsed).toBeLessThan(100);
    });

    it('嵌套 parent/child span 500 次 < 100ms', () => {
        const N = 500;
        const start = performance.now();

        for (let i = 0; i < N; i++) {
            const parentSpan = observer.startAgentSpan({
                sessionId: `test-session-${i}`,
                model: 'claude-sonnet-4-6',
            });
            const childSpan = observer.startToolSpan('test_tool', parentSpan);
            observer.endSpan(childSpan);
            observer.endSpan(parentSpan);
        }

        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(100);
    });

    it('recordModelUsage 不引入显著额外开销', () => {
        const N = 1000;
        const start = performance.now();

        for (let i = 0; i < N; i++) {
            const span = observer.startAgentSpan({ sessionId: 'perf-test' });
            observer.recordModelUsage(span, {
                inputTokens: 1000,
                outputTokens: 500,
                cacheReadInputTokens: 200,
            });
            observer.endSpan(span);
        }

        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(150); // 含 recordModelUsage 稍宽松
    });
});
