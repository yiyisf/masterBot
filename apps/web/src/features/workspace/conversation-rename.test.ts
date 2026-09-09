import { describe, expect, it, vi } from 'vitest';
import { ConversationRenameCoordinator, type RenameOperationStore } from './conversation-rename';

class MemoryStore implements RenameOperationStore {
  operation?: { commandId: string; title: string };
  load() { return this.operation; }
  save(operation: { commandId: string; title: string }) { this.operation = operation; }
  clear() { this.operation = undefined; }
}

describe('Conversation rename recovery', () => {
  it('reconciles an unknown response before reusing the stable Command identity', async () => {
    const store = new MemoryStore();
    const api = {
      findRename: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ id: 'conversation-1', title: 'Release plan' }),
      rename: vi.fn().mockRejectedValue(new Error('response_lost')),
    };
    const coordinator = new ConversationRenameCoordinator(api, store, () => 'rename-command');

    await expect(coordinator.rename('conversation-1', 'Release plan'))
      .rejects.toThrow('response_lost');
    expect(store.operation).toEqual({ commandId: 'rename-command', title: 'Release plan' });
    await expect(coordinator.rename('conversation-1', 'Release plan'))
      .resolves.toMatchObject({ title: 'Release plan' });
    expect(api.rename).toHaveBeenCalledTimes(1);
    expect(store.operation).toBeUndefined();
  });
});
