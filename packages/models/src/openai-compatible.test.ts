import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OrganizationId } from '@cmaster/identity';
import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { OpenAICompatibleModelAdapter } from './openai-compatible.js';
import { modelProfileId, type ModelAdapterEvent, type ModelProfile } from './types.js';

function apiError(statusCode: number, responseBody?: string): APICallError {
  return new APICallError({
    message: 'provider failure',
    url: 'https://models.example.test/v1/responses',
    requestBodyValues: {},
    statusCode,
    ...(responseBody === undefined ? {} : { responseBody }),
  });
}

describe('OpenAICompatibleModelAdapter error classification', () => {
  const adapter = new OpenAICompatibleModelAdapter();

  it('does not allow fallback for authentication and context failures', () => {
    expect(adapter.classifyError(apiError(401), false)).toMatchObject({
      code: 'authentication_failed', retryable: false,
    });
    expect(adapter.classifyError(apiError(400, '{"code":"context_length_exceeded"}'), false)).toMatchObject({
      code: 'context_length_exceeded', retryable: false,
    });
  });

  it('allows fallback for rate limits and interrupted streams', () => {
    expect(adapter.classifyError(apiError(429), false)).toMatchObject({
      code: 'rate_limited', retryable: true,
    });
    expect(adapter.classifyError(new Error('socket ended'), true)).toMatchObject({
      code: 'stream_interrupted', retryable: true,
    });
  });

  it('streams text and normalized usage through the OpenAI-compatible Chat API', async () => {
    let requestPath: string | undefined;
    let authorization: string | undefined;
    const server = createServer((request, response) => {
      requestPath = request.url;
      authorization = request.headers.authorization;
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        connection: 'keep-alive',
      });
      const base = { id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'test-model' };
      response.write(`data: ${JSON.stringify({
        ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'hello' }, finish_reason: null }],
      })}\n\n`);
      response.write(`data: ${JSON.stringify({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as AddressInfo;
      const profile: ModelProfile = {
        id: modelProfileId('00000000-0000-4000-8000-000000000006'),
        organizationId: '00000000-0000-4000-8000-000000000001' as OrganizationId,
        displayName: 'Test Model',
        routeRole: 'primary',
        providerKind: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        providerModelId: 'test-model',
        credentialRef: 'env:test',
        capabilities: { streamingText: true },
        dataHandlingTier: 'test',
        costTier: 'test',
      };
      const events: ModelAdapterEvent[] = [];
      for await (const event of adapter.stream({
        profile,
        apiKey: 'test-secret',
        prompt: 'not persisted',
        signal: new AbortController().signal,
      })) events.push(event);
      expect(requestPath).toBe('/v1/chat/completions');
      expect(authorization).toBe('Bearer test-secret');
      expect(events).toEqual([
        { type: 'text_delta', text: 'hello' },
        { type: 'completed', usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
