/**
 * Claude Agent SDK smoke test
 * 验证 @anthropic-ai/claude-agent-sdk 可正确调用并返回文本响应。
 *
 * 依赖：ANTHROPIC_API_KEY 环境变量。未设置时自动 skip，不 fail。
 *
 * 运行方式（单独执行）：
 *   ANTHROPIC_API_KEY=sk-... npx vitest run tests/integration/sdk-smoke.test.ts
 */
import { describe, it, expect } from 'vitest';

describe('Claude Agent SDK smoke test', () => {
  it('query() 返回文本响应（有 API key 时）', async () => {
    const hasApiKey =
      process.env.ANTHROPIC_API_KEY !== undefined &&
      process.env.ANTHROPIC_API_KEY.length > 0;

    if (!hasApiKey) {
      console.log('[sdk-smoke] ANTHROPIC_API_KEY 未设置，跳过测试');
      return;
    }

    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    let resultText: string | undefined;

    for await (const message of query({ prompt: 'What is 2+2? Reply with just the number.' })) {
      if (message.type === 'result' && message.subtype === 'success') {
        resultText = message.result;
        break;
      }
    }

    expect(resultText).toBeDefined();
    expect(typeof resultText).toBe('string');
    expect(resultText!.length).toBeGreaterThan(0);
    expect(resultText).toMatch(/4/);
  }, 60_000);
});
