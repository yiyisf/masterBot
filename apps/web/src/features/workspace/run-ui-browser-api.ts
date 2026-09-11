import {
  createContractClient,
  type RunUiProjectionSnapshotContract,
  type RunUiTimelinePageContract,
} from '@cmaster/contracts';
import type { ProjectionStream } from './run-ui-transport';

export interface RunUiBrowserApi {
  loadSnapshot(runId: string): Promise<RunUiProjectionSnapshotContract>;
  loadTimeline(runId: string, beforeSequence: number): Promise<RunUiTimelinePageContract>;
  openStream(runId: string, afterSequence: number, stream: ProjectionStream): () => void;
  cancel(runId: string, commandId: string): Promise<
    { readonly kind: 'cancelled' | 'tool_effect_in_flight' | 'too_late' }
  >;
  resolveConfirmation(
    runId: string,
    interruptId: string,
    commandId: string,
    response: 'confirm' | 'reject',
  ): Promise<void>;
  continueWithUncertainty(runId: string, interruptId: string, commandId: string): Promise<void>;
}

function requireData<Value>(value: Value | undefined, code: string): Value {
  if (value === undefined) throw new Error(code);
  return value;
}

export function createRunUiBrowserApi(
  baseUrl: string,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
  createEventSource: (url: string) => EventSource = (url) => new EventSource(url, {
    withCredentials: true,
  }),
): RunUiBrowserApi {
  const client = createContractClient(baseUrl, fetchImplementation);
  return {
    async loadSnapshot(runId) {
      const result = await client.GET('/api/v1/workspace/runs/{runId}/projection', {
        params: { path: { runId } },
      });
      return requireData(result.data, 'run_projection_unavailable');
    },
    async loadTimeline(runId, beforeSequence) {
      const result = await client.GET('/api/v1/workspace/runs/{runId}/timeline', {
        params: { path: { runId }, query: { beforeSequence, limit: 100 } },
      });
      return requireData(result.data, 'run_timeline_unavailable');
    },
    openStream(runId, afterSequence, stream) {
      const source = createEventSource(
        `${baseUrl}/api/v1/workspace/runs/${encodeURIComponent(runId)}/stream?afterSequence=${afterSequence}`,
      );
      source.addEventListener('run-ui-projection', (raw) => {
        try {
          stream.onEvent(JSON.parse((raw as MessageEvent).data));
        } catch {
          stream.onEvent(undefined);
        }
      });
      source.onerror = () => {
        source.close();
        stream.onError();
      };
      return () => source.close();
    },
    async cancel(runId, commandId) {
      const result = await client.POST('/api/v1/runs/{runId}/commands/cancel', {
        params: { path: { runId }, header: { 'idempotency-key': commandId } },
      });
      if (result.data) return { kind: 'cancelled' };
      if (result.error?.code === 'tool_effect_in_flight') {
        return { kind: 'tool_effect_in_flight' };
      }
      if (result.error?.code === 'run_cancellation_too_late') return { kind: 'too_late' };
      throw new Error('run_cancel_failed');
    },
    async resolveConfirmation(runId, interruptId, commandId, response) {
      const result = await client.POST(
        '/api/v1/runs/{runId}/tool-confirmations/{interruptId}/resolve',
        {
          params: {
            path: { runId, interruptId },
            header: { 'idempotency-key': commandId },
          },
          body: { response },
        },
      );
      requireData(result.data, 'confirmation_resolution_failed');
    },
    async continueWithUncertainty(runId, interruptId, commandId) {
      const result = await client.POST('/api/v1/runs/{runId}/interrupts/{interruptId}/resolve', {
        params: {
          path: { runId, interruptId },
          header: { 'idempotency-key': commandId },
        },
        body: { response: 'continue_with_uncertainty' },
      });
      requireData(result.data, 'outcome_resolution_failed');
    },
  };
}
