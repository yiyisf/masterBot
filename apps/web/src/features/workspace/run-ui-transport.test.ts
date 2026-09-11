import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RunUiProjectionEventContract,
  RunUiProjectionSnapshotContract,
} from '@cmaster/contracts';
import { RunUiProjectionController, type ProjectionStream } from './run-ui-transport';

const runId = '10000000-0000-4000-8000-000000000001';
const snapshot = (lastSequence: number, text = 'Hel'): RunUiProjectionSnapshotContract => ({
  schemaVersion: 1,
  runId,
  conversationId: '10000000-0000-4000-8000-000000000010',
  triggerMessageId: '10000000-0000-4000-8000-000000000011',
  status: 'working',
  cancellable: true,
  lastSequence,
  draft: { generation: 1, text, state: 'streaming' },
  timeline: [],
  hasEarlierTimeline: false,
  technical: { correlationId: runId },
});
const event = (sequence: number, text: string): RunUiProjectionEventContract => ({
  schemaVersion: 1,
  eventId: `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
  runId,
  sequence,
  type: 'projection.updated',
  changes: [{ type: 'assistant_draft_appended', generation: 1, text }],
});

afterEach(() => vi.useRealTimers());

describe('Run UI Projection transport', () => {
  it('keeps one stream, ignores duplicate output, and reconnects from a calibrated Snapshot', async () => {
    const snapshots = [snapshot(4), snapshot(6, 'Recovered')];
    const loadSnapshot = vi.fn(async () => snapshots.shift()!);
    const opened: { afterSequence: number; stream: ProjectionStream }[] = [];
    let activeStreams = 0;
    let maximumStreams = 0;
    const states: string[] = [];
    const controller = new RunUiProjectionController({
      loadSnapshot,
      openStream: (_runId, afterSequence, stream) => {
        activeStreams += 1;
        maximumStreams = Math.max(maximumStreams, activeStreams);
        opened.push({ afterSequence, stream });
        return () => { activeStreams -= 1; };
      },
      onState: (state) => states.push(state.draft?.text ?? ''),
      onUnknown: vi.fn(),
    });

    await controller.start(runId);
    await controller.receive(event(5, 'lo'));
    await controller.receive(event(5, 'lo'));
    expect(states.at(-1)).toBe('Hello');

    await controller.receive(event(7, 'gap'));
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    expect(opened.map((entry) => entry.afterSequence)).toEqual([4, 6]);
    expect(maximumStreams).toBe(1);
    expect(states.at(-1)).toBe('Recovered');
    controller.stop();
    expect(activeStreams).toBe(0);
  });

  it('retries Snapshot calibration after a disconnected stream', async () => {
    vi.useFakeTimers();
    let activeStream!: ProjectionStream;
    const loadSnapshot = vi.fn()
      .mockResolvedValueOnce(snapshot(4))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(snapshot(6, 'Recovered'));
    const openStream = vi.fn((_runId: string, _afterSequence: number, stream: ProjectionStream) => {
      activeStream = stream;
      return vi.fn();
    });
    const controller = new RunUiProjectionController({
      loadSnapshot,
      openStream,
      onState: vi.fn(),
      onUnknown: vi.fn(),
    });
    await controller.start(runId);
    activeStream.onError();
    await vi.runAllTimersAsync();
    expect(loadSnapshot).toHaveBeenCalledTimes(3);
  });

  it('uses a safe unknown fallback and calibrates instead of applying unknown data', async () => {
    const onUnknown = vi.fn();
    const controller = new RunUiProjectionController({
      loadSnapshot: vi.fn()
        .mockResolvedValueOnce(snapshot(4))
        .mockResolvedValueOnce(snapshot(5, 'Authoritative')),
      openStream: vi.fn(() => vi.fn()),
      onState: vi.fn(),
      onUnknown,
    });
    await controller.start(runId);
    await controller.receive({
      schemaVersion: 2, runId, sequence: 5,
      type: 'future.projection', data: { raw: 'must be ignored' },
    });
    expect(onUnknown).toHaveBeenCalledWith({ sequence: 5 });
  });
});
