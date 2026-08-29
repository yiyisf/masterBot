import type { AgentId, AgentRevisionId, ResolvedAgentRevision } from '@cmaster/agents';
import type { ConversationId, MessageId } from '@cmaster/conversations';
import type { OrganizationId, PrincipalId, RequestIdentity } from '@cmaster/identity';
import type { Brand } from '@cmaster/kernel';

export type RunId = Brand<string, 'RunId'>;
export type InvocationId = Brand<string, 'InvocationId'>;
export type RunEventId = Brand<string, 'RunEventId'>;
export type DispatchAttemptId = Brand<string, 'DispatchAttemptId'>;
export type RunCommandId = Brand<string, 'RunCommandId'>;

export type RunStatus = 'accepted' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type InvocationStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type RunEventType =
  | 'run.accepted'
  | 'invocation.created'
  | 'run.queued'
  | 'run.started'
  | 'invocation.started'
  | 'run.recovery_started'
  | 'invocation.output_ready'
  | 'assistant_message.appended'
  | 'invocation.succeeded'
  | 'run.succeeded'
  | 'invocation.cancelled'
  | 'run.cancelled'
  | 'run.failed';

export interface RunFailure {
  code: 'engine_failed' | 'dispatch_attempts_exhausted' | 'output_delivery_failed';
  message: string;
  retryable: boolean;
}

export interface RunSnapshot {
  id: RunId;
  organizationId: OrganizationId;
  initiatingPrincipalId: PrincipalId;
  conversationId: ConversationId;
  trigger: { type: 'message'; messageId: MessageId };
  agentId: AgentId;
  agentRevisionId: AgentRevisionId;
  engine: { kind: 'echo'; version: '1' };
  rootInvocation: {
    id: InvocationId;
    status: InvocationStatus;
  };
  status: RunStatus;
  cancellable: boolean;
  lastSequence: number;
  assistantMessageId?: MessageId;
  failure?: RunFailure;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface RunEventEnvelope {
  schemaVersion: 1;
  eventId: RunEventId;
  runId: RunId;
  sequence: number;
  type: RunEventType;
  timestamp: Date;
  causationId?: string;
  correlationId: RunId;
  data: unknown;
}

export interface AcceptRunCommand {
  commandId: RunCommandId;
  messageId: MessageId;
  conversationId: ConversationId;
  agent: ResolvedAgentRevision;
}

export interface CommandResult<Value> {
  value: Value;
  replayed: boolean;
}

export type CancelRunResult =
  | { kind: 'cancelled'; run: RunSnapshot; replayed: boolean }
  | { kind: 'too_late'; run: RunSnapshot; replayed: boolean };

/**
 * Owns durable Run acceptance, cancellation, snapshots, and ordered Event replay.
 * Acceptance atomically persists the Run, root Invocation, initial Events, and Outbox entry before returning.
 * Commands are Organization-scoped and idempotent; key reuse with another payload throws
 * RunIdempotencyConflictError. Missing or cross-Organization resources throw RunNotFoundError.
 * Event reads are indexed by (runId, sequence), return strict ascending order, and are linear in the page read.
 */
export interface ExecutionModule {
  acceptRun(identity: RequestIdentity, command: AcceptRunCommand): Promise<CommandResult<RunSnapshot>>;
  getRun(identity: RequestIdentity, runId: RunId): Promise<RunSnapshot>;
  cancelRun(identity: RequestIdentity, runId: RunId, commandId: RunCommandId): Promise<CancelRunResult>;
  readEvents(identity: RequestIdentity, runId: RunId, afterSequence: number): Promise<RunEventEnvelope[]>;
}

export class RunNotFoundError extends Error {}
export class RunIdempotencyConflictError extends Error {}
export class StaleLeaseError extends Error {}

export function runId(value: string): RunId {
  return value as RunId;
}
export function runCommandId(value: string): RunCommandId {
  return value as RunCommandId;
}
