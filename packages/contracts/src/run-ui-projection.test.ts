import { describe, expect, it } from 'vitest';
import {
  runUiProjectionEventSchema,
  runUiProjectionSnapshotSchema,
  runUiTimelinePageSchema,
} from './run-ui-projection.js';

const runId = '10000000-0000-4000-8000-000000000001';
const eventId = '10000000-0000-4000-8000-000000000002';

describe('Run UI Projection contracts', () => {
  it('bounds a recoverable Snapshot with temporary Draft and safe Timeline', () => {
    const snapshot = runUiProjectionSnapshotSchema.parse({
      schemaVersion: 1,
      runId,
      conversationId: '10000000-0000-4000-8000-000000000003',
      triggerMessageId: '10000000-0000-4000-8000-000000000004',
      status: 'working',
      cancellable: true,
      lastSequence: 12,
      draft: { generation: 2, text: 'Draft output', state: 'streaming' },
      timeline: [{
        id: eventId,
        sequence: 10,
        category: 'agent',
        presentation: 'agent_started',
        occurredAt: '2026-01-01T00:00:00.000Z',
      }],
      hasEarlierTimeline: false,
      technical: { correlationId: runId },
    });
    expect(snapshot.draft?.text).toBe('Draft output');
    expect(snapshot.timeline).toHaveLength(1);
    expect(() => runUiProjectionSnapshotSchema.parse({
      ...snapshot,
      timeline: Array.from({ length: 101 }, () => snapshot.timeline[0]),
    })).toThrow();
  });

  it('uses Run sequence for a closed set of safe Projection changes', () => {
    const projected = runUiProjectionEventSchema.parse({
      schemaVersion: 1,
      eventId,
      runId,
      sequence: 13,
      type: 'projection.updated',
      changes: [
        { type: 'assistant_draft_appended', generation: 2, text: ' more' },
        {
          type: 'timeline_item_upserted',
          item: {
            id: eventId,
            sequence: 13,
            category: 'tool',
            presentation: 'tool_running',
            occurredAt: '2026-01-01T00:00:01.000Z',
            tool: { capability: 'unknown', status: 'running' },
          },
        },
      ],
    });
    expect(projected.sequence).toBe(13);
    expect(JSON.stringify(projected)).not.toContain('canonicalPayload');
  });

  it('pages older Timeline items with an exclusive sequence cursor', () => {
    expect(runUiTimelinePageSchema.parse({
      items: [], beforeSequence: 51,
    })).toEqual({ items: [], beforeSequence: 51 });
  });
});
