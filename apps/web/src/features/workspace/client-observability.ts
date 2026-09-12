export type ObservableFeature =
  | 'workspace_home'
  | 'conversation'
  | 'run_projection'
  | 'pending'
  | 'artifact_library'
  | 'artifact_preview';

type ObservableResult = 'succeeded' | 'failed' | 'cancelled';
type StreamRecoveryResult = 'reconnected' | 'gap_repaired' | 'failed';
type RendererFallbackKind = 'unknown_projection' | 'unknown_artifact' | 'unknown_tool';
type WebVitalName = 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB';

export type ClientObservabilityEvent =
  | Readonly<{ name: 'feature_count'; feature: ObservableFeature; count: number }>
  | Readonly<{ name: 'feature_duration'; feature: ObservableFeature; durationMs: number; result: ObservableResult }>
  | Readonly<{ name: 'stream_recovery'; feature: 'run_projection'; result: StreamRecoveryResult; reconnectCount: number; correlationId?: string }>
  | Readonly<{ name: 'safe_failure'; feature: ObservableFeature; safeCode: string; correlationId?: string }>
  | Readonly<{ name: 'renderer_fallback'; feature: 'run_projection' | 'artifact_preview'; fallbackKind: RendererFallbackKind }>
  | Readonly<{ name: 'web_vital'; feature: ObservableFeature; vital: WebVitalName; value: number }>;

export interface ClientObservability {
  emit(event: ClientObservabilityEvent): void;
}

export type ClientObservabilityExporter = (event: ClientObservabilityEvent) => void;

const features = new Set<ObservableFeature>([
  'workspace_home', 'conversation', 'run_projection', 'pending',
  'artifact_library', 'artifact_preview',
]);
const results = new Set<ObservableResult>(['succeeded', 'failed', 'cancelled']);
const recoveryResults = new Set<StreamRecoveryResult>(['reconnected', 'gap_repaired', 'failed']);
const fallbackKinds = new Set<RendererFallbackKind>([
  'unknown_projection', 'unknown_artifact', 'unknown_tool',
]);
const vitals = new Set<WebVitalName>(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);
const correlationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const safeCodePattern = /^[a-z][a-z0-9_]{0,63}$/u;

function boundedNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    && value <= Number.MAX_SAFE_INTEGER;
}

function boundedCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && boundedNumber(value);
}

function approvedKeys(value: object, keys: readonly string[]): boolean {
  const approved = new Set(keys);
  return Object.keys(value).every((key) => approved.has(key));
}

function optionalCorrelationId(value: { readonly correlationId?: unknown }): boolean {
  return value.correlationId === undefined
    || (typeof value.correlationId === 'string' && correlationIdPattern.test(value.correlationId));
}

function isApprovedEvent(event: ClientObservabilityEvent): boolean {
  switch (event.name) {
    case 'feature_count':
      return approvedKeys(event, ['name', 'feature', 'count'])
        && features.has(event.feature) && boundedCount(event.count);
    case 'feature_duration':
      return approvedKeys(event, ['name', 'feature', 'durationMs', 'result'])
        && features.has(event.feature) && boundedNumber(event.durationMs)
        && results.has(event.result);
    case 'stream_recovery':
      return approvedKeys(event, ['name', 'feature', 'result', 'reconnectCount', 'correlationId'])
        && event.feature === 'run_projection' && recoveryResults.has(event.result)
        && boundedCount(event.reconnectCount) && optionalCorrelationId(event);
    case 'safe_failure':
      return approvedKeys(event, ['name', 'feature', 'safeCode', 'correlationId'])
        && features.has(event.feature) && safeCodePattern.test(event.safeCode)
        && optionalCorrelationId(event);
    case 'renderer_fallback':
      return approvedKeys(event, ['name', 'feature', 'fallbackKind'])
        && (event.feature === 'run_projection' || event.feature === 'artifact_preview')
        && fallbackKinds.has(event.fallbackKind);
    case 'web_vital':
      return approvedKeys(event, ['name', 'feature', 'vital', 'value'])
        && features.has(event.feature) && vitals.has(event.vital)
        && boundedNumber(event.value);
  }
}

/** Browser metrics are optional, bounded, content-free, and never affect product behavior. */
export function createClientObservability(
  exporter: ClientObservabilityExporter = () => undefined,
): ClientObservability {
  return {
    emit(event) {
      try {
        if (!isApprovedEvent(event)) return;
        exporter(event);
      } catch {
        // Observability export cannot change Employee Workspace behavior.
      }
    },
  };
}
