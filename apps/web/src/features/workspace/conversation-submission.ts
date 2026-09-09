export interface ConversationSubmissionOperation {
  readonly schemaVersion: 1;
  readonly conversationCommandId: string;
  readonly messageCommandId: string;
  readonly runCommandId: string;
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly runId?: string;
  readonly runStatus?: 'accepted' | 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
}

export interface SubmissionStore {
  loadOperation(): ConversationSubmissionOperation | undefined;
  saveOperation(operation: ConversationSubmissionOperation): void;
  clearOperation(): void;
  loadDraft(): string;
  saveDraft(draft: string): void;
  clearDraft(): void;
}

interface CreatedConversation { readonly id: string }
interface AppendedMessage { readonly id: string; readonly conversationId: string }
interface AcceptedRun {
  readonly id: string;
  readonly status: NonNullable<ConversationSubmissionOperation['runStatus']>;
}

export interface SubmissionApi {
  findConversation(commandId: string): Promise<CreatedConversation | undefined>;
  createConversation(commandId: string): Promise<CreatedConversation>;
  findMessage(commandId: string): Promise<AppendedMessage | undefined>;
  appendMessage(commandId: string, conversationId: string, text: string): Promise<AppendedMessage>;
  findRun(commandId: string): Promise<AcceptedRun | undefined>;
  createRun(commandId: string, messageId: string): Promise<AcceptedRun>;
}

export interface CompletedConversationSubmission {
  readonly conversationId: string;
  readonly messageId: string;
  readonly runId: string;
  readonly runStatus: NonNullable<ConversationSubmissionOperation['runStatus']>;
}

export async function recoverCommand<Value>(
  find: () => Promise<Value | undefined>,
  execute: () => Promise<Value>,
): Promise<Value> {
  const existing = await find();
  if (existing) return existing;
  try {
    return await execute();
  } catch (commandError) {
    // 响应丢失时先查权威事实；查不到时保持原 operation identity，等待 Employee 恢复。
    try {
      const committed = await find();
      if (committed) return committed;
    } catch {
      // Reconciliation failure cannot justify resending a possibly committed Command.
    }
    throw commandError;
  }
}

/**
 * Coordinates the three existing Commands while persisting only IDs and progress in session storage.
 * It never stores Draft content in operation state and never blindly retries an unknown Command.
 */
export class ConversationSubmissionCoordinator {
  constructor(
    private readonly api: SubmissionApi,
    private readonly store: SubmissionStore,
    private readonly createOperationId: () => string,
  ) {}

  async submit(text: string): Promise<CompletedConversationSubmission> {
    let operation = this.store.loadOperation() ?? {
      schemaVersion: 1 as const,
      conversationCommandId: this.createOperationId(),
      messageCommandId: this.createOperationId(),
      runCommandId: this.createOperationId(),
    };
    this.store.saveOperation(operation);

    if (!operation.conversationId) {
      const conversation = await recoverCommand(
        () => this.api.findConversation(operation.conversationCommandId),
        () => this.api.createConversation(operation.conversationCommandId),
      );
      operation = { ...operation, conversationId: conversation.id };
      this.store.saveOperation(operation);
    }

    if (!operation.messageId) {
      const conversationId = operation.conversationId;
      if (!conversationId) throw new Error('conversation_submission_incomplete');
      const message = await recoverCommand(
        () => this.api.findMessage(operation.messageCommandId),
        () => this.api.appendMessage(
          operation.messageCommandId,
          conversationId,
          text,
        ),
      );
      operation = { ...operation, messageId: message.id };
      this.store.saveOperation(operation);
    }

    if (!operation.runId) {
      const messageId = operation.messageId;
      if (!messageId) throw new Error('conversation_submission_incomplete');
      const run = await recoverCommand(
        () => this.api.findRun(operation.runCommandId),
        () => this.api.createRun(operation.runCommandId, messageId),
      );
      operation = { ...operation, runId: run.id, runStatus: run.status };
      this.store.saveOperation(operation);
    }

    if (!operation.conversationId || !operation.messageId || !operation.runId || !operation.runStatus) {
      throw new Error('conversation_submission_incomplete');
    }
    const completed = {
      conversationId: operation.conversationId,
      messageId: operation.messageId,
      runId: operation.runId,
      runStatus: operation.runStatus,
    };
    this.store.clearDraft();
    return completed;
  }

  /** Clear the operation receipt only after navigation to its durable Conversation was requested. */
  acknowledgeNavigation(): void {
    this.store.clearOperation();
  }
}
