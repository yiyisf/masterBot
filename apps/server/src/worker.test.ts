import { describe, expect, it, vi } from 'vitest';
import type { DatabaseHealth } from './postgres.js';
import { WorkerRuntime } from './worker.js';

function database(available: boolean): DatabaseHealth {
  return { check: vi.fn(async () => available) };
}

describe('WorkerRuntime', () => {
  it('starts only after PostgreSQL is ready and can stop cleanly', async () => {
    const health = database(true);
    const worker = new WorkerRuntime(health);

    await worker.start();
    await worker.stop();

    expect(health.check).toHaveBeenCalledOnce();
  });

  it('fails startup when PostgreSQL is unavailable', async () => {
    const worker = new WorkerRuntime(database(false));

    await expect(worker.start()).rejects.toThrow('PostgreSQL is unavailable');
  });
});
