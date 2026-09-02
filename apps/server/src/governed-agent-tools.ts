import type {
  AgentToolOutcome,
  AgentToolRuntime,
  EngineInvocation,
  ToolExecutionBoundary,
} from '@cmaster/execution';
import type { RequestIdentity } from '@cmaster/identity';
import type { ModelAvailableTool, ModelRequestedTool } from '@cmaster/models';
import type {
  ToolCall,
  ToolCatalog,
  ToolDescriptor,
  ToolGrantId,
  ToolOutcome,
  ToolRuntime,
} from '@cmaster/tools';
import type { PrincipalEntitlementSource } from './tool-confirmation-coordinator.js';

export interface RequestIdentitySource {
  resolveRequest(): RequestIdentity;
}

/**
 * Server composition adapter between the provider-neutral Agent Engine and Tools Module.
 * Model-visible names are resolved only from the active granted Catalog; invented names
 * never reach ToolRuntime. Exact Tool values are returned only to the private model transcript.
 */
export class GovernedAgentToolRuntime implements AgentToolRuntime {
  constructor(
    private readonly catalog: Pick<ToolCatalog, 'list'>,
    private readonly runtime: Pick<ToolRuntime, 'invoke' | 'listCalls'>,
    private readonly identity: RequestIdentitySource,
    private readonly entitlements: PrincipalEntitlementSource,
    private readonly grantId: ToolGrantId,
    private readonly execution: ToolExecutionBoundary,
  ) {}

  async list(input: EngineInvocation): Promise<readonly ModelAvailableTool[]> {
    const identity = this.resolveIdentity(input);
    const descriptors = await this.catalog.list({
      organizationId: identity.organizationId,
      grantId: this.grantId,
    });
    assertUniqueModelNames(descriptors);
    return descriptors.map((descriptor) => ({
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
      outputSchema: descriptor.outputSchema,
    }));
  }

  async invoke(
    input: EngineInvocation,
    request: ModelRequestedTool,
    signal: AbortSignal,
  ): Promise<AgentToolOutcome> {
    const identity = this.resolveIdentity(input);
    const descriptor = await this.resolveDescriptor(identity, request.name);
    await this.execution.enterToolBoundary(identity, input.runId);
    try {
      const outcome = await this.runtime.invoke({
        identity,
        agentRevisionId: input.agentRevisionId,
        grantId: this.grantId,
        principalEntitlements: await this.entitlements.resolve(identity),
        runId: input.runId,
        invocationId: input.invocationId,
        modelRequestId: request.requestId,
        capabilityId: descriptor.capabilityId,
        input: request.input,
        signal,
      });
      return projectOutcome(outcome, descriptor);
    } finally {
      await this.execution.leaveToolBoundary(identity, input.runId);
    }
  }

  async recover(
    input: EngineInvocation,
    toolCallId: string,
    _request: ModelRequestedTool,
  ): Promise<AgentToolOutcome> {
    const identity = this.resolveIdentity(input);
    const call = (await this.runtime.listCalls(identity, input.runId))
      .find((candidate) => candidate.id === toolCallId);
    if (!call) throw new GovernedToolRecoveryError();
    const descriptor = await this.resolveDescriptor(identity, call.capabilityId, 'capability');
    return projectCall(call, descriptor);
  }

  private resolveIdentity(input: EngineInvocation): RequestIdentity {
    const identity = this.identity.resolveRequest();
    if (identity.organizationId !== input.organizationId) throw new GovernedToolAuthorizationError();
    return identity;
  }

  private async resolveDescriptor(
    identity: RequestIdentity,
    value: string,
    by: 'name' | 'capability' = 'name',
  ): Promise<ToolDescriptor> {
    const descriptors = await this.catalog.list({
      organizationId: identity.organizationId,
      grantId: this.grantId,
    });
    assertUniqueModelNames(descriptors);
    const descriptor = descriptors.find((candidate) => (
      by === 'name' ? candidate.name === value : candidate.capabilityId === value
    ));
    if (!descriptor) throw new GovernedToolAuthorizationError();
    return descriptor;
  }
}

function projectCall(call: ToolCall, descriptor: ToolDescriptor): AgentToolOutcome {
  if (call.outcome) return projectOutcome(call.outcome, descriptor);
  if (call.status === 'awaiting_confirmation') {
    return {
      kind: 'interrupt',
      interruptKind: 'tool_confirmation',
      toolCallId: call.id,
      safeSummary: call.requestSummary,
    };
  }
  throw new GovernedToolRecoveryError();
}

function projectOutcome(outcome: ToolOutcome, descriptor: ToolDescriptor): AgentToolOutcome {
  switch (outcome.kind) {
    case 'success':
      return {
        kind: 'completed',
        outcomeKind: 'success',
        toolCallId: outcome.toolCallId,
        modelOutput: outcome.value,
        safeSummary: outcome.safeSummary,
      };
    case 'denied':
      return {
        kind: 'completed',
        outcomeKind: 'denied',
        toolCallId: outcome.toolCallId,
        modelOutput: { status: 'denied', reason: outcome.reason },
        safeSummary: {
          title: `${descriptor.name} was denied`,
          details: { status: outcome.reason },
        },
      };
    case 'failed':
      return {
        kind: 'completed',
        outcomeKind: 'failed',
        toolCallId: outcome.toolCallId,
        modelOutput: { status: 'failed', ...outcome.failure },
        safeSummary: {
          title: `${descriptor.name} failed`,
          details: { code: outcome.failure.code },
        },
      };
    case 'confirmation_required':
      return {
        kind: 'interrupt',
        interruptKind: 'tool_confirmation',
        toolCallId: outcome.toolCallId,
        safeSummary: outcome.safeSummary,
      };
    case 'requires_review':
      return {
        kind: 'interrupt',
        interruptKind: 'tool_outcome_review',
        toolCallId: outcome.toolCallId,
        safeSummary: {
          title: `${descriptor.name} outcome requires review`,
          details: { status: 'External effect unknown' },
        },
      };
  }
}

function assertUniqueModelNames(descriptors: readonly ToolDescriptor[]): void {
  const names = new Set<string>();
  for (const descriptor of descriptors) {
    if (!/^[A-Za-z0-9_-]+$/.test(descriptor.name) || names.has(descriptor.name)) {
      throw new GovernedToolCatalogError();
    }
    names.add(descriptor.name);
  }
}

export class GovernedToolAuthorizationError extends Error {}
export class GovernedToolRecoveryError extends Error {}
export class GovernedToolCatalogError extends Error {}
