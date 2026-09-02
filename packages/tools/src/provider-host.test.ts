import type { ToolProviderRequest } from './types.js';
import { describe, expect, it } from 'vitest';
import { DevelopmentProviderHostFixture } from './provider-host.js';

function request(input: unknown): ToolProviderRequest {
  return {
    toolCallId: 'tool-call' as ToolProviderRequest['toolCallId'],
    revision: {
      revisionId: 'revision' as ToolProviderRequest['revision']['revisionId'],
      capabilityId: 'fixture.provider:v1',
      name: 'provider_fixture',
      description: 'fixture',
      inputSchema: {},
      outputSchema: {},
      effect: 'read_only',
      recovery: 'retry_same_call',
      risks: [],
    },
    runId: 'run',
    invocationId: 'invocation',
    input,
    idempotencyKey: 'stable-key',
    credentialLease: {
      id: 'lease' as ToolProviderRequest['credentialLease']['id'],
      organizationId: 'organization' as ToolProviderRequest['credentialLease']['organizationId'],
      principalId: 'principal' as ToolProviderRequest['credentialLease']['principalId'],
      toolCallId: 'tool-call' as ToolProviderRequest['toolCallId'],
      invocationId: 'invocation',
      allowedOperations: ['fixture.provider:v1'],
      expiresAt: new Date(Date.now() + 60_000),
      values: { secret: 'must-not-cross-process' },
    },
    signal: new AbortController().signal,
  };
}

describe('DevelopmentProviderHostFixture', () => {
  it('isolates a child Provider crash and remains usable for the next dispatch', async () => {
    const host = new DevelopmentProviderHostFixture('test');
    await expect(host.execute(request({ fixtureBehavior: 'crash' })))
      .rejects.toThrow('exited unexpectedly');
    await expect(host.execute(request({ value: 'still alive' }))).resolves.toMatchObject({
      kind: 'success',
      value: { echoed: 'still alive' },
    });
  });

  it('cannot be enabled in production', () => {
    expect(() => new DevelopmentProviderHostFixture('production')).toThrow('cannot run in production');
  });
});
