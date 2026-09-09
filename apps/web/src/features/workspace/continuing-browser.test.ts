import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createContinuingSubmissionStore } from './continuing-browser';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('per-Conversation Browser submission storage', () => {
  it('restores Draft and recovery identity only for the same Conversation in this tab', () => {
    const storage = new MemoryStorage();
    const conversationId = randomUUID();
    const first = createContinuingSubmissionStore(storage, conversationId);
    const operation = {
      schemaVersion: 1 as const,
      kind: 'continue' as const,
      conversationId,
      messageCommandId: randomUUID(),
      runCommandId: randomUUID(),
    };
    first.saveDraft('Continue this work');
    first.saveOperation(operation);

    const restored = createContinuingSubmissionStore(storage, conversationId);
    expect(restored.loadDraft()).toBe('Continue this work');
    expect(restored.loadOperation()).toEqual(operation);
    expect(createContinuingSubmissionStore(storage, randomUUID()).loadDraft()).toBe('');
  });
});
