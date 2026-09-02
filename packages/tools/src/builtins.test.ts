import type { ToolProviderRequest } from './types.js';
import { describe, expect, it, vi } from 'vitest';
import {
  CurrentTimeToolProvider,
  HttpsFetchToolProvider,
  TextStatisticsToolProvider,
} from './builtins.js';

const baseRequest = {
  toolCallId: 'tool-call' as ToolProviderRequest['toolCallId'],
  revision: {
    revisionId: 'revision' as ToolProviderRequest['revision']['revisionId'],
    capabilityId: 'test:v1',
    name: 'test',
    description: 'test',
    inputSchema: {},
    outputSchema: {},
    effect: 'read_only' as const,
    recovery: 'retry_same_call' as const,
    risks: [],
  },
  runId: 'run',
  invocationId: 'invocation',
  idempotencyKey: 'stable',
  credentialLease: {
    id: 'lease' as ToolProviderRequest['credentialLease']['id'],
    organizationId: 'organization' as ToolProviderRequest['credentialLease']['organizationId'],
    principalId: 'principal' as ToolProviderRequest['credentialLease']['principalId'],
    toolCallId: 'tool-call' as ToolProviderRequest['toolCallId'],
    invocationId: 'invocation',
    allowedOperations: ['test:v1'],
    expiresAt: new Date('2026-01-02T12:01:00Z'),
    values: {},
  },
  signal: new AbortController().signal,
};

describe('workflow-validation Built-in Tools', () => {
  it('returns deterministic UTC time and Unicode-aware text statistics', async () => {
    await expect(new CurrentTimeToolProvider(
      () => new Date('2026-01-02T12:00:00.000Z'),
    ).execute()).resolves.toMatchObject({
      value: { iso: '2026-01-02T12:00:00.000Z' },
    });
    await expect(new TextStatisticsToolProvider().execute({
      ...baseRequest,
      input: { text: 'hello 👋\nworld' },
    })).resolves.toMatchObject({
      value: { characters: 13, words: 3, lines: 2 },
    });
  });

  it('fetches only explicitly allowed credential-free HTTPS hosts without redirects', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('safe', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }));
    const provider = new HttpsFetchToolProvider({
      allowedHosts: ['docs.example.test'],
      fetch: fetchMock,
    });
    await expect(provider.execute({
      ...baseRequest,
      input: { url: 'https://docs.example.test/guide' },
    })).resolves.toMatchObject({
      value: { status: 200, contentType: 'text/plain', body: 'safe' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://docs.example.test/guide'),
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      accept: 'text/plain, application/json',
    });

    await expect(provider.execute({
      ...baseRequest,
      input: { url: 'http://docs.example.test/guide' },
    })).rejects.toThrow('not allowed');
    await expect(provider.execute({
      ...baseRequest,
      input: { url: 'https://other.example.test/guide' },
    })).rejects.toThrow('not allowed');

    const bounded = new HttpsFetchToolProvider({
      allowedHosts: ['docs.example.test'],
      maximumResponseBytes: 4,
      fetch: async () => new Response('five!'),
    });
    await expect(bounded.execute({
      ...baseRequest,
      input: { url: 'https://docs.example.test/large' },
    })).rejects.toThrow('too large');
  });
});
