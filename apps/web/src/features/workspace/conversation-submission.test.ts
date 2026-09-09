import { describe, expect, it } from 'vitest';
import {
  ConversationSubmissionCoordinator,
  type ConversationSubmissionOperation,
  type SubmissionApi,
  type SubmissionStore,
} from './conversation-submission';

function memoryStore(): SubmissionStore & { operation?: ConversationSubmissionOperation; draft?: string } {
  return {
    loadOperation() { return this.operation; },
    saveOperation(operation) { this.operation = operation; },
    clearOperation() { delete this.operation; },
    loadDraft() { return this.draft ?? ''; },
    saveDraft(draft) { this.draft = draft; },
    clearDraft() { delete this.draft; },
  };
}

function apiFixture(): SubmissionApi & {
  conversations: Map<string, { id: string }>;
  messages: Map<string, { id: string; conversationId: string }>;
  runs: Map<string, { id: string; status: 'accepted' }>;
  calls: string[];
} {
  const conversations = new Map<string, { id: string }>();
  const messages = new Map<string, { id: string; conversationId: string }>();
  const runs = new Map<string, { id: string; status: 'accepted' }>();
  const calls: string[] = [];
  return {
    conversations, messages, runs, calls,
    async findConversation(commandId) { calls.push(`find-conversation:${commandId}`); return conversations.get(commandId); },
    async createConversation(commandId) {
      calls.push(`create-conversation:${commandId}`);
      const value = { id: 'conversation-1' }; conversations.set(commandId, value); return value;
    },
    async findMessage(commandId) { calls.push(`find-message:${commandId}`); return messages.get(commandId); },
    async appendMessage(commandId, conversationId) {
      calls.push(`append-message:${commandId}`);
      const value = { id: 'message-1', conversationId }; messages.set(commandId, value); return value;
    },
    async findRun(commandId) { calls.push(`find-run:${commandId}`); return runs.get(commandId); },
    async createRun(commandId) {
      calls.push(`create-run:${commandId}`);
      const value = { id: 'run-1', status: 'accepted' as const }; runs.set(commandId, value); return value;
    },
  };
}

describe('recoverable Conversation submission', () => {
  it('persists stable operation identities without storing Draft content in operation state', async () => {
    const store = memoryStore();
    store.saveDraft('Private employee request');
    const api = apiFixture();
    const ids = ['conversation-command', 'message-command', 'run-command'];
    const coordinator = new ConversationSubmissionCoordinator(api, store, () => ids.shift() ?? 'unexpected');

    const completed = await coordinator.submit('Private employee request');

    expect(completed).toEqual({ conversationId: 'conversation-1', messageId: 'message-1', runId: 'run-1', runStatus: 'accepted' });
    expect(store.operation).toMatchObject({ runId: 'run-1' });
    expect(store.draft).toBeUndefined();
    coordinator.acknowledgeNavigation();
    expect(store.operation).toBeUndefined();
    expect(JSON.stringify(api.calls)).not.toContain('Private employee request');
  });

  it('reconciles a lost response before continuing and never repeats the committed Command', async () => {
    const store = memoryStore();
    const api = apiFixture();
    let loseResponse = true;
    const create = api.createConversation.bind(api);
    api.createConversation = async (commandId) => {
      const value = await create(commandId);
      if (loseResponse) { loseResponse = false; throw new Error('response_lost'); }
      return value;
    };
    const coordinator = new ConversationSubmissionCoordinator(api, store, () => crypto.randomUUID());

    await expect(coordinator.submit('Recover this')).resolves.toMatchObject({ conversationId: 'conversation-1' });
    expect(api.calls.filter((call) => call.startsWith('create-conversation:'))).toHaveLength(1);
    expect(api.calls.filter((call) => call.startsWith('find-conversation:'))).toHaveLength(2);
  });

  it('keeps a committed Message visible for explicit Run resumption after failure', async () => {
    const store = memoryStore();
    const api = apiFixture();
    api.createRun = async (commandId) => {
      api.calls.push(`create-run:${commandId}`);
      throw new Error('run_unavailable');
    };
    const coordinator = new ConversationSubmissionCoordinator(api, store, () => crypto.randomUUID());

    await expect(coordinator.submit('Keep my Message')).rejects.toThrow('run_unavailable');
    expect(store.operation).toMatchObject({ conversationId: 'conversation-1', messageId: 'message-1' });
    expect(store.operation).not.toHaveProperty('runId');

    api.createRun = async (commandId) => {
      api.calls.push(`create-run:${commandId}`);
      const value = { id: 'run-1', status: 'accepted' as const };
      api.runs.set(commandId, value);
      return value;
    };
    await expect(coordinator.submit('Keep my Message')).resolves.toMatchObject({ runId: 'run-1' });
    expect(api.calls.filter((call) => call.startsWith('create-conversation:'))).toHaveLength(1);
    expect(api.calls.filter((call) => call.startsWith('append-message:'))).toHaveLength(1);
  });
});
