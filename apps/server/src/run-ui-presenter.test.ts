import type { RunEventEnvelope, RunSnapshot } from '@cmaster/execution';
import { describe, expect, it } from 'vitest';
import {
  buildRunUiProjectionSnapshot,
  projectRunEvent,
} from './run-ui-presenter.js';

const runId = '10000000-0000-4000-8000-000000000001' as RunSnapshot['id'];
const messageId = '10000000-0000-4000-8000-000000000010';

function event(
  sequence: number,
  type: RunEventEnvelope['type'],
  data: Record<string, unknown> = {},
): RunEventEnvelope {
  return {
    schemaVersion: 1,
    eventId: `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}` as RunEventEnvelope['eventId'],
    runId,
    sequence,
    type,
    timestamp: new Date(Date.UTC(2026, 0, 1) + sequence * 1_000),
    correlationId: runId,
    data,
  };
}

const snapshot = {
  id: runId,
  conversationId: '10000000-0000-4000-8000-000000000030',
  trigger: { type: 'message', messageId },
  status: 'running',
  cancellable: true,
  lastSequence: 8,
  agentRevisionId: '10000000-0000-4000-8000-000000000020',
  activeInterrupt: undefined,
} as unknown as RunSnapshot;

describe('Run UI Presenter', () => {
  it('rebuilds only the current Assistant Draft generation after fallback reset', () => {
    const projected = buildRunUiProjectionSnapshot(snapshot, [
      event(1, 'invocation.output_started', { generation: 1 }),
      event(2, 'invocation.output_delta', { generation: 1, text: 'discarded secret' }),
      event(3, 'invocation.output_reset', { generation: 2, reason: 'fallback' }),
      event(4, 'model.fallback_selected', { displayName: 'Fallback model' }),
      event(5, 'invocation.output_delta', { generation: 2, text: 'Current ' }),
      event(6, 'invocation.output_delta', { generation: 2, text: 'draft' }),
    ]);

    expect(projected.draft).toEqual({ generation: 2, text: 'Current draft', state: 'streaming' });
    expect(JSON.stringify(projected)).not.toContain('discarded secret');
    expect(projected.timeline.some((item) => item.category === 'fallback')).toBe(true);
  });

  it('bounds the recent Timeline and provides an exclusive older cursor', () => {
    const events = Array.from({ length: 105 }, (_, index) => event(index + 1, 'run.queued'));
    const projected = buildRunUiProjectionSnapshot({
      ...snapshot, lastSequence: 105,
    }, events);
    expect(projected.timeline).toHaveLength(100);
    expect(projected.timeline[0]?.sequence).toBe(6);
    expect(projected).toMatchObject({ hasEarlierTimeline: true, timelineBeforeSequence: 6 });
  });

  it('clears Draft only when an immutable Assistant Message becomes available', () => {
    const projected = buildRunUiProjectionSnapshot({
      ...snapshot, status: 'succeeded', assistantMessageId: messageId as NonNullable<RunSnapshot['assistantMessageId']>,
    }, [
      event(1, 'invocation.output_started', { generation: 1 }),
      event(2, 'invocation.output_delta', { generation: 1, text: 'Final answer' }),
      event(3, 'invocation.output_completed', { generation: 1 }),
      event(4, 'assistant_message.appended', { messageId }),
      event(5, 'run.succeeded'),
    ]);
    expect(projected.draft).toBeUndefined();
    expect(projected.assistantMessageId).toBe(messageId);
    expect(projected.status).toBe('completed');
  });

  it('whitelists safe Tool fields and turns unknown activity into a calibrating fallback', () => {
    const tool = projectRunEvent(event(7, 'tool.succeeded', {
      toolCallId: 'tool-call-safe-id',
      toolName: 'cmaster.artifact.create_text',
      safeSummary: { title: 'Artifact created', details: { format: 'markdown' } },
      prompt: 'must never leave the Presenter',
      rawProviderError: 'credential-bearing response',
    }));
    expect(JSON.stringify(tool)).toContain('Artifact created');
    expect(JSON.stringify(tool)).not.toContain('must never');
    expect(JSON.stringify(tool)).not.toContain('credential-bearing');

    const artifact = projectRunEvent(event(8, 'artifact.created', {
      artifactId: '10000000-0000-4000-8000-000000000040',
      artifactVersionId: '10000000-0000-4000-8000-000000000041',
      content: 'Artifact body must stay behind the Artifact API',
    }));
    expect(artifact.changes).toContainEqual({
      type: 'artifact_available',
      artifactId: '10000000-0000-4000-8000-000000000040',
      artifactVersionId: '10000000-0000-4000-8000-000000000041',
    });
    expect(JSON.stringify(artifact)).not.toContain('Artifact body');

    const unknown = projectRunEvent(event(9, 'future.canonical.fact' as RunEventEnvelope['type'], {
      prompt: 'private',
    }));
    expect(unknown.changes).toMatchObject([{
      type: 'timeline_item_upserted',
      item: { category: 'warning', presentation: 'activity_updated' },
    }]);
    expect(JSON.stringify(unknown)).not.toContain('private');
  });
});
