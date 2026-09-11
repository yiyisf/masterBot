import { describe, expect, it, vi } from 'vitest';
import { createRunUiBrowserApi } from './run-ui-browser-api';

const runId = '10000000-0000-4000-8000-000000000001';

describe('Run UI Browser API', () => {
  it('resumes the Projection EventSource and forwards only decoded JSON values', () => {
    const listeners = new Map<string, (event: MessageEvent) => void>();
    const close = vi.fn();
    const source = {
      addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        listeners.set(type, listener);
      }),
      close,
      onerror: null as (() => void) | null,
    };
    const createEventSource = vi.fn(() => source as unknown as EventSource);
    const api = createRunUiBrowserApi('https://cmaster.example', globalThis.fetch, createEventSource);
    const onEvent = vi.fn();
    const onError = vi.fn();

    const disconnect = api.openStream(runId, 17, { onEvent, onError });
    expect(createEventSource).toHaveBeenCalledWith(
      `https://cmaster.example/api/v1/workspace/runs/${runId}/stream?afterSequence=17`,
    );
    listeners.get('run-ui-projection')?.({ data: '{"schemaVersion":1}' } as MessageEvent);
    expect(onEvent).toHaveBeenCalledWith({ schemaVersion: 1 });

    source.onerror?.();
    expect(close).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    disconnect();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('turns malformed stream data into an unknown value for safe calibration', () => {
    let projectionListener: ((event: MessageEvent) => void) | undefined;
    const source = {
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) => {
        projectionListener = listener;
      },
      close: vi.fn(),
      onerror: null,
    };
    const api = createRunUiBrowserApi('', globalThis.fetch, () => source as unknown as EventSource);
    const onEvent = vi.fn();
    api.openStream(runId, 0, { onEvent, onError: vi.fn() });
    projectionListener?.({ data: 'not-json' } as MessageEvent);
    expect(onEvent).toHaveBeenCalledWith(undefined);
  });
});
