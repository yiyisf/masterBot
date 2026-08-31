import type { AgentId, AgentRevisionId, ResolvedAgentRevision } from '@cmaster/agents';
import type { ConversationId, MessageId } from '@cmaster/conversations';
import type { OrganizationId, PrincipalId, RequestIdentity } from '@cmaster/identity';
import type { Brand } from '@cmaster/kernel';
import type { ModelFailure, ModelProfileId, ModelUsage } from '@cmaster/models';

export type RunId = Brand<string, 'RunId'>;
export type InvocationId = Brand<string, 'InvocationId'>;
export type RunEventId = Brand<string, 'RunEventId'>;
export type DispatchAttemptId = Brand<string, 'DispatchAttemptId'>;
export type RunCommandId = Brand<string, 'RunCommandId'>;
export type InterruptId = Brand<string, 'InterruptId'>;

export type RunStatus = 'accepted' | 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
export type InvocationStatus = 'pending' | 'running' | 'interrupted' | 'succeeded' | 'failed' | 'cancelled';
export type InterruptKind = 'tool_confirmation' | 'tool_outcome_review';
export type InterruptResponse = 'confirm' | 'reject' | 'continue_with_uncertainty';
export type RunEventType =
  | 'run.accepted'
  | 'invocation.created'
  | 'run.queued'
  | 'run.started'
  | 'invocation.started'
  | 'run.recovery_started'
  | 'interrupt.requested'
  | 'interrupt.resolved'
  | 'run.waiting'
  | 'run.resumed'
  | 'model.selected'
  | 'model.fallback_selected'
  | 'model.output_discarded'
  | 'model.completed'
  | 'model.failed'
  | 'invocation.output_started'
  | 'invocation.output_delta'
  | 'invocation.output_reset'
  | 'invocation.output_completed'
  | 'invocation.output_ready'
  | 'assistant_message.appended'
  | 'invocation.succeeded'
  | 'run.succeeded'
  | 'invocation.cancelled'
  | 'run.cancelled'
  | 'run.failed';

export interface RunFailure {
  code: 'engine_failed' | 'model_failed' | 'dispatch_attempts_exhausted' | 'output_delivery_failed';
  message: string;
  retryable: boolean;
}

export interface ActiveInterrupt {
  id: InterruptId;
  kind: InterruptKind;
  status: 'pending';
  subjectRef: string;
  safeSubjectSummary: { title: string; details: Readonly<Record<string, string>> };
  allowedResponses: readonly InterruptResponse[];
}

export interface ExecutionCheckpoint {
  schemaVersion: 1;
  engineKind: 'echo' | 'ai-sdk';
  engineVersion: '1';
  toolCallId: string;
  outcome: 'confirmation_required' | 'requires_review';
}

export interface RequestInterruptCommand {
  kind: InterruptKind;
  subjectRef: string;
  safeSubjectSummary: ActiveInterrupt['safeSubjectSummary'];
  allowedResponses: readonly InterruptResponse[];
  checkpoint: ExecutionCheckpoint;
}

export interface ResolveInterruptCommand {
  commandId: RunCommandId;
  response: InterruptResponse;
}

export interface RunSnapshot {
  id: RunId;
  organizationId: OrganizationId;
  initiatingPrincipalId: PrincipalId;
  conversationId: ConversationId;
  trigger: { type: 'message'; messageId: MessageId };
  agentId: AgentId;
  agentRevisionId: AgentRevisionId;
  engine: { kind: 'echo' | 'ai-sdk'; version: '1' };
  rootInvocation: {
    id: InvocationId;
    status: InvocationStatus;
  };
  status: RunStatus;
  cancellable: boolean;
  lastSequence: number;
  assistantMessageId?: MessageId;
  model?: {
    profileId: ModelProfileId;
    displayName: string;
    fallbackUsed: boolean;
  };
  usage?: ModelUsage;
  failure?: RunFailure;
  activeInterrupt?: ActiveInterrupt;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export type ExecutionProgressEvent =
  | { type: 'model_selected'; profileId: ModelProfileId; displayName: string; fallback: boolean }
  | { type: 'model_fallback_selected'; fromProfileId: ModelProfileId; toProfileId: ModelProfileId; displayName: string }
  | { type: 'model_output_discarded'; profileId: ModelProfileId; reason: 'fallback' | 'failure' }
  | { type: 'model_completed'; profileId: ModelProfileId; usage: ModelUsage; fallbackUsed: boolean }
  | { type: 'model_failed'; profileId: ModelProfileId; failure: ModelFailure; hadOutput: boolean }
  | { type: 'output_started'; generation: number }
  | { type: 'output_delta'; generation: number; text: string }
  | { type: 'output_reset'; generation: number; reason: 'fallback' | 'failure' | 'recovery' }
  | { type: 'output_completed'; generation: number };

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
  resolveInterrupt(
    identity: RequestIdentity,
    runId: RunId,
    interruptId: InterruptId,
    command: ResolveInterruptCommand,
  ): Promise<CommandResult<RunSnapshot>>;
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
export function interruptId(value: string): InterruptId {
  return value as InterruptId;
}
