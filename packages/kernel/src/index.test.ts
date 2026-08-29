import { describe, expect, it } from 'vitest';
import { FixedClock } from './index.js';

describe('FixedClock', () => {
  it('returns a defensive copy of the configured instant', () => {
    const clock = new FixedClock(new Date('2026-01-02T03:04:05.000Z'));

    const first = clock.now();
    first.setUTCFullYear(2030);

    expect(clock.now().toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });
});
