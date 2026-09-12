import { describe, expect, it, vi } from 'vitest';
import {
  createClientObservability,
  type ClientObservabilityEvent,
} from './client-observability';

describe('Client Observability', () => {
  it('defaults to a no-op and exports only bounded approved measurements', () => {
    expect(() => createClientObservability().emit({
      name: 'feature_duration',
      feature: 'artifact_preview',
      durationMs: 125,
      result: 'succeeded',
    })).not.toThrow();

    const exported = vi.fn();
    const observability = createClientObservability(exported);
    observability.emit({
      name: 'stream_recovery',
      feature: 'run_projection',
      result: 'gap_repaired',
      reconnectCount: 2,
      correlationId: '10000000-0000-4000-8000-000000000001',
    });
    expect(exported).toHaveBeenCalledWith({
      name: 'stream_recovery',
      feature: 'run_projection',
      result: 'gap_repaired',
      reconnectCount: 2,
      correlationId: '10000000-0000-4000-8000-000000000001',
    });
    expect(() => createClientObservability(() => { throw new Error('collector offline'); }).emit({
      name: 'feature_count', feature: 'workspace_home', count: 1,
    })).not.toThrow();
  });

  it('drops malformed runtime input and cannot type sensitive fields', () => {
    const exported = vi.fn();
    const observability = createClientObservability(exported);
    observability.emit({
      name: 'feature_count', feature: 'pending', count: -1,
    } as ClientObservabilityEvent);
    observability.emit({
      name: 'feature_count', feature: 'conversation', count: 1, message: 'secret',
    } as ClientObservabilityEvent);
    observability.emit({
      name: 'feature_count', feature: 'conversation', count: 0.5,
    } as ClientObservabilityEvent);
    expect(() => observability.emit(null as unknown as ClientObservabilityEvent)).not.toThrow();
    expect(exported).not.toHaveBeenCalled();

    const sensitive: ClientObservabilityEvent = {
      name: 'feature_count', feature: 'conversation', count: 1,
      // @ts-expect-error Message content is not an approved observability field.
      message: 'secret',
    };
    expect(sensitive.count).toBe(1);
  });
});
