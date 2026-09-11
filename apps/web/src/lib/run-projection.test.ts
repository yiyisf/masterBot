import { describe, expect, it } from 'vitest';
import type {
  RunUiProjectionEventContract,
  RunUiProjectionSnapshotContract,
} from '@cmaster/contracts';
import {
  applyRunUiProjectionEvent,
  decodeRunUiProjectionEvent,
  projectionFromSnapshot,
  replaceProjectionSnapshot,
} from './run-projection.js';

const runId = '10000000-0000-4000-8000-000000000001';
const timelineItem = {
  id: '10000000-0000-4000-8000-000000000002',
  sequence: 4,
  category: 'agent' as const,
  presentation: 'agent_started' as const,
  occurredAt: '2026-01-01T00:00:00.000Z',
};
const snapshot: RunUiProjectionSnapshotContract = {
  schemaVersion: 1,
  runId,
  conversationId: '10000000-0000-4000-8000-000000000010',
  triggerMessageId: '10000000-0000-4000-8000-000000000011',
  status: 'working',
  cancellable: true,
  lastSequence: 4,
  draft: { generation: 1, text: 'Old draft', state: 'streaming' },
  timeline: [timelineItem],
  hasEarlierTimeline: false,
  technical: { correlationId: runId },
};

function event(
  sequence: number,
  changes: RunUiProjectionEventContract['changes'],
): RunUiProjectionEventContract {
  return {
    schemaVersion: 1,
    eventId: `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    runId,
    sequence,
    type: 'projection.updated',
    changes,
  };
}

describe('Run UI Projection reducer', () => {
  it('ignores duplicate delivery and detects a sequence gap', () => {
    const state = projectionFromSnapshot(snapshot);
    expect(applyRunUiProjectionEvent(state, event(4, [{ type: 'projection_advanced' }]))).toBe(state);
    expect(applyRunUiProjectionEvent(state, event(6, [{ type: 'projection_advanced' }])))
      .toMatchObject({ lastAppliedSequence: 4, hasGap: true, calibrationRequired: true });
  });

  it('discards the previous generation on reset and localizes following deltas', () => {
    const reset = applyRunUiProjectionEvent(projectionFromSnapshot(snapshot), event(5, [{
      type: 'assistant_draft_reset', generation: 2, reason: 'fallback',
    }]));
    expect(reset.draft).toEqual({ generation: 2, text: '', state: 'streaming' });
    const appended = applyRunUiProjectionEvent(reset, event(6, [{
      type: 'assistant_draft_appended', generation: 2, text: 'Replacement',
    }]));
    expect(appended.draft?.text).toBe('Replacement');
    expect(appended.draft?.text).not.toContain('Old draft');
  });

  it('replaces Draft with immutable Message availability and clears partial terminal output', () => {
    const delivered = applyRunUiProjectionEvent(projectionFromSnapshot(snapshot), event(5, [
      { type: 'assistant_message_available', messageId: '10000000-0000-4000-8000-000000000003' },
      { type: 'assistant_draft_cleared', reason: 'message_available' },
    ]));
    expect(delivered).toMatchObject({
      assistantMessageId: '10000000-0000-4000-8000-000000000003', draft: undefined,
    });
    const failed = applyRunUiProjectionEvent(projectionFromSnapshot(snapshot), event(5, [
      { type: 'status_changed', status: 'failed', cancellable: false },
      { type: 'assistant_draft_cleared', reason: 'failed' },
    ]));
    expect(failed.draft).toBeUndefined();
  });

  it('calibrates unknown Projection types and replaces state from a fresh Snapshot', () => {
    const decoded = decodeRunUiProjectionEvent({
      schemaVersion: 2, runId, sequence: 5, type: 'future.projection', data: { private: 'ignored' },
    });
    expect(decoded.kind).toBe('unknown');
    if (decoded.kind !== 'unknown') throw new Error('Expected unknown Projection event');
    expect(decoded.safeFallback).toEqual({ sequence: 5 });

    const stale = { ...projectionFromSnapshot(snapshot), hasGap: true, calibrationRequired: true };
    const replacement = replaceProjectionSnapshot(stale, { ...snapshot, lastSequence: 8, draft: undefined });
    expect(replacement).toMatchObject({
      lastAppliedSequence: 8, hasGap: false, calibrationRequired: false,
    });
  });
});
