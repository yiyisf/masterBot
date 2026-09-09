import type {
  ContinuingSubmissionOperation,
  ContinuingSubmissionStore,
} from './continuing-submission';
import { isBrowserRunStatus, isBrowserUuid } from './browser-state-validation';

function isOptionalRunResult(record: Record<string, unknown>): boolean {
  const runId = record.runId;
  const runStatus = record.runStatus;
  return runId === undefined && runStatus === undefined
    || isBrowserUuid(runId) && isBrowserRunStatus(runStatus);
}

function isOperation(
  value: unknown,
  conversationId: string,
): value is ContinuingSubmissionOperation {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || record.conversationId !== conversationId
    || !isOptionalRunResult(record)) return false;
  if (record.kind === 'continue') {
    return isBrowserUuid(record.messageCommandId)
      && isBrowserUuid(record.runCommandId)
      && (record.messageId === undefined || isBrowserUuid(record.messageId))
      && (record.runId === undefined || record.messageId !== undefined);
  }
  return record.kind === 'run-again'
    && isBrowserUuid(record.messageId)
    && isBrowserUuid(record.runCommandId);
}

export function createContinuingSubmissionStore(
  storage: Storage,
  conversationId: string,
): ContinuingSubmissionStore {
  const prefix = `cmaster.workspace.conversation.${conversationId}`;
  const operationKey = `${prefix}.operation.v1`;
  const draftKey = `${prefix}.draft.v1`;
  return {
    loadOperation() {
      const serialized = storage.getItem(operationKey);
      if (!serialized) return undefined;
      try {
        const parsed: unknown = JSON.parse(serialized);
        if (isOperation(parsed, conversationId)) return parsed;
      } catch {
        // Corrupt Browser state is not an authoritative Command result.
      }
      storage.removeItem(operationKey);
      return undefined;
    },
    saveOperation(operation) { storage.setItem(operationKey, JSON.stringify(operation)); },
    clearOperation() { storage.removeItem(operationKey); },
    loadDraft() { return storage.getItem(draftKey) ?? ''; },
    saveDraft(draft) { storage.setItem(draftKey, draft); },
    clearDraft() { storage.removeItem(draftKey); },
  };
}
