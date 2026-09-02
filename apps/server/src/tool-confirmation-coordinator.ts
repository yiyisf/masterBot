import {
  approvalCommandId,
} from '@cmaster/governance';
import type { RequestIdentity } from '@cmaster/identity';
import {
  runCommandId,
  type ExecutionModule,
  type InterruptId,
  type RunId,
  type RunSnapshot,
} from '@cmaster/execution';
import type { ToolCallId, ToolOutcome, ToolRuntime } from '@cmaster/tools';

export interface PrincipalEntitlementSource {
  resolve(identity: RequestIdentity): Promise<readonly string[]>;
}

export interface ResolveToolConfirmationCommand {
  commandId: string;
  response: 'confirm' | 'reject';
  signal: AbortSignal;
}

export interface ToolConfirmationResult {
  run: RunSnapshot;
  outcome: ToolOutcome;
  replayed: boolean;
}

/**
 * Coordinates, without cross-Module SQL, the initiating Employee's exact Tool Approval
 * and the corresponding Execution Interrupt. Replays always consult both durable Modules;
 * exact Tool payloads and Provider errors never enter the returned Browser projection.
 */
export class ToolConfirmationCoordinator {
  constructor(
    private readonly execution: Pick<
      ExecutionModule,
      'getRun' | 'resolveInterrupt' | 'enterToolBoundary' | 'leaveToolBoundary'
    >,
    private readonly tools: Pick<ToolRuntime, 'resume'>,
    private readonly entitlements: PrincipalEntitlementSource,
  ) {}

  async resolve(
    identity: RequestIdentity,
    runId: RunId,
    interruptId: InterruptId,
    command: ResolveToolConfirmationCommand,
  ): Promise<ToolConfirmationResult> {
    const run = await this.execution.getRun(identity, runId);
    const interrupt = run.activeInterrupt;
    if (run.initiatingPrincipalId !== identity.principalId
      || !interrupt
      || interrupt.id !== interruptId
      || interrupt.kind !== 'tool_confirmation') {
      throw new ToolConfirmationConflictError();
    }

    await this.execution.enterToolBoundary(identity, runId);
    let outcome: ToolOutcome;
    try {
      outcome = await this.tools.resume({
        identity,
        toolCallId: interrupt.subjectRef as ToolCallId,
        commandId: approvalCommandId(command.commandId),
        response: command.response,
        principalEntitlements: await this.entitlements.resolve(identity),
        signal: command.signal,
      });
    } finally {
      await this.execution.leaveToolBoundary(identity, runId);
    }
    const resolved = await this.execution.resolveInterrupt(identity, runId, interruptId, {
      commandId: runCommandId(command.commandId),
      response: command.response,
    });
    return { run: resolved.value, outcome, replayed: resolved.replayed };
  }
}

export class ToolConfirmationConflictError extends Error {}

export class Slice3DevelopmentEntitlements implements PrincipalEntitlementSource {
  async resolve(): Promise<readonly string[]> {
    return ['enterprise_assistant.use_governed_tools'];
  }
}
