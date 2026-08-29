import { describe, expect, it } from 'vitest';
import { appendMessageRequestSchema } from './conversations.js';
import { acceptRunResponseSchema, runEventEnvelopeSchema } from './runs.js';

describe('Run Walking Skeleton contracts', () => {
  it('preserves non-empty employee text without accepting whitespace-only input', () => {
    expect(appendMessageRequestSchema.parse({
      parts: [{ type: 'text', text: '  keep my spacing  ' }],
    }).parts[0].text).toBe('  keep my spacing  ');
    expect(appendMessageRequestSchema.safeParse({
      parts: [{ type: 'text', text: '   ' }],
    }).success).toBe(false);
  });

  it('describes an asynchronously accepted Run with its Event stream URL', () => {
    expect(acceptRunResponseSchema.parse({
      runId: '00000000-0000-4000-8000-000000000002',
      eventsUrl: '/api/v1/runs/00000000-0000-4000-8000-000000000002/events',
    })).toEqual({
      runId: '00000000-0000-4000-8000-000000000002',
      eventsUrl: '/api/v1/runs/00000000-0000-4000-8000-000000000002/events',
    });
  });

  it('requires a positive replay sequence', () => {
    const result = runEventEnvelopeSchema.safeParse({
      schemaVersion: 1,
      eventId: '00000000-0000-4000-8000-000000000001',
      runId: '00000000-0000-4000-8000-000000000002',
      sequence: 0,
      type: 'run.accepted',
      timestamp: '2026-01-01T00:00:00.000Z',
      correlationId: '00000000-0000-4000-8000-000000000002',
      data: {},
    });
    expect(result.success).toBe(false);
  });
});
