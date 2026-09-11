import { describe, expect, it, vi } from 'vitest';
import type { PendingInterruptContract } from '@cmaster/contracts';
import {
  PendingResolutionCoordinator,
  createPendingOperationStore,
} from './pending-resolution';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const item: PendingInterruptContract = {
  kind: 'employee_confirmation',
  decisionStatus: 'pending',
  conversationId: '10000000-0000-4000-8000-000000000001',
  triggerMessageId: '10000000-0000-4000-8000-000000000002',
  runId: '10000000-0000-4000-8000-000000000003',
  interruptId: '10000000-0000-4000-8000-000000000004',
  createdAt: '2026-01-01T00:00:00.000Z',
  allowedResponses: ['confirm', 'reject'],
  approvalSubject: {
    approvalId: '10000000-0000-4000-8000-000000000005',
    title: 'Fetch documentation', details: {},
  },
};

describe('Pending resolution recovery', () => {
  it('reuses a durable Command ID after response loss and clears it only after authority is no longer active', async () => {
    const storage = new MemoryStorage();
    const resolveConfirmation = vi.fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(undefined);
    const refresh = vi.fn()
      .mockResolvedValueOnce({ active: true })
      .mockResolvedValueOnce({ active: false });
    const coordinator = new PendingResolutionCoordinator({
      api: { resolveConfirmation, continueWithUncertainty: vi.fn() },
      refresh,
      operations: createPendingOperationStore(storage),
      createCommandId: () => '10000000-0000-4000-8000-000000000006',
    });

    await expect(coordinator.resolve(item, 'confirm')).resolves.toEqual({ kind: 'still_pending' });
    await expect(coordinator.resolve(item, 'confirm')).resolves.toEqual({ kind: 'handled' });
    expect(resolveConfirmation.mock.calls.map((call) => call[2])).toEqual([
      '10000000-0000-4000-8000-000000000006',
      '10000000-0000-4000-8000-000000000006',
    ]);
    expect(storage.length).toBe(0);
  });

  it('does not replace an unknown in-flight decision with the opposite response', async () => {
    const storage = new MemoryStorage();
    const operations = createPendingOperationStore(storage);
    operations.save({
      schemaVersion: 1,
      interruptId: item.interruptId,
      runId: item.runId,
      commandId: '10000000-0000-4000-8000-000000000006',
      response: 'confirm',
    });
    const resolveConfirmation = vi.fn();
    const coordinator = new PendingResolutionCoordinator({
      api: { resolveConfirmation, continueWithUncertainty: vi.fn() },
      refresh: vi.fn(async () => ({ active: true })),
      operations,
      createCommandId: crypto.randomUUID,
    });

    await expect(coordinator.resolve(item, 'reject')).resolves.toEqual({
      kind: 'decision_in_progress', response: 'confirm',
    });
    expect(resolveConfirmation).not.toHaveBeenCalled();
  });
});
