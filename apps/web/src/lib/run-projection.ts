import {
  runUiProjectionEventSchema,
  type RunUiProjectionEventContract,
  type RunUiProjectionSnapshotContract,
  type RunUiTimelineItemContract,
} from '@cmaster/contracts';

export interface RunProjection {
  readonly runId: string;
  readonly conversationId: string;
  readonly triggerMessageId: string;
  readonly status: RunUiProjectionSnapshotContract['status'];
  readonly cancellable: boolean;
  readonly lastAppliedSequence: number;
  readonly draft?: RunUiProjectionSnapshotContract['draft'];
  readonly assistantMessageId?: string;
  readonly activeInterrupt?: RunUiProjectionSnapshotContract['activeInterrupt'];
  readonly timeline: readonly RunUiTimelineItemContract[];
  readonly hasEarlierTimeline: boolean;
  readonly timelineBeforeSequence?: number;
  readonly technical: RunUiProjectionSnapshotContract['technical'];
  readonly artifacts: readonly { artifactId: string; artifactVersionId: string }[];
  readonly hasGap: boolean;
  readonly calibrationRequired: boolean;
}

export type DecodedRunUiProjectionEvent =
  | { readonly kind: 'known'; readonly event: RunUiProjectionEventContract }
  | { readonly kind: 'unknown'; readonly safeFallback: { readonly sequence?: number } };

export function decodeRunUiProjectionEvent(value: unknown): DecodedRunUiProjectionEvent {
  const parsed = runUiProjectionEventSchema.safeParse(value);
  if (parsed.success) return { kind: 'known', event: parsed.data };
  if (value && typeof value === 'object' && 'sequence' in value
    && typeof value.sequence === 'number' && Number.isInteger(value.sequence)
    && value.sequence > 0) {
    return { kind: 'unknown', safeFallback: { sequence: value.sequence } };
  }
  return { kind: 'unknown', safeFallback: {} };
}

export function projectionFromSnapshot(snapshot: RunUiProjectionSnapshotContract): RunProjection {
  return {
    runId: snapshot.runId,
    conversationId: snapshot.conversationId,
    triggerMessageId: snapshot.triggerMessageId,
    status: snapshot.status,
    cancellable: snapshot.cancellable,
    lastAppliedSequence: snapshot.lastSequence,
    ...(snapshot.draft ? { draft: snapshot.draft } : {}),
    ...(snapshot.assistantMessageId ? { assistantMessageId: snapshot.assistantMessageId } : {}),
    ...(snapshot.activeInterrupt ? { activeInterrupt: snapshot.activeInterrupt } : {}),
    timeline: snapshot.timeline,
    hasEarlierTimeline: snapshot.hasEarlierTimeline,
    ...(snapshot.timelineBeforeSequence
      ? { timelineBeforeSequence: snapshot.timelineBeforeSequence } : {}),
    technical: snapshot.technical,
    artifacts: [],
    hasGap: false,
    calibrationRequired: false,
  };
}

export function replaceProjectionSnapshot(
  _state: RunProjection,
  snapshot: RunUiProjectionSnapshotContract,
): RunProjection {
  return projectionFromSnapshot(snapshot);
}

function upsertTimeline(
  timeline: readonly RunUiTimelineItemContract[],
  item: RunUiTimelineItemContract,
): readonly RunUiTimelineItemContract[] {
  const withoutPrevious = timeline.filter((current) => current.id !== item.id);
  return [...withoutPrevious, item]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-100);
}

export function applyRunUiProjectionEvent(
  state: RunProjection,
  event: RunUiProjectionEventContract,
): RunProjection {
  if (event.runId !== state.runId) return { ...state, calibrationRequired: true };
  if (event.sequence <= state.lastAppliedSequence) return state;
  if (event.sequence !== state.lastAppliedSequence + 1) {
    return { ...state, hasGap: true, calibrationRequired: true };
  }

  let next: RunProjection = {
    ...state,
    lastAppliedSequence: event.sequence,
    hasGap: false,
  };
  for (const change of event.changes) {
    switch (change.type) {
      case 'projection_advanced':
        break;
      case 'status_changed':
        next = {
          ...next,
          status: change.status,
          cancellable: change.cancellable,
          ...(['failed', 'cancelled'].includes(change.status) ? { draft: undefined } : {}),
        };
        break;
      case 'assistant_draft_started':
        next = {
          ...next,
          draft: { generation: change.generation, text: '', state: 'streaming' },
        };
        break;
      case 'assistant_draft_appended':
        if (next.draft?.generation !== change.generation) {
          next = { ...next, calibrationRequired: true };
          break;
        }
        next = { ...next, draft: { ...next.draft, text: `${next.draft.text}${change.text}` } };
        break;
      case 'assistant_draft_reset':
        next = {
          ...next,
          draft: { generation: change.generation, text: '', state: 'streaming' },
        };
        break;
      case 'assistant_draft_completed':
        if (next.draft?.generation === change.generation) {
          next = { ...next, draft: { ...next.draft, state: 'complete' } };
        }
        break;
      case 'assistant_draft_cleared':
        next = { ...next, draft: undefined };
        break;
      case 'timeline_item_upserted':
        next = { ...next, timeline: upsertTimeline(next.timeline, change.item) };
        break;
      case 'active_interrupt_changed':
        next = { ...next, activeInterrupt: change.interrupt ?? undefined };
        break;
      case 'assistant_message_available':
        next = { ...next, assistantMessageId: change.messageId, draft: undefined };
        break;
      case 'artifact_available':
        if (!next.artifacts.some((artifact) => artifact.artifactVersionId === change.artifactVersionId)) {
          next = {
            ...next,
            artifacts: [...next.artifacts, {
              artifactId: change.artifactId,
              artifactVersionId: change.artifactVersionId,
            }],
          };
        }
        break;
    }
  }
  return next;
}

export function requireProjectionCalibration(state: RunProjection): RunProjection {
  return { ...state, calibrationRequired: true };
}
