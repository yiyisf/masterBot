import { describe, expect, it } from 'vitest';
import { EchoAgentEngine } from './engine.js';
import type { OrganizationId } from '@cmaster/identity';
import type { InvocationId, RunId } from './types.js';

describe('EchoAgentEngine', () => {
  it('returns the employee input unchanged', async () => {
    const events = [];
    for await (const event of new EchoAgentEngine().execute(
      {
        organizationId: '00000000-0000-4000-8000-000000000001' as OrganizationId,
        runId: '00000000-0000-4000-8000-000000000002' as RunId,
        invocationId: '00000000-0000-4000-8000-000000000003' as InvocationId,
        prompt: 'hello',
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: 'text_delta', text: 'hello' },
      { type: 'completed' },
    ]);
  });
});
