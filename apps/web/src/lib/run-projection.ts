import type { RunEventContract, RunSnapshotContract } from '@cmaster/contracts';

export interface RunProjection {
  status: RunSnapshotContract['status'];
  cancellable: boolean;
  lastAppliedSequence: number;
  events: RunEventContract[];
  hasGap: boolean;
}

export function projectionFromSnapshot(snapshot: RunSnapshotContract): RunProjection {
  return {
    status: snapshot.status,
    cancellable: snapshot.cancellable,
    lastAppliedSequence: snapshot.lastSequence,
    events: [],
    hasGap: false,
  };
}

export function applyRunEvent(state: RunProjection, event: RunEventContract): RunProjection {
  if (event.sequence <= state.lastAppliedSequence) return state;
  if (event.sequence !== state.lastAppliedSequence + 1) return { ...state, hasGap: true };

  let status = state.status;
  if (event.type === 'run.queued') status = 'queued';
  if (event.type === 'run.started' || event.type === 'run.recovery_started') status = 'running';
  if (event.type === 'run.succeeded') status = 'succeeded';
  if (event.type === 'run.failed') status = 'failed';
  if (event.type === 'run.cancelled') status = 'cancelled';

  return {
    status,
    cancellable: state.cancellable
      && !['invocation.output_ready', 'run.succeeded', 'run.failed', 'run.cancelled'].includes(event.type),
    lastAppliedSequence: event.sequence,
    events: [...state.events, event],
    hasGap: false,
  };
}
