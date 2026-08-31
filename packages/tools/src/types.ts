import type { AgentRevisionId } from '@cmaster/agents';
import type { Approval } from '@cmaster/governance';
import type { OrganizationId, RequestIdentity } from '@cmaster/identity';
import type { Brand } from '@cmaster/kernel';

export type ToolRevisionId = Brand<string, 'ToolRevisionId'>;
export type ToolGrantId = Brand<string, 'ToolGrantId'>;
export type ToolCallId = Brand<string, 'ToolCallId'>;

export type ToolEffect = 'read_only' | 'idempotent_write' | 'non_idempotent_write';
export type ToolRecovery = 'retry_same_call' | 'idempotency_key' | 'reconcile' | 'manual_review';
export type ToolRisk = 'destructive' | 'open_world' | 'handles_sensitive_data';
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ToolDescriptor {
  revisionId: ToolRevisionId;
  capabilityId: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  effect: ToolEffect;
  recovery: ToolRecovery;
  risks: readonly ToolRisk[];
}

export interface ToolRevisionProvisioning extends Omit<ToolDescriptor, 'revisionId'> {
  id: ToolRevisionId;
  providerKey: string;
}

export interface ToolGrantProvisioning {
  id: ToolGrantId;
  capabilityIds: readonly string[];
}

export interface ToolCatalogProvisioning {
  revisions: readonly ToolRevisionProvisioning[];
  grants: readonly ToolGrantProvisioning[];
}

export interface SafeToolSummary {
  title: string;
  details: Readonly<Record<string, string>>;
}

export interface ToolProviderRequest {
  toolCallId: ToolCallId;
  revision: ToolDescriptor;
  runId: string;
  invocationId: string;
  input: unknown;
  idempotencyKey: string;
  signal: AbortSignal;
}

export type ToolProviderResult = {
  kind: 'success';
  value: unknown;
  safeSummary: SafeToolSummary;
  externalOperationId?: string;
};

export interface ToolProvider {
  readonly key: string;
  summarize(input: unknown): SafeToolSummary;
  execute(request: ToolProviderRequest): Promise<ToolProviderResult>;
}

export interface InvokeToolCommand {
  identity: RequestIdentity;
  agentRevisionId: AgentRevisionId;
  grantId: ToolGrantId;
  principalEntitlements: readonly string[];
  runId: string;
  invocationId: string;
  modelRequestId: string;
  capabilityId: string;
  input: unknown;
  signal: AbortSignal;
}

export type ToolOutcome =
  | {
    kind: 'success';
    toolCallId: ToolCallId;
    value: unknown;
    safeSummary: SafeToolSummary;
  }
  | {
    kind: 'confirmation_required';
    toolCallId: ToolCallId;
    approval: Approval;
    safeSummary: SafeToolSummary;
  }
  | {
    kind: 'failed';
    toolCallId: ToolCallId;
    failure: { code: 'provider_failed'; message: string; retryable: boolean };
  }
  | {
    kind: 'requires_review';
    toolCallId: ToolCallId;
    failure: { code: 'external_effect_unknown'; message: string; retryable: false };
  };

export interface ToolCall {
  id: ToolCallId;
  organizationId: OrganizationId;
  runId: string;
  invocationId: string;
  capabilityId: string;
  revisionId: ToolRevisionId;
  status: 'running' | 'succeeded' | 'failed' | 'requires_review' | 'awaiting_confirmation';
  idempotencyKey: string;
  requestHash: string;
  requestSummary: SafeToolSummary;
  outcome?: ToolOutcome;
}

export interface ToolRuntime {
  invoke(command: InvokeToolCommand): Promise<ToolOutcome>;
  listCalls(organizationId: OrganizationId, runId: string): Promise<ToolCall[]>;
}

export interface ListGrantedTools {
  organizationId: OrganizationId;
  grantId: ToolGrantId;
}

/**
 * Owns immutable Tool Capability/Revision metadata and Agent Tool Grants.
 * list returns only active Revisions in the requested Organization and grant, ordered by Capability ID.
 */
export interface ToolCatalog {
  provision(organizationId: OrganizationId, input: ToolCatalogProvisioning): Promise<void>;
  list(query: ListGrantedTools): Promise<ToolDescriptor[]>;
}

export class ToolProvisioningConflictError extends Error {}

export function toolRevisionId(value: string): ToolRevisionId {
  return value as ToolRevisionId;
}

export function toolGrantId(value: string): ToolGrantId {
  return value as ToolGrantId;
}
