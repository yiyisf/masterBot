import { createContractClient } from '@cmaster/contracts';
import type {
  ConversationSubmissionOperation,
  SubmissionApi,
  SubmissionStore,
} from './conversation-submission';
import { isBrowserRunStatus, isBrowserUuid } from './browser-state-validation';

const operationStorageKey = 'cmaster.workspace.new-conversation.operation.v1';
const draftStorageKey = 'cmaster.workspace.new-conversation.draft.v1';

function safeFailure(code: string): Error {
  return new Error(code);
}

export function createBrowserSubmissionApi(
  baseUrl: string,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): SubmissionApi {
  const client = createContractClient(baseUrl, fetchImplementation);
  return {
    async findConversation(commandId) {
      const result = await client.GET('/api/v1/conversations/by-command/{commandId}', {
        params: { path: { commandId } },
      });
      if (result.data) return { id: result.data.id };
      if (result.response.status === 404) return undefined;
      throw safeFailure('conversation_reconciliation_failed');
    },
    async createConversation(commandId) {
      const result = await client.POST('/api/v1/conversations', {
        params: { header: { 'idempotency-key': commandId } }, body: {},
      });
      if (!result.data) throw safeFailure('conversation_creation_failed');
      return { id: result.data.id };
    },
    async findMessage(commandId) {
      const result = await client.GET('/api/v1/messages/by-command/{commandId}', {
        params: { path: { commandId } },
      });
      if (result.data) return { id: result.data.id, conversationId: result.data.conversationId };
      if (result.response.status === 404) return undefined;
      throw safeFailure('message_reconciliation_failed');
    },
    async appendMessage(commandId, conversationId, text) {
      const result = await client.POST('/api/v1/conversations/{conversationId}/messages', {
        params: {
          path: { conversationId },
          header: { 'idempotency-key': commandId },
        },
        body: { parts: [{ type: 'text', text }] },
      });
      if (!result.data) throw safeFailure('message_creation_failed');
      return { id: result.data.id, conversationId: result.data.conversationId };
    },
    async findRun(commandId) {
      const result = await client.GET('/api/v1/runs/by-command/{commandId}', {
        params: { path: { commandId } },
      });
      if (result.data) return { id: result.data.id, status: result.data.status };
      if (result.response.status === 404) return undefined;
      throw safeFailure('run_reconciliation_failed');
    },
    async createRun(commandId, messageId) {
      const result = await client.POST('/api/v1/runs', {
        params: { header: { 'idempotency-key': commandId } },
        body: { trigger: { type: 'message', messageId } },
      });
      if (!result.data) throw safeFailure('run_creation_failed');
      return { id: result.data.runId, status: 'accepted' };
    },
  };
}

function optionalUuid(value: unknown): boolean {
  return value === undefined || isBrowserUuid(value);
}

function isOperation(value: unknown): value is ConversationSubmissionOperation {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const validShape = record.schemaVersion === 1
    && isBrowserUuid(record.conversationCommandId)
    && isBrowserUuid(record.messageCommandId)
    && isBrowserUuid(record.runCommandId)
    && optionalUuid(record.conversationId)
    && optionalUuid(record.messageId)
    && optionalUuid(record.runId)
    && (record.runStatus === undefined
      || isBrowserRunStatus(record.runStatus));
  if (!validShape) return false;
  if (record.messageId !== undefined && record.conversationId === undefined) return false;
  if (record.runId !== undefined && record.messageId === undefined) return false;
  return (record.runId === undefined) === (record.runStatus === undefined);
}

export function createSessionSubmissionStore(storage: Storage): SubmissionStore {
  return {
    loadOperation() {
      const serialized = storage.getItem(operationStorageKey);
      if (!serialized) return undefined;
      try {
        const parsed: unknown = JSON.parse(serialized);
        if (isOperation(parsed)) return parsed;
      } catch {
        // Corrupt local state is not a Server fact and cannot be used for recovery.
      }
      storage.removeItem(operationStorageKey);
      return undefined;
    },
    saveOperation(operation) {
      storage.setItem(operationStorageKey, JSON.stringify(operation));
    },
    clearOperation() { storage.removeItem(operationStorageKey); },
    loadDraft() { return storage.getItem(draftStorageKey) ?? ''; },
    saveDraft(draft) { storage.setItem(draftStorageKey, draft); },
    clearDraft() { storage.removeItem(draftStorageKey); },
  };
}
