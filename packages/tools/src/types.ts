import type { AgentRevisionId } from '@cmaster/agents';
import type { Approval, ApprovalCommandId } from '@cmaster/governance';
import type { OrganizationId, RequestIdentity } from '@cmaster/identity';
import type { Brand } from '@cmaster/kernel';

export type ToolRevisionId = Brand<string, 'ToolRevisionId'>;
export type ToolGrantId = Brand<string, 'ToolGrantId'>;
export type ToolCallId = Brand<string, 'ToolCallId'>;
export type CredentialLeaseId = Brand<string, 'CredentialLeaseId'>;

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
  outputSchema: JsonSchema;
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
  agentRevisionId: AgentRevisionId;
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

export interface CredentialLease {
  id: CredentialLeaseId;
  organizationId: OrganizationId;
  principalId: RequestIdentity['principalId'];
  toolCallId: ToolCallId;
  invocationId: string;
  allowedOperations: readonly string[];
  expiresAt: Date;
  /** Secret values are in-memory only and must never be persisted, logged, or returned to Browser contracts. */
  values: Readonly<Record<string, string>>;
}

export interface IssueCredentialLeaseCommand {
  identity: RequestIdentity;
  toolCallId: ToolCallId;
  invocationId: string;
  capabilityId: string;
  allowedOperations: readonly string[];
}

/**
 * 仅在授权后签发 operation-scoped Credential Lease，并在 Dispatch Attempt 后撤销。
 * 实现不得持久化或暴露 Credential value。
 */
export interface CredentialBroker {
  issue(command: IssueCredentialLeaseCommand): Promise<CredentialLease>;
  revoke(leaseId: CredentialLeaseId): Promise<void>;
}

export interface ToolProviderRequest {
  toolCallId: ToolCallId;
  revision: ToolDescriptor;
  runId: string;
  invocationId: string;
  input: unknown;
  idempotencyKey: string;
  credentialLease: CredentialLease;
  signal: AbortSignal;
}

export type ToolProviderResult = {
  kind: 'success';
  value: unknown;
  safeSummary: SafeToolSummary;
  externalOperationId?: string;
};

/**
 * Adapter owned by Tools. Implementations must not return raw Provider errors or
 * summaries containing credentials; Runtime validates all returned payloads before persistence.
 */
export interface ToolProvider {
  readonly key: string;
  summarize(input: unknown): SafeToolSummary;
  execute(request: ToolProviderRequest): Promise<ToolProviderResult>;
  /**
   * 查询稳定 idempotency key 对应的外部状态，不重发原副作用。无法确认时应拒绝，
   * Runtime 会把 ToolCall 转为 requires_review。
   */
  reconcile?(request: ToolProviderRequest): Promise<ToolProviderResult>;
}

export interface InvokeToolCommand {
  identity: RequestIdentity;
  agentRevisionId: AgentRevisionId;
  principalEntitlements: readonly string[];
  runId: string;
  invocationId: string;
  modelRequestId: string;
  capabilityId: string;
  input: unknown;
  signal: AbortSignal;
}

export interface ResumeToolCallCommand {
  identity: RequestIdentity;
  toolCallId: ToolCallId;
  commandId: ApprovalCommandId;
  response: 'confirm' | 'reject';
  principalEntitlements: readonly string[];
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
    kind: 'denied';
    toolCallId: ToolCallId;
    reason: 'employee_rejected' | 'authorization_revoked';
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
  status: 'running' | 'succeeded' | 'failed' | 'denied' | 'requires_review' | 'awaiting_confirmation';
  idempotencyKey: string;
  requestHash: string;
  requestSummary: SafeToolSummary;
  outcome?: ToolOutcome;
}

/**
 * Owns authorization, immutable ToolCall/Dispatch Attempt Ledger records and Provider dispatch.
 * invoke is idempotent by Invocation/model request and replays durable outcomes without dispatch.
 * resume resolves one initiating-Employee Approval, reauthorizes, and fences exactly one dispatch.
 * Provider failures are returned only as stable ToolOutcome variants; persistence conflicts throw.
 */
export interface ToolRuntime {
  invoke(command: InvokeToolCommand): Promise<ToolOutcome>;
  resume(command: ResumeToolCallCommand): Promise<ToolOutcome>;
  listCalls(identity: RequestIdentity, runId: string): Promise<ToolCall[]>;
}

export interface ListGrantedTools {
  organizationId: OrganizationId;
  agentRevisionId: AgentRevisionId;
}

/**
 * Owns immutable Tool Capability/Revision metadata and Agent Tool Grants.
 * list resolves the immutable Grant bound to the Agent Revision and returns only its active
 * Tool Revisions in Capability ID order. A Revision without a binding sees no Tools.
 */
export interface ToolCatalog {
  provision(organizationId: OrganizationId, input: ToolCatalogProvisioning): Promise<void>;
  deactivate(organizationId: OrganizationId, revisionId: ToolRevisionId): Promise<void>;
  list(query: ListGrantedTools): Promise<ToolDescriptor[]>;
}

export class ToolProvisioningConflictError extends Error {}
export class ToolRevisionNotFoundError extends Error {}

export function toolRevisionId(value: string): ToolRevisionId {
  return value as ToolRevisionId;
}

export function toolGrantId(value: string): ToolGrantId {
  return value as ToolGrantId;
}
