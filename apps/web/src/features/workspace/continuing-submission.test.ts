import { describe, expect, it, vi } from 'vitest';
import type { SubmissionApi } from './conversation-submission';
import {
  ContinuingSubmissionCoordinator,
  type ContinuingSubmissionOperation,
  type ContinuingSubmissionStore,
} from './continuing-submission';

class MemoryStore implements ContinuingSubmissionStore {
  operation?: ContinuingSubmissionOperation;
  draft = '';
  loadOperation() { return this.operation; }
  saveOperation(operation: ContinuingSubmissionOperation) { this.operation = operation; }
  clearOperation() { this.operation = undefined; }
  loadDraft() { return this.draft; }
  saveDraft(draft: string) { this.draft = draft; }
  clearDraft() { this.draft = ''; }
}

function api(overrides: Partial<SubmissionApi> = {}): SubmissionApi {
  return {
    findConversation: vi.fn(), createConversation: vi.fn(),
    findMessage: vi.fn().mockResolvedValue(undefined),
    appendMessage: vi.fn().mockResolvedValue({ id: 'message-1', conversationId: 'conversation-1' }),
    findRun: vi.fn().mockResolvedValue(undefined),
    createRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'accepted' }),
    ...overrides,
  };
}

describe('continuing Conversation submission', () => {
  it('reuses stable Message and Run identities across recovery', async () => {
    const store = new MemoryStore();
    store.draft = 'Continue the work';
    const submissionApi = api({
      createRun: vi.fn().mockRejectedValue(new Error('response_lost')),
      findRun: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ id: 'run-1', status: 'accepted' }),
    });
    const ids = ['message-command', 'run-command'];
    const coordinator = new ContinuingSubmissionCoordinator(
      submissionApi, store, () => ids.shift()!,
    );

    await expect(coordinator.submit('conversation-1', store.draft))
      .rejects.toThrow('response_lost');
    expect(store.operation).toMatchObject({
      kind: 'continue', messageId: 'message-1',
      messageCommandId: 'message-command', runCommandId: 'run-command',
    });

    await expect(coordinator.submit('conversation-1', store.draft)).resolves.toMatchObject({
      conversationId: 'conversation-1', messageId: 'message-1', runId: 'run-1',
    });
    expect(submissionApi.appendMessage).toHaveBeenCalledTimes(1);
    expect(submissionApi.createRun).toHaveBeenCalledTimes(1);
    expect(store.draft).toBe('');
  });

  it('uses a new Command identity for each intentional Run attempt', async () => {
    const store = new MemoryStore();
    const createRun = vi.fn()
      .mockResolvedValueOnce({ id: 'run-2', status: 'accepted' })
      .mockResolvedValueOnce({ id: 'run-3', status: 'accepted' });
    const coordinator = new ContinuingSubmissionCoordinator(
      api({ createRun }), store, (() => {
        const ids = ['attempt-command-1', 'attempt-command-2'];
        return () => ids.shift()!;
      })(),
    );

    await coordinator.runAgain('conversation-1', 'message-1');
    coordinator.acknowledge();
    await coordinator.runAgain('conversation-1', 'message-1');

    expect(createRun.mock.calls).toEqual([
      ['attempt-command-1', 'message-1'],
      ['attempt-command-2', 'message-1'],
    ]);
  });
});
