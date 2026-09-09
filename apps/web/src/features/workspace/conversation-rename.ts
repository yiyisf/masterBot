import type { ConversationContract } from '@cmaster/contracts';
import type { ConversationBrowserApi } from './conversation-browser-api';
import { isBrowserUuid } from './browser-state-validation';
import { recoverCommand } from './conversation-submission';

interface RenameOperation {
  readonly commandId: string;
  readonly title: string;
}

export interface RenameOperationStore {
  load(): RenameOperation | undefined;
  save(operation: RenameOperation): void;
  clear(): void;
}

export class ConversationRenameCoordinator {
  constructor(
    private readonly api: Pick<ConversationBrowserApi, 'findRename' | 'rename'>,
    private readonly store: RenameOperationStore,
    private readonly createCommandId: () => string,
  ) {}

  async rename(conversationId: string, title: string): Promise<ConversationContract> {
    const saved = this.store.load();
    if (saved && saved.title !== title) throw new Error('rename_operation_is_pending');
    const operation = saved ?? { commandId: this.createCommandId(), title };
    this.store.save(operation);
    const conversation = await recoverCommand(
      () => this.api.findRename(conversationId, operation.commandId),
      () => this.api.rename(conversationId, operation.commandId, operation.title),
    );
    this.store.clear();
    return conversation;
  }
}

export function createRenameOperationStore(
  storage: Storage,
  conversationId: string,
): RenameOperationStore {
  const key = `cmaster.workspace.conversation.${conversationId}.rename.v1`;
  return {
    load() {
      const serialized = storage.getItem(key);
      if (!serialized) return undefined;
      try {
        const parsed: unknown = JSON.parse(serialized);
        if (parsed && typeof parsed === 'object'
          && 'commandId' in parsed && isBrowserUuid(parsed.commandId)
          && 'title' in parsed && typeof parsed.title === 'string'
          && parsed.title.length > 0 && parsed.title.length <= 200) {
          return { commandId: parsed.commandId, title: parsed.title };
        }
      } catch {
        // Corrupt Browser state is not an authoritative rename result.
      }
      storage.removeItem(key);
      return undefined;
    },
    save(operation) { storage.setItem(key, JSON.stringify(operation)); },
    clear() { storage.removeItem(key); },
  };
}
