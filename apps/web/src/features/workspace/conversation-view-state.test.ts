import { describe, expect, it } from 'vitest';
import {
  contentArrivalAction,
  preservePrependAnchor,
  resolveScrollRestoration,
  selectDefaultRun,
} from './conversation-view-state';

describe('Conversation viewport state', () => {
  it('preserves the visible anchor when an older page is prepended', () => {
    expect(preservePrependAnchor({
      scrollTop: 240,
      scrollHeightBefore: 1_000,
      scrollHeightAfter: 1_680,
    })).toBe(920);
  });

  it('loads backward until a saved route scroll anchor can be restored', () => {
    expect(resolveScrollRestoration({
      savedSequence: 12, loadedSequences: [51, 52, 53], hasOlder: true,
    })).toEqual({ kind: 'load-older' });
    expect(resolveScrollRestoration({
      savedSequence: 12, loadedSequences: [1, 12, 51], hasOlder: false,
    })).toEqual({ kind: 'restore', sequence: 12 });
  });

  it('follows new content only near the bottom', () => {
    expect(contentArrivalAction({
      scrollTop: 790, clientHeight: 200, scrollHeight: 1_000,
    })).toBe('follow');
    expect(contentArrivalAction({
      scrollTop: 300, clientHeight: 200, scrollHeight: 1_000,
    })).toBe('offer-new-content');
  });
});

describe('Conversation Run selection', () => {
  it('prioritizes waiting work, then active work, and leaves terminal-only detail closed', () => {
    const runs = [
      { id: 'completed', status: 'succeeded' as const },
      { id: 'active', status: 'running' as const },
      { id: 'pending', status: 'waiting' as const },
    ];
    expect(selectDefaultRun(runs)).toBe('pending');
    expect(selectDefaultRun(runs.slice(0, 2))).toBe('active');
    expect(selectDefaultRun(runs.slice(0, 1))).toBeUndefined();
  });
});
