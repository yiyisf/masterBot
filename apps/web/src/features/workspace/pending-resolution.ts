import type { PendingInterruptContract } from '@cmaster/contracts';
import { isBrowserUuid } from './browser-state-validation';

export type PendingResponse = 'confirm' | 'reject' | 'continue_with_uncertainty';
export interface ResolvableInterrupt {
  readonly kind: PendingInterruptContract['kind'];
  readonly runId: string;
  readonly interruptId: string;
  readonly allowedResponses: readonly PendingResponse[];
}

export interface PendingOperation {
  readonly schemaVersion: 1;
  readonly interruptId: string;
  readonly runId: string;
  readonly commandId: string;
  readonly response: PendingResponse;
}

export interface PendingOperationStore {
  load(interruptId: string): PendingOperation | undefined;
  save(operation: PendingOperation): void;
  clear(interruptId: string): void;
}

const keyPrefix = 'cmaster:pending-operation:';
function isPendingResponse(value: unknown): value is PendingResponse {
  return value === 'confirm' || value === 'reject' || value === 'continue_with_uncertainty';
}

function decodeOperation(value: string | null): PendingOperation | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object'
      || !('schemaVersion' in parsed) || parsed.schemaVersion !== 1
      || !('interruptId' in parsed) || !isBrowserUuid(parsed.interruptId)
      || !('runId' in parsed) || !isBrowserUuid(parsed.runId)
      || !('commandId' in parsed) || !isBrowserUuid(parsed.commandId)
      || !('response' in parsed) || !isPendingResponse(parsed.response)) return undefined;
    return {
      schemaVersion: 1,
      interruptId: parsed.interruptId,
      runId: parsed.runId,
      commandId: parsed.commandId,
      response: parsed.response,
    };
  } catch {
    return undefined;
  }
}

export function createPendingOperationStore(storage: Storage): PendingOperationStore {
  return {
    load(interruptId) {
      const operation = decodeOperation(storage.getItem(`${keyPrefix}${interruptId}`));
      if (!operation || operation.interruptId !== interruptId) {
        storage.removeItem(`${keyPrefix}${interruptId}`);
        return undefined;
      }
      return operation;
    },
    save(operation) {
      storage.setItem(`${keyPrefix}${operation.interruptId}`, JSON.stringify(operation));
    },
    clear(interruptId) {
      storage.removeItem(`${keyPrefix}${interruptId}`);
    },
  };
}

export function createSessionPendingOperationStore(): PendingOperationStore {
  const storage = (): Storage | undefined => {
    try {
      return globalThis.sessionStorage;
    } catch {
      return undefined;
    }
  };
  const memory = new Map<string, PendingOperation>();
  return {
    load(interruptId) {
      try {
        const available = storage();
        const persisted = available
          ? createPendingOperationStore(available).load(interruptId) : undefined;
        return persisted ?? memory.get(interruptId);
      } catch {
        return memory.get(interruptId);
      }
    },
    save(operation) {
      memory.set(operation.interruptId, operation);
      try {
        const available = storage();
        if (available) createPendingOperationStore(available).save(operation);
      } catch {
        // Browser storage is optional; in-memory recovery remains available for this page lifetime.
      }
    },
    clear(interruptId) {
      memory.delete(interruptId);
      try {
        const available = storage();
        if (available) createPendingOperationStore(available).clear(interruptId);
      } catch {
        // A denied storage cleanup must not change authoritative command recovery.
      }
    },
  };
}

interface PendingResolutionDependencies {
  readonly api: {
    resolveConfirmation(
      runId: string,
      interruptId: string,
      commandId: string,
      response: 'confirm' | 'reject',
    ): Promise<void>;
    continueWithUncertainty(runId: string, interruptId: string, commandId: string): Promise<void>;
  };
  readonly refresh: (
    item: ResolvableInterrupt,
  ) => Promise<{ readonly active: boolean }>;
  readonly operations: PendingOperationStore;
  readonly createCommandId: () => string;
}

export type PendingResolutionResult =
  | { readonly kind: 'handled' }
  | { readonly kind: 'still_pending' }
  | { readonly kind: 'decision_in_progress'; readonly response: PendingResponse };

/** 隐藏治理 Command 的响应丢失恢复，只有权威查询确认处理完成后才清除稳定 Command ID。 */
export class PendingResolutionCoordinator {
  constructor(private readonly dependencies: PendingResolutionDependencies) {}

  async resolve(
    item: ResolvableInterrupt,
    response: PendingResponse,
  ): Promise<PendingResolutionResult> {
    if (!new Set<string>(item.allowedResponses).has(response)) {
      throw new Error('pending_response_not_allowed');
    }
    let operation = this.dependencies.operations.load(item.interruptId);
    if (operation && (operation.runId !== item.runId || operation.response !== response)) {
      const authority = await this.dependencies.refresh(item);
      if (!authority.active) {
        this.dependencies.operations.clear(item.interruptId);
        return { kind: 'handled' };
      }
      return { kind: 'decision_in_progress', response: operation.response };
    }
    operation ??= {
      schemaVersion: 1,
      interruptId: item.interruptId,
      runId: item.runId,
      commandId: this.dependencies.createCommandId(),
      response,
    };
    this.dependencies.operations.save(operation);
    try {
      if (item.kind === 'employee_confirmation'
        && (response === 'confirm' || response === 'reject')) {
        await this.dependencies.api.resolveConfirmation(
          item.runId, item.interruptId, operation.commandId, response,
        );
      } else if (item.kind === 'uncertain_tool_outcome_review'
        && response === 'continue_with_uncertainty') {
        await this.dependencies.api.continueWithUncertainty(
          item.runId, item.interruptId, operation.commandId,
        );
      }
    } catch {
      // Command 可能已提交；不得根据 Transport failure 猜测结果或更换 ID。
    }
    const authority = await this.dependencies.refresh(item);
    if (!authority.active) {
      this.dependencies.operations.clear(item.interruptId);
      return { kind: 'handled' };
    }
    return { kind: 'still_pending' };
  }
}
