export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

export function preservePrependAnchor(input: Readonly<{
  scrollTop: number;
  scrollHeightBefore: number;
  scrollHeightAfter: number;
}>): number {
  return input.scrollTop + Math.max(0, input.scrollHeightAfter - input.scrollHeightBefore);
}

export function contentArrivalAction(
  metrics: ScrollMetrics,
  nearBottomDistance = 96,
): 'follow' | 'offer-new-content' {
  const distance = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return distance <= nearBottomDistance ? 'follow' : 'offer-new-content';
}

export type ScrollRestorationAction =
  | { readonly kind: 'restore'; readonly sequence: number }
  | { readonly kind: 'load-older' }
  | { readonly kind: 'discard' };

export function resolveScrollRestoration(input: Readonly<{
  savedSequence: number;
  loadedSequences: readonly number[];
  hasOlder: boolean;
}>): ScrollRestorationAction {
  if (input.loadedSequences.includes(input.savedSequence)) {
    return { kind: 'restore', sequence: input.savedSequence };
  }
  const first = input.loadedSequences[0];
  if (input.hasOlder && first !== undefined && first > input.savedSequence) {
    return { kind: 'load-older' };
  }
  return { kind: 'discard' };
}

interface SelectableRun {
  readonly id: string;
  readonly status: 'accepted' | 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
}

export function selectDefaultRun(runs: readonly SelectableRun[]): string | undefined {
  return runs.find((run) => run.status === 'waiting')?.id
    ?? runs.find((run) => ['accepted', 'queued', 'running'].includes(run.status))?.id;
}
