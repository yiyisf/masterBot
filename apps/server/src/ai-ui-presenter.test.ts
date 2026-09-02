import type { RunEventEnvelope } from '@cmaster/execution';
import { describe, expect, it } from 'vitest';
import { presentRunEvent } from './ai-ui-presenter.js';

function event(
  sequence: number,
  type: RunEventEnvelope['type'],
  data: Record<string, unknown>,
): RunEventEnvelope {
  return {
    schemaVersion: 1,
    eventId: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}` as RunEventEnvelope['eventId'],
    runId: '00000000-0000-4000-8000-000000000100' as RunEventEnvelope['runId'],
    sequence,
    type,
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    correlationId: '00000000-0000-4000-8000-000000000100' as RunEventEnvelope['correlationId'],
    data,
  };
}

describe('AI SDK UI Presenter', () => {
  it('maps replayable output events to deterministic AI SDK text chunks', () => {
    const state = { generation: 0 };
    expect(presentRunEvent(event(5, 'invocation.output_started', { generation: 2 }), state)).toEqual({
      type: 'text-start', id: '00000000-0000-4000-8000-000000000100:output:2',
    });
    expect(presentRunEvent(event(6, 'invocation.output_delta', {
      generation: 2, text: 'hello',
    }), state)).toEqual({
      type: 'text-delta', id: '00000000-0000-4000-8000-000000000100:output:2', delta: 'hello',
    });
    expect(presentRunEvent(event(7, 'invocation.output_completed', { generation: 2 }), state)).toEqual({
      type: 'text-end', id: '00000000-0000-4000-8000-000000000100:output:2',
    });
  });

  it('maps terminal Run state to native AI SDK finish/error chunks', () => {
    expect(presentRunEvent(event(8, 'run.succeeded', {}), { generation: 0 })).toEqual({
      type: 'finish', finishReason: 'stop',
    });
    expect(presentRunEvent(event(9, 'run.failed', {
      failure: { message: 'Safe model failure.' },
    }), { generation: 0 })).toEqual({
      type: 'error', errorText: 'Safe model failure.',
    });
  });

  it('maps safe Tool lifecycle facts to CMaster Tool data parts', () => {
    expect(presentRunEvent(event(10, 'tool.confirmation_required', {
      toolCallId: 'tool-call-1',
      toolName: 'https_fetch',
      safeSummary: { title: 'Fetch approved host', details: { host: 'docs.example.test' } },
    }), { generation: 0 })).toMatchObject({
      type: 'data-cmaster-tool',
      data: {
        eventType: 'tool.confirmation_required',
        toolCallId: 'tool-call-1',
        toolName: 'https_fetch',
        sequence: 10,
      },
    });
  });

  it('emits an explicit reset data part instead of concatenating fallback output', () => {
    const chunk = presentRunEvent(event(10, 'invocation.output_reset', {
      generation: 3, reason: 'fallback',
    }), { generation: 2 });
    expect(chunk).toMatchObject({
      type: 'data-cmaster-output-reset',
      data: { generation: 3, reason: 'fallback', sequence: 10 },
    });
  });
});
