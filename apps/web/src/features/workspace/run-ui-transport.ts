import type { RunUiProjectionSnapshotContract } from '@cmaster/contracts';
import {
  applyRunUiProjectionEvent,
  decodeRunUiProjectionEvent,
  projectionFromSnapshot,
  type RunProjection,
} from '../../lib/run-projection';

export interface ProjectionStream {
  onEvent(value: unknown): void;
  onError(): void;
}

interface RunUiProjectionControllerDependencies {
  loadSnapshot(runId: string): Promise<RunUiProjectionSnapshotContract>;
  openStream(runId: string, afterSequence: number, stream: ProjectionStream): () => void;
  onState(state: RunProjection): void;
  onUnknown(fallback: { readonly sequence?: number }): void;
}

const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);

/** 为一个已选 Run 独占 Snapshot 校准和唯一 UI Projection stream。 */
export class RunUiProjectionController {
  private state?: RunProjection;
  private closeStream?: () => void;
  private selectedRunId?: string;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly dependencies: RunUiProjectionControllerDependencies) {}

  async start(runId: string): Promise<void> {
    this.stop();
    this.selectedRunId = runId;
    const generation = this.generation;
    const snapshot = await this.dependencies.loadSnapshot(runId);
    if (generation !== this.generation || this.selectedRunId !== runId) return;
    this.state = projectionFromSnapshot(snapshot);
    this.dependencies.onState(this.state);
    this.connect();
  }

  async refresh(): Promise<RunProjection | undefined> {
    this.queue = this.queue.catch(() => undefined).then(() => this.calibrate());
    await this.queue;
    return this.state;
  }

  receive(value: unknown): Promise<void> {
    this.queue = this.queue.then(async () => {
      const state = this.state;
      if (!state) return;
      const decoded = decodeRunUiProjectionEvent(value);
      if (decoded.kind === 'unknown') {
        this.dependencies.onUnknown(decoded.safeFallback);
        await this.tryCalibrate();
        return;
      }
      const next = applyRunUiProjectionEvent(state, decoded.event);
      if (next.calibrationRequired) {
        await this.tryCalibrate();
        return;
      }
      this.state = next;
      this.dependencies.onState(next);
    });
    return this.queue;
  }

  stop(): void {
    this.generation += 1;
    this.closeStream?.();
    this.closeStream = undefined;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.selectedRunId = undefined;
    this.state = undefined;
  }

  private connect(): void {
    const state = this.state;
    const runId = this.selectedRunId;
    if (!state || !runId || terminalStatuses.has(state.status)) return;
    this.closeStream?.();
    this.closeStream = this.dependencies.openStream(runId, state.lastAppliedSequence, {
      onEvent: (value) => { void this.receive(value); },
      onError: () => {
        this.queue = this.queue.catch(() => undefined).then(() => this.tryCalibrate());
      },
    });
  }

  private async tryCalibrate(): Promise<void> {
    try {
      await this.calibrate();
    } catch {
      if (!this.selectedRunId || this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        this.queue = this.queue.catch(() => undefined).then(() => this.tryCalibrate());
      }, 1_000);
    }
  }

  private async calibrate(): Promise<void> {
    const runId = this.selectedRunId;
    if (!runId) return;
    const generation = this.generation;
    this.closeStream?.();
    this.closeStream = undefined;
    const snapshot = await this.dependencies.loadSnapshot(runId);
    if (generation !== this.generation || this.selectedRunId !== runId) return;
    this.state = projectionFromSnapshot(snapshot);
    this.dependencies.onState(this.state);
    this.connect();
  }
}
