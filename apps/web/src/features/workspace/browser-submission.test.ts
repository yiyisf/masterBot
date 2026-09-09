import { describe, expect, it } from 'vitest';
import { createSessionSubmissionStore } from './browser-submission';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); },
  };
}

describe('per-tab Composer storage', () => {
  it('restores Draft and operation progress across coordinator recreation', () => {
    const storage = memoryStorage();
    const first = createSessionSubmissionStore(storage);
    first.saveDraft('Private draft');
    first.saveOperation({
      schemaVersion: 1,
      conversationCommandId: '10000000-0000-4000-8000-000000000101',
      messageCommandId: '10000000-0000-4000-8000-000000000102',
      runCommandId: '10000000-0000-4000-8000-000000000103',
      conversationId: '10000000-0000-4000-8000-000000000104',
      messageId: '10000000-0000-4000-8000-000000000105',
    });

    const afterRefresh = createSessionSubmissionStore(storage);
    expect(afterRefresh.loadDraft()).toBe('Private draft');
    expect(afterRefresh.loadOperation()).toMatchObject({
      conversationCommandId: '10000000-0000-4000-8000-000000000101',
      conversationId: '10000000-0000-4000-8000-000000000104',
      messageId: '10000000-0000-4000-8000-000000000105',
    });
    expect(JSON.stringify(afterRefresh.loadOperation())).not.toContain('Private draft');
  });

  it('discards malformed operation metadata without touching the Draft', () => {
    const storage = memoryStorage();
    storage.setItem('cmaster.workspace.new-conversation.operation.v1', '{broken');
    const store = createSessionSubmissionStore(storage);
    store.saveDraft('Keep this');
    expect(store.loadOperation()).toBeUndefined();
    expect(store.loadDraft()).toBe('Keep this');
  });
});
