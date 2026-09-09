import { recoverCommand, type SubmissionApi } from './conversation-submission';

type RunStatus = 'accepted' | 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';

interface ContinueOperation {
  readonly schemaVersion: 1;
  readonly kind: 'continue';
  readonly conversationId: string;
  readonly messageCommandId: string;
  readonly runCommandId: string;
  readonly messageId?: string;
  readonly runId?: string;
  readonly runStatus?: RunStatus;
}

interface RunAgainOperation {
  readonly schemaVersion: 1;
  readonly kind: 'run-again';
  readonly conversationId: string;
  readonly messageId: string;
  readonly runCommandId: string;
  readonly runId?: string;
  readonly runStatus?: RunStatus;
}

export type ContinuingSubmissionOperation = ContinueOperation | RunAgainOperation;

export interface ContinuingSubmissionStore {
  loadOperation(): ContinuingSubmissionOperation | undefined;
  saveOperation(operation: ContinuingSubmissionOperation): void;
  clearOperation(): void;
  loadDraft(): string;
  saveDraft(draft: string): void;
  clearDraft(): void;
}

export interface CompletedContinuation {
  readonly conversationId: string;
  readonly messageId: string;
  readonly runId: string;
  readonly runStatus: RunStatus;
}

export class ContinuingSubmissionCoordinator {
  constructor(
    private readonly api: SubmissionApi,
    private readonly store: ContinuingSubmissionStore,
    private readonly createOperationId: () => string,
  ) {}

  async submit(conversationId: string, text: string): Promise<CompletedContinuation> {
    const saved = this.store.loadOperation();
    if (saved && (saved.kind !== 'continue' || saved.conversationId !== conversationId)) {
      throw new Error('another_conversation_operation_is_pending');
    }
    let operation: ContinueOperation = saved ?? {
      schemaVersion: 1,
      kind: 'continue',
      conversationId,
      messageCommandId: this.createOperationId(),
      runCommandId: this.createOperationId(),
    };
    this.store.saveOperation(operation);

    if (!operation.messageId) {
      const message = await recoverCommand(
        () => this.api.findMessage(operation.messageCommandId),
        () => this.api.appendMessage(operation.messageCommandId, conversationId, text),
      );
      if (message.conversationId !== conversationId) {
        throw new Error('recovered_message_conversation_mismatch');
      }
      operation = { ...operation, messageId: message.id };
      this.store.saveOperation(operation);
    }

    if (!operation.runId) {
      const messageId = operation.messageId;
      if (!messageId) throw new Error('continuing_submission_incomplete');
      const run = await recoverCommand(
        () => this.api.findRun(operation.runCommandId),
        () => this.api.createRun(operation.runCommandId, messageId),
      );
      operation = { ...operation, runId: run.id, runStatus: run.status };
      this.store.saveOperation(operation);
    }

    if (!operation.messageId || !operation.runId || !operation.runStatus) {
      throw new Error('continuing_submission_incomplete');
    }
    this.store.clearDraft();
    return {
      conversationId, messageId: operation.messageId,
      runId: operation.runId, runStatus: operation.runStatus,
    };
  }

  async runAgain(conversationId: string, messageId: string): Promise<CompletedContinuation> {
    const saved = this.store.loadOperation();
    if (saved && (saved.kind !== 'run-again'
      || saved.conversationId !== conversationId || saved.messageId !== messageId)) {
      throw new Error('another_conversation_operation_is_pending');
    }
    let operation: RunAgainOperation = saved ?? {
      schemaVersion: 1,
      kind: 'run-again',
      conversationId,
      messageId,
      runCommandId: this.createOperationId(),
    };
    this.store.saveOperation(operation);

    if (!operation.runId) {
      const run = await recoverCommand(
        () => this.api.findRun(operation.runCommandId),
        () => this.api.createRun(operation.runCommandId, messageId),
      );
      operation = { ...operation, runId: run.id, runStatus: run.status };
      this.store.saveOperation(operation);
    }
    if (!operation.runId || !operation.runStatus) {
      throw new Error('run_attempt_submission_incomplete');
    }
    return {
      conversationId, messageId,
      runId: operation.runId, runStatus: operation.runStatus,
    };
  }

  acknowledge(): void {
    this.store.clearOperation();
  }
}
