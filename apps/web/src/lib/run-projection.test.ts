import { describe, expect, it } from 'vitest';
import type { RunEventContract, RunSnapshotContract } from '@cmaster/contracts';
import { applyRunEvent, projectionFromSnapshot } from './run-projection.js';

const snapshot = {
  status: 'running', cancellable: true, lastSequence: 4,
} as RunSnapshotContract;
const event = (sequence: number, type: string): RunEventContract => ({
  schemaVersion: 1,
  eventId: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
  runId: '00000000-0000-4000-8000-000000000100',
  sequence,
  type,
  timestamp: '2026-01-01T00:00:00.000Z',
  correlationId: '00000000-0000-4000-8000-000000000100',
  data: {},
});

describe('RunProjection', () => {
  it('ignores duplicate events', () => {
    const state = projectionFromSnapshot(snapshot);
    expect(applyRunEvent(state, event(4, 'run.started'))).toBe(state);
  });

  it('detects a sequence gap without applying the event', () => {
    const state = applyRunEvent(projectionFromSnapshot(snapshot), event(6, 'run.succeeded'));
    expect(state).toMatchObject({ status: 'running', lastAppliedSequence: 4, hasGap: true });
  });

  it('applies ordered terminal events', () => {
    const state = applyRunEvent(projectionFromSnapshot(snapshot), event(5, 'run.succeeded'));
    expect(state).toMatchObject({ status: 'succeeded', cancellable: false, lastAppliedSequence: 5 });
  });

  it('keeps an unknown additive event in the generic timeline', () => {
    const state = applyRunEvent(projectionFromSnapshot(snapshot), event(5, 'future.event'));
    expect(state).toMatchObject({ status: 'running', lastAppliedSequence: 5, hasGap: false });
    expect(state.events[0]?.type).toBe('future.event');
  });

  it('restores confirmation and uncertain-review actions from a waiting Snapshot', () => {
    const confirmation = projectionFromSnapshot({
      ...snapshot,
      status: 'waiting',
      activeInterrupt: {
        id: '00000000-0000-4000-8000-000000000010',
        kind: 'tool_confirmation',
        status: 'pending',
        safeSubjectSummary: { title: 'Confirm HTTPS fetch', details: { host: 'example.test' } },
        allowedResponses: ['confirm', 'reject'],
      },
    });
    expect(confirmation).toMatchObject({
      status: 'waiting',
      activeInterrupt: { allowedResponses: ['confirm', 'reject'] },
    });

    const outcomeReview = projectionFromSnapshot({
      ...snapshot,
      status: 'waiting',
      activeInterrupt: {
        id: '00000000-0000-4000-8000-000000000011',
        kind: 'tool_outcome_review',
        status: 'pending',
        safeSubjectSummary: { title: 'Review unknown effect', details: {} },
        allowedResponses: ['continue_with_uncertainty'],
      },
    });
    expect(outcomeReview.activeInterrupt?.allowedResponses)
      .toEqual(['continue_with_uncertainty']);
  });

  it('projects waiting and resolved Interrupt lifecycle events', () => {
    const waiting = applyRunEvent(
      projectionFromSnapshot(snapshot),
      event(5, 'run.waiting'),
    );
    expect(waiting.status).toBe('waiting');
    const resolved = applyRunEvent(waiting, event(6, 'interrupt.resolved'));
    expect(resolved.activeInterrupt).toBeUndefined();
    expect(applyRunEvent(resolved, event(7, 'run.resumed')).status).toBe('queued');
  });

  it('stops cancellation once output is ready', () => {
    const state = applyRunEvent(projectionFromSnapshot(snapshot), event(5, 'invocation.output_ready'));
    expect(state.cancellable).toBe(false);
  });
});
