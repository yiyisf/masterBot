import { createHash, randomUUID } from 'node:crypto';
import type { AgentRevisionId, ResolvedAgentRevision } from '@cmaster/agents';
import type { ConversationId, MessageId } from '@cmaster/conversations';
import type { OrganizationId, PrincipalId, RequestIdentity } from '@cmaster/identity';
import type { ModelProfileId, ModelUsage } from '@cmaster/models';
import type { Pool, PoolClient } from 'pg';
import {
  type AcceptRunCommand,
  type CancelRunResult,
  type CommandResult,
  type DispatchAttemptId,
  type ExecutionCheckpoint,
  type ExecutionInterrupt,
  type ExecutionModule,
  type ExecutionProgressEvent,
  type ActiveInterrupt,
  type InterruptId,
  type InterruptKind,
  type InterruptResponse,
  type InvocationId,
  type InvocationStatus,
  type RequestInterruptCommand,
  type ResolveInterruptCommand,
  type RunCommandId,
  type RunEventEnvelope,
  type RunEventType,
  type RunFailure,
  type RunId,
  RunIdempotencyConflictError,
  RunNotFoundError,
  type RunSnapshot,
  type RunStatus,
  type ToolBoundaryLease,
  type ToolBoundaryLeaseId,
  StaleLeaseError,
} from './types.js';

interface RunRow {
  id: string;
  organization_id: string;
  initiating_principal_id: string;
  conversation_id: string;
  trigger_ref: string;
  agent_id: string;
  agent_revision_id: string;
  resolved_engine_kind: 'echo' | 'ai-sdk';
  resolved_engine_version: '1';
  root_invocation_id: string;
  status: RunStatus;
  last_sequence: number;
  assistant_message_id: string | null;
  resolved_model_profile_id: string | null;
  resolved_model_display_name: string | null;
  model_fallback_used: boolean;
  model_usage: ModelUsage | null;
  failure: RunFailure | null;
  idempotency_key: string;
  request_hash: string;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  invocation_status: InvocationStatus;
  prepared_output: { text: string } | null;
  output_generation: number;
  has_streamed_output: boolean;
  interrupt_id: string | null;
  interrupt_kind: ActiveInterrupt['kind'] | null;
  interrupt_subject_ref: string | null;
  interrupt_safe_subject_summary: ActiveInterrupt['safeSubjectSummary'] | null;
  interrupt_allowed_responses: ActiveInterrupt['allowedResponses'] | null;
  latest_checkpoint_data: ExecutionCheckpoint | null;
  latest_interrupt_resolution: InterruptResponse | null;
  tool_boundary_id: string | null;
  tool_boundary_expires_at: Date | null;
  tool_boundary_active: boolean;
}

interface EventRow {
  event_id: string;
  run_id: string;
  sequence: number;
  schema_version: 1;
  event_type: RunEventType;
  event_data: unknown;
  causation_id: string | null;
  correlation_id: string;
  created_at: Date;
}

export interface RunLease {
  runId: RunId;
  organizationId: OrganizationId;
  initiatingPrincipalId: PrincipalId;
  conversationId: ConversationId;
  messageId: MessageId;
  invocationId: InvocationId;
  agentRevisionId: AgentRevisionId;
  engineKind: 'echo' | 'ai-sdk';
  engineVersion: '1';
  leaseToken: string;
  attemptId: DispatchAttemptId;
  attemptNumber: number;
  outputGeneration: number;
  hasStreamedOutput: boolean;
  preparedOutput?: string;
  checkpoint?: ExecutionCheckpoint;
  resumeResponse?: InterruptResponse;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function mapRun(row: RunRow): RunSnapshot {
  return {
    id: row.id as RunId,
    organizationId: row.organization_id as OrganizationId,
    initiatingPrincipalId: row.initiating_principal_id as PrincipalId,
    conversationId: row.conversation_id as ConversationId,
    trigger: { type: 'message', messageId: row.trigger_ref as MessageId },
    agentId: row.agent_id as RunSnapshot['agentId'],
    agentRevisionId: row.agent_revision_id as RunSnapshot['agentRevisionId'],
    engine: { kind: row.resolved_engine_kind, version: row.resolved_engine_version },
    rootInvocation: {
      id: row.root_invocation_id as InvocationId,
      status: row.invocation_status,
    },
    status: row.status,
    cancellable: ['accepted', 'queued', 'running', 'waiting'].includes(row.status)
      && row.prepared_output === null,
    lastSequence: row.last_sequence,
    ...(row.assistant_message_id === null
      ? {}
      : { assistantMessageId: row.assistant_message_id as MessageId }),
    ...(row.resolved_model_profile_id === null || row.resolved_model_display_name === null
      ? {}
      : {
        model: {
          profileId: row.resolved_model_profile_id as ModelProfileId,
          displayName: row.resolved_model_display_name,
          fallbackUsed: row.model_fallback_used,
        },
      }),
    ...(row.model_usage === null ? {} : { usage: row.model_usage }),
    ...(row.failure === null ? {} : { failure: row.failure }),
    ...(row.interrupt_id === null || row.interrupt_kind === null
      || row.interrupt_subject_ref === null || row.interrupt_safe_subject_summary === null
      || row.interrupt_allowed_responses === null
      ? {}
      : {
        activeInterrupt: {
          id: row.interrupt_id as InterruptId,
          kind: row.interrupt_kind,
          status: 'pending' as const,
          subjectRef: row.interrupt_subject_ref,
          safeSubjectSummary: row.interrupt_safe_subject_summary,
          allowedResponses: row.interrupt_allowed_responses,
        },
      }),
    createdAt: row.created_at,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  };
}

function mapEvent(row: EventRow): RunEventEnvelope {
  return {
    schemaVersion: row.schema_version,
    eventId: row.event_id as RunEventEnvelope['eventId'],
    runId: row.run_id as RunId,
    sequence: row.sequence,
    type: row.event_type,
    timestamp: row.created_at,
    ...(row.causation_id === null ? {} : { causationId: row.causation_id }),
    correlationId: row.correlation_id as RunId,
    data: row.event_data,
  };
}

const runSelect = `
  SELECT r.*, i.status AS invocation_status, i.prepared_output,
         i.output_generation, i.has_streamed_output,
         (r.tool_boundary_id IS NOT NULL
           AND r.tool_boundary_expires_at > clock_timestamp()) AS tool_boundary_active,
         active_interrupt.id AS interrupt_id,
         active_interrupt.kind AS interrupt_kind,
         active_interrupt.subject_ref AS interrupt_subject_ref,
         active_interrupt.safe_subject_summary AS interrupt_safe_subject_summary,
         active_interrupt.allowed_responses AS interrupt_allowed_responses,
         latest_checkpoint.checkpoint_data AS latest_checkpoint_data,
         latest_checkpoint.resolution AS latest_interrupt_resolution
  FROM runs r
  JOIN invocations i
    ON i.organization_id = r.organization_id
   AND i.id = r.root_invocation_id
  LEFT JOIN LATERAL (
    SELECT id, kind, subject_ref, safe_subject_summary, allowed_responses
    FROM execution_interrupts
    WHERE organization_id = r.organization_id AND run_id = r.id AND status = 'pending'
    LIMIT 1
  ) active_interrupt ON true
  LEFT JOIN LATERAL (
    SELECT c.checkpoint_data, x.resolution
    FROM execution_checkpoints c
    LEFT JOIN execution_interrupts x
      ON x.organization_id = c.organization_id AND x.checkpoint_id = c.id
    WHERE c.organization_id = r.organization_id AND c.run_id = r.id AND c.consumed_at IS NULL
    ORDER BY c.created_at DESC
    LIMIT 1
  ) latest_checkpoint ON true
`;

async function selectRun(
  client: Pool | PoolClient,
  organizationId: string,
  runId: string,
  lock = false,
): Promise<RunRow | undefined> {
  const result = await client.query<RunRow>(
    `${runSelect} WHERE r.organization_id = $1 AND r.id = $2${lock ? ' FOR UPDATE OF r' : ''}`,
    [organizationId, runId],
  );
  return result.rows[0];
}

async function appendEvent(
  client: PoolClient,
  organizationId: string,
  runId: string,
  type: RunEventType,
  data: unknown,
  causationId?: string,
): Promise<RunEventEnvelope> {
  const sequenceResult = await client.query<{ last_sequence: number }>(
    `UPDATE runs SET last_sequence = last_sequence + 1
     WHERE organization_id = $1 AND id = $2
     RETURNING last_sequence`,
    [organizationId, runId],
  );
  const sequence = sequenceResult.rows[0]?.last_sequence;
  if (sequence === undefined) throw new RunNotFoundError();
  const inserted = await client.query<EventRow>(
    `INSERT INTO run_events (
       event_id, organization_id, run_id, sequence, event_type,
       event_data, causation_id, correlation_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $3)
     RETURNING *`,
    [randomUUID(), organizationId, runId, sequence, type, JSON.stringify(data), causationId ?? null],
  );
  await client.query(`SELECT pg_notify('cmaster_run_events', $1)`, [
    JSON.stringify({ runId, lastSequence: sequence }),
  ]);
  return mapEvent(inserted.rows[0]!);
}

async function verifyLease(
  client: PoolClient,
  lease: RunLease,
): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM run_dispatch
     WHERE run_id = $1 AND organization_id = $2 AND status = 'pending'
       AND lease_token = $3 AND lease_expires_at > clock_timestamp()
     FOR UPDATE`,
    [lease.runId, lease.organizationId, lease.leaseToken],
  );
  if (result.rowCount !== 1) throw new StaleLeaseError();
}

export class PostgresExecutionModule implements ExecutionModule {
  constructor(private readonly pool: Pool) {}

  async acceptRun(
    identity: RequestIdentity,
    command: AcceptRunCommand,
  ): Promise<CommandResult<RunSnapshot>> {
    const requestHash = digest({ messageId: command.messageId });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `run:${identity.organizationId}:${command.commandId}`,
      ]);
      const existing = await client.query<RunRow>(
        `${runSelect} WHERE r.organization_id = $1 AND r.idempotency_key = $2`,
        [identity.organizationId, command.commandId],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) throw new RunIdempotencyConflictError();
        await client.query('COMMIT');
        return { value: mapRun(previous), replayed: true };
      }

      const runId = randomUUID();
      const invocationId = randomUUID();
      await client.query(
        `INSERT INTO runs (
           id, organization_id, initiating_principal_id, conversation_id,
           trigger_type, trigger_ref, agent_id, agent_revision_id,
           resolved_engine_kind, resolved_engine_version, root_invocation_id,
           status, idempotency_key, request_hash
         ) VALUES ($1, $2, $3, $4, 'message', $5, $6, $7, $8, $9, $10, 'accepted', $11, $12)`,
        [runId, identity.organizationId, identity.principalId, command.conversationId,
          command.messageId, command.agent.agentId, command.agent.agentRevisionId,
          command.agent.engineKind, command.agent.engineVersion, invocationId,
          command.commandId, requestHash],
      );
      await client.query(
        `INSERT INTO invocations (
           id, organization_id, run_id, agent_revision_id,
           engine_kind, engine_version, status
         ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
        [invocationId, identity.organizationId, runId, command.agent.agentRevisionId,
          command.agent.engineKind, command.agent.engineVersion],
      );
      await appendEvent(client, identity.organizationId, runId, 'run.accepted', {
        triggerType: 'message', messageId: command.messageId,
      }, command.commandId);
      await appendEvent(client, identity.organizationId, runId, 'invocation.created', {
        invocationId, agentRevisionId: command.agent.agentRevisionId,
      }, command.commandId);
      await client.query(
        `INSERT INTO execution_outbox (
           id, organization_id, aggregate_id, event_type, payload
         ) VALUES ($1, $2, $3, 'run.dispatch.requested', $4)`,
        [randomUUID(), identity.organizationId, runId, JSON.stringify({ runId })],
      );
      const created = await selectRun(client, identity.organizationId, runId);
      await client.query('COMMIT');
      return { value: mapRun(created!), replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getRun(identity: RequestIdentity, runId: RunId): Promise<RunSnapshot> {
    const row = await selectRun(this.pool, identity.organizationId, runId);
    if (!row || row.initiating_principal_id !== identity.principalId) throw new RunNotFoundError();
    return mapRun(row);
  }

  async getInterrupt(
    identity: RequestIdentity,
    runId: RunId,
    interruptId: InterruptId,
  ): Promise<ExecutionInterrupt> {
    const result = await this.pool.query<{
      id: string;
      kind: InterruptKind;
      status: ExecutionInterrupt['status'];
      subject_ref: string;
      safe_subject_summary: ExecutionInterrupt['safeSubjectSummary'];
      allowed_responses: InterruptResponse[];
      resolution: InterruptResponse | 'run_cancelled' | null;
    }>(
      `SELECT x.id, x.kind, x.status, x.subject_ref, x.safe_subject_summary,
              x.allowed_responses, x.resolution
       FROM execution_interrupts x
       JOIN runs r ON r.organization_id = x.organization_id AND r.id = x.run_id
       WHERE x.organization_id = $1 AND x.run_id = $2 AND x.id = $3
         AND r.initiating_principal_id = $4`,
      [identity.organizationId, runId, interruptId, identity.principalId],
    );
    const row = result.rows[0];
    if (!row) throw new RunNotFoundError();
    return {
      id: row.id as InterruptId,
      kind: row.kind,
      status: row.status,
      subjectRef: row.subject_ref,
      safeSubjectSummary: row.safe_subject_summary,
      allowedResponses: row.allowed_responses,
      ...(row.resolution === null ? {} : { resolution: row.resolution }),
    };
  }

  async enterToolBoundary(
    identity: RequestIdentity,
    runId: RunId,
  ): Promise<ToolBoundaryLease> {
    const id = randomUUID() as ToolBoundaryLeaseId;
    const entered = await this.pool.query<{ tool_boundary_expires_at: Date }>(
      `UPDATE runs
       SET tool_boundary_id = $4,
           tool_boundary_expires_at = clock_timestamp() + interval '35 seconds'
       WHERE organization_id = $1 AND id = $2 AND initiating_principal_id = $3
         AND status IN ('running', 'waiting')
         AND (tool_boundary_id IS NULL OR tool_boundary_expires_at <= clock_timestamp())
       RETURNING tool_boundary_expires_at`,
      [identity.organizationId, runId, identity.principalId, id],
    );
    const expiresAt = entered.rows[0]?.tool_boundary_expires_at;
    if (!expiresAt) throw new StaleLeaseError();
    return { id, expiresAt };
  }

  async leaveToolBoundary(
    identity: RequestIdentity,
    runId: RunId,
    lease: ToolBoundaryLease,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE runs SET tool_boundary_id = NULL, tool_boundary_expires_at = NULL
       WHERE organization_id = $1 AND id = $2 AND initiating_principal_id = $3
         AND tool_boundary_id = $4`,
      [identity.organizationId, runId, identity.principalId, lease.id],
    );
  }

  async cancelRun(
    identity: RequestIdentity,
    runId: RunId,
    commandId: RunCommandId,
  ): Promise<CancelRunResult> {
    const requestHash = digest({ runId });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `cancel:${identity.organizationId}:${commandId}`,
      ]);
      const receipt = await client.query<{
        target_run_id: string;
        request_hash: string;
        response_body: { kind: 'cancelled' | 'tool_effect_in_flight' | 'too_late' };
      }>(
        `SELECT target_run_id, request_hash, response_body
         FROM run_command_receipts
         WHERE organization_id = $1 AND command_type = 'cancel' AND idempotency_key = $2`,
        [identity.organizationId, commandId],
      );
      const prior = receipt.rows[0];
      if (prior) {
        if (prior.request_hash !== requestHash || prior.target_run_id !== runId) {
          throw new RunIdempotencyConflictError();
        }
        const current = await selectRun(client, identity.organizationId, runId);
        if (!current || current.initiating_principal_id !== identity.principalId) {
          throw new RunNotFoundError();
        }
        await client.query('COMMIT');
        return { kind: prior.response_body.kind, run: mapRun(current), replayed: true };
      }

      // Worker transitions lock Dispatch before Run; cancellation uses the same order.
      await client.query(
        `SELECT run_id FROM run_dispatch
         WHERE organization_id = $1 AND run_id = $2 FOR UPDATE`,
        [identity.organizationId, runId],
      );
      const row = await selectRun(client, identity.organizationId, runId, true);
      if (!row || row.initiating_principal_id !== identity.principalId) throw new RunNotFoundError();
      const tooLate = row.prepared_output !== null || ['succeeded', 'failed'].includes(row.status);
      const kind: 'cancelled' | 'tool_effect_in_flight' | 'too_late' = tooLate
        ? 'too_late'
        : row.tool_boundary_active
          ? 'tool_effect_in_flight'
          : 'cancelled';
      if (kind === 'cancelled' && row.status !== 'cancelled') {
        await client.query(
          `UPDATE runs SET status = 'cancelled', completed_at = clock_timestamp()
           WHERE organization_id = $1 AND id = $2`,
          [identity.organizationId, runId],
        );
        await client.query(
          `UPDATE invocations SET status = 'cancelled', completed_at = clock_timestamp()
           WHERE organization_id = $1 AND id = $2`,
          [identity.organizationId, row.root_invocation_id],
        );
        await client.query(
          `UPDATE run_dispatch SET status = 'cancelled', updated_at = clock_timestamp()
           WHERE organization_id = $1 AND run_id = $2`,
          [identity.organizationId, runId],
        );
        const cancelledInterrupt = await client.query<{ id: string }>(
          `UPDATE execution_interrupts
           SET status = 'cancelled', resolution = 'run_cancelled',
             resolution_command_id = $3, resolved_at = clock_timestamp()
           WHERE organization_id = $1 AND run_id = $2 AND status = 'pending'
           RETURNING id`,
          [identity.organizationId, runId, commandId],
        );
        if (cancelledInterrupt.rows[0]) {
          await appendEvent(client, identity.organizationId, runId, 'interrupt.resolved', {
            interruptId: cancelledInterrupt.rows[0].id,
            response: 'run_cancelled',
          }, commandId);
        }
        await appendEvent(client, identity.organizationId, runId, 'invocation.cancelled', {
          invocationId: row.root_invocation_id,
        }, commandId);
        await appendEvent(client, identity.organizationId, runId, 'run.cancelled', {}, commandId);
      }
      await client.query(
        `INSERT INTO run_command_receipts (
           organization_id, command_type, idempotency_key, target_run_id,
           request_hash, response_status, response_body
         ) VALUES ($1, 'cancel', $2, $3, $4, $5, $6)`,
        [identity.organizationId, commandId, runId, requestHash,
          kind === 'cancelled' ? 200 : 409, JSON.stringify({ kind })],
      );
      const current = await selectRun(client, identity.organizationId, runId);
      await client.query('COMMIT');
      return { kind, run: mapRun(current!), replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveCheckpoint(lease: RunLease, checkpoint: ExecutionCheckpoint): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await verifyLease(client, lease);
      await client.query(
        `UPDATE execution_checkpoints SET consumed_at = clock_timestamp()
         WHERE organization_id = $1 AND run_id = $2 AND consumed_at IS NULL`,
        [lease.organizationId, lease.runId],
      );
      await client.query(
        `INSERT INTO execution_checkpoints (
           id, organization_id, run_id, invocation_id, schema_version, checkpoint_data
         ) VALUES ($1, $2, $3, $4, 1, $5)`,
        [randomUUID(), lease.organizationId, lease.runId, lease.invocationId,
          JSON.stringify(checkpoint)],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async requestInterrupt(
    lease: RunLease,
    command: RequestInterruptCommand,
  ): Promise<ActiveInterrupt> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await verifyLease(client, lease);
      const run = await selectRun(client, lease.organizationId, lease.runId, true);
      if (!run || run.status !== 'running' || run.prepared_output !== null) throw new StaleLeaseError();
      const checkpointId = randomUUID();
      const interruptId = randomUUID();
      await client.query(
        `UPDATE execution_checkpoints SET consumed_at = clock_timestamp()
         WHERE organization_id = $1 AND run_id = $2 AND consumed_at IS NULL`,
        [lease.organizationId, lease.runId],
      );
      await client.query(
        `INSERT INTO execution_checkpoints (
           id, organization_id, run_id, invocation_id, schema_version, checkpoint_data
         ) VALUES ($1, $2, $3, $4, 1, $5)`,
        [checkpointId, lease.organizationId, lease.runId, lease.invocationId,
          JSON.stringify(command.checkpoint)],
      );
      await client.query(
        `INSERT INTO execution_interrupts (
           id, organization_id, run_id, invocation_id, checkpoint_id, kind,
           subject_ref, safe_subject_summary, allowed_responses
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [interruptId, lease.organizationId, lease.runId, lease.invocationId,
          checkpointId, command.kind, command.subjectRef,
          JSON.stringify(command.safeSubjectSummary), JSON.stringify(command.allowedResponses)],
      );
      await client.query(
        `UPDATE runs SET status = 'waiting' WHERE organization_id = $1 AND id = $2`,
        [lease.organizationId, lease.runId],
      );
      await client.query(
        `UPDATE invocations SET status = 'interrupted'
         WHERE organization_id = $1 AND id = $2`,
        [lease.organizationId, lease.invocationId],
      );
      const released = await client.query(
        `UPDATE run_dispatch SET status = 'waiting', lease_owner = NULL,
           lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
         WHERE organization_id = $1 AND run_id = $2 AND lease_token = $3
         RETURNING run_id`,
        [lease.organizationId, lease.runId, lease.leaseToken],
      );
      if (released.rowCount !== 1) throw new StaleLeaseError();
      await appendEvent(client, lease.organizationId, lease.runId, 'interrupt.requested', {
        interruptId, kind: command.kind, subjectRef: command.subjectRef,
        safeSubjectSummary: command.safeSubjectSummary,
        allowedResponses: command.allowedResponses,
      }, lease.attemptId);
      await appendEvent(client, lease.organizationId, lease.runId, 'run.waiting', {
        interruptId, reason: command.kind,
      }, lease.attemptId);
      const current = await selectRun(client, lease.organizationId, lease.runId);
      await client.query('COMMIT');
      if (!current) throw new RunNotFoundError();
      const activeInterrupt = mapRun(current).activeInterrupt;
      if (!activeInterrupt) throw new RunNotFoundError();
      return activeInterrupt;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveInterrupt(
    identity: RequestIdentity,
    runId: RunId,
    interruptId: InterruptId,
    command: ResolveInterruptCommand,
  ): Promise<CommandResult<RunSnapshot>> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const run = await selectRun(client, identity.organizationId, runId, true);
      if (!run || run.initiating_principal_id !== identity.principalId) {
        throw new RunNotFoundError();
      }
      const selected = await client.query<{
        status: 'pending' | 'resolved' | 'cancelled';
        allowed_responses: string[];
        resolution: string | null;
        resolution_command_id: string | null;
      }>(
        `SELECT status, allowed_responses, resolution, resolution_command_id
         FROM execution_interrupts
         WHERE organization_id = $1 AND run_id = $2 AND id = $3 FOR UPDATE`,
        [identity.organizationId, runId, interruptId],
      );
      const interrupt = selected.rows[0];
      if (!interrupt) throw new RunNotFoundError();
      if (interrupt.status === 'resolved') {
        if (interrupt.resolution_command_id !== command.commandId
          || interrupt.resolution !== command.response) throw new RunIdempotencyConflictError();
        await client.query('COMMIT');
        return { value: mapRun(run), replayed: true };
      }
      if (run.status !== 'waiting' || !interrupt.allowed_responses.includes(command.response)) {
        throw new RunIdempotencyConflictError();
      }
      await client.query(
        `UPDATE execution_interrupts SET status = 'resolved', resolution = $4,
           resolution_command_id = $5, resolved_at = clock_timestamp()
         WHERE organization_id = $1 AND run_id = $2 AND id = $3 AND status = 'pending'`,
        [identity.organizationId, runId, interruptId, command.response, command.commandId],
      );
      await client.query(
        `UPDATE runs SET status = 'queued' WHERE organization_id = $1 AND id = $2`,
        [identity.organizationId, runId],
      );
      await client.query(
        `UPDATE invocations SET status = 'pending'
         WHERE organization_id = $1 AND id = $2 AND status = 'interrupted'`,
        [identity.organizationId, run.root_invocation_id],
      );
      await client.query(
        `UPDATE run_dispatch SET status = 'pending', available_at = clock_timestamp(),
           attempt_number = 0, updated_at = clock_timestamp()
         WHERE organization_id = $1 AND run_id = $2 AND status = 'waiting'`,
        [identity.organizationId, runId],
      );
      await appendEvent(client, identity.organizationId, runId, 'interrupt.resolved', {
        interruptId, response: command.response,
      }, command.commandId);
      await appendEvent(client, identity.organizationId, runId, 'run.resumed', {
        interruptId,
      }, command.commandId);
      const current = await selectRun(client, identity.organizationId, runId);
      await client.query('COMMIT');
      return { value: mapRun(current!), replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async readEvents(
    identity: RequestIdentity,
    runId: RunId,
    afterSequence: number,
  ): Promise<RunEventEnvelope[]> {
    await this.getRun(identity, runId);
    const result = await this.pool.query<EventRow>(
      `SELECT * FROM run_events
       WHERE organization_id = $1 AND run_id = $2 AND sequence > $3
       ORDER BY sequence ASC`,
      [identity.organizationId, runId, afterSequence],
    );
    return result.rows.map(mapEvent);
  }

  async relayNextOutbox(): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<{ id: string; organization_id: string; aggregate_id: string }>(
        `SELECT id, organization_id, aggregate_id FROM execution_outbox
         WHERE status = 'pending' AND available_at <= clock_timestamp()
         ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      const item = selected.rows[0];
      if (!item) {
        await client.query('COMMIT');
        return false;
      }
      const run = await selectRun(client, item.organization_id, item.aggregate_id, true);
      if (run && run.status === 'accepted') {
        await client.query(
          `INSERT INTO run_dispatch (run_id, organization_id)
           VALUES ($1, $2) ON CONFLICT (run_id) DO NOTHING`,
          [run.id, run.organization_id],
        );
        await client.query(
          `UPDATE runs SET status = 'queued' WHERE organization_id = $1 AND id = $2`,
          [run.organization_id, run.id],
        );
        await appendEvent(client, run.organization_id, run.id, 'run.queued', {}, item.id);
      }
      await client.query(
        `UPDATE execution_outbox
         SET status = 'published', published_at = clock_timestamp(), attempts = attempts + 1
         WHERE id = $1`,
        [item.id],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async leaseNext(
    owner: string,
    leaseTtlMs: number,
    maxAttempts: number,
  ): Promise<RunLease | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<{ run_id: string; organization_id: string; attempt_number: number }>(
        `SELECT run_id, organization_id, attempt_number FROM run_dispatch
         WHERE status = 'pending' AND available_at <= clock_timestamp()
           AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
         ORDER BY available_at ASC, created_at ASC
         FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      const candidate = selected.rows[0];
      if (!candidate) {
        await client.query('COMMIT');
        return undefined;
      }
      const run = await selectRun(client, candidate.organization_id, candidate.run_id, true);
      if (!run || ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
        await client.query(
          `UPDATE run_dispatch SET status = $2, updated_at = clock_timestamp() WHERE run_id = $1`,
          [candidate.run_id, run?.status === 'cancelled' ? 'cancelled' : 'completed'],
        );
        await client.query('COMMIT');
        return undefined;
      }
      // Once output_ready commits, delivery is the point of no return. Keep reconciling the
      // idempotent Assistant Message even when Engine-attempt recovery is exhausted.
      if (candidate.attempt_number >= maxAttempts && run.prepared_output === null) {
        const failure: RunFailure = {
          code: 'dispatch_attempts_exhausted',
          message: 'The run could not be recovered after repeated worker interruptions.',
          retryable: true,
        };
        await client.query(
          `UPDATE runs SET status = 'failed', failure = $3, completed_at = clock_timestamp()
           WHERE organization_id = $1 AND id = $2`,
          [run.organization_id, run.id, JSON.stringify(failure)],
        );
        await client.query(
          `UPDATE invocations SET status = 'failed', completed_at = clock_timestamp()
           WHERE organization_id = $1 AND id = $2`,
          [run.organization_id, run.root_invocation_id],
        );
        await client.query(
          `UPDATE run_dispatch SET status = 'failed', updated_at = clock_timestamp() WHERE run_id = $1`,
          [run.id],
        );
        await appendEvent(client, run.organization_id, run.id, 'run.failed', { failure });
        await client.query('COMMIT');
        return undefined;
      }

      const leaseToken = randomUUID();
      const attemptId = randomUUID();
      const attemptNumber = candidate.attempt_number + 1;
      await client.query(
        `UPDATE run_dispatch SET lease_owner = $2, lease_token = $3,
           lease_expires_at = clock_timestamp() + ($4 * interval '1 millisecond'),
           attempt_number = $5, updated_at = clock_timestamp()
         WHERE run_id = $1`,
        [run.id, owner, leaseToken, leaseTtlMs, attemptNumber],
      );
      if (run.status === 'queued' || run.status === 'accepted') {
        await client.query(
          `UPDATE runs SET status = 'running', started_at = COALESCE(started_at, clock_timestamp())
           WHERE organization_id = $1 AND id = $2`,
          [run.organization_id, run.id],
        );
        await client.query(
          `UPDATE invocations SET status = 'running', started_at = COALESCE(started_at, clock_timestamp())
           WHERE organization_id = $1 AND id = $2`,
          [run.organization_id, run.root_invocation_id],
        );
        if (run.latest_checkpoint_data === null) {
          await appendEvent(client, run.organization_id, run.id, 'run.started', {}, attemptId);
          await appendEvent(client, run.organization_id, run.id, 'invocation.started', {
            invocationId: run.root_invocation_id,
          }, attemptId);
        } else {
          await appendEvent(client, run.organization_id, run.id, 'run.recovery_started', {
            attemptNumber, checkpoint: true,
          }, attemptId);
        }
      } else if (attemptNumber > 1) {
        await appendEvent(client, run.organization_id, run.id, 'run.recovery_started', {
          attemptNumber,
        }, attemptId);
      }
      await client.query('COMMIT');
      return {
        runId: run.id as RunId,
        organizationId: run.organization_id as OrganizationId,
        initiatingPrincipalId: run.initiating_principal_id as PrincipalId,
        conversationId: run.conversation_id as ConversationId,
        messageId: run.trigger_ref as MessageId,
        invocationId: run.root_invocation_id as InvocationId,
        agentRevisionId: run.agent_revision_id as AgentRevisionId,
        engineKind: run.resolved_engine_kind,
        engineVersion: run.resolved_engine_version,
        leaseToken,
        attemptId: attemptId as DispatchAttemptId,
        attemptNumber,
        outputGeneration: run.output_generation,
        hasStreamedOutput: run.has_streamed_output,
        ...(run.prepared_output === null ? {} : { preparedOutput: run.prepared_output.text }),
        ...(run.latest_checkpoint_data === null ? {} : { checkpoint: run.latest_checkpoint_data }),
        ...(run.latest_interrupt_resolution === null
          ? {}
          : { resumeResponse: run.latest_interrupt_resolution }),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async heartbeat(lease: RunLease, leaseTtlMs: number): Promise<void> {
    const result = await this.pool.query(
      `UPDATE run_dispatch SET
         lease_expires_at = clock_timestamp() + ($4 * interval '1 millisecond'),
         updated_at = clock_timestamp()
       WHERE run_id = $1 AND organization_id = $2 AND lease_token = $3 AND status = 'pending'`,
      [lease.runId, lease.organizationId, lease.leaseToken, leaseTtlMs],
    );
    if (result.rowCount !== 1) throw new StaleLeaseError();
  }

  async recordProgress(lease: RunLease, events: readonly ExecutionProgressEvent[]): Promise<void> {
    if (events.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await verifyLease(client, lease);
      const run = await selectRun(client, lease.organizationId, lease.runId, true);
      if (!run || run.status !== 'running' || run.prepared_output !== null) throw new StaleLeaseError();
      let currentGeneration = run.output_generation;

      for (const event of events) {
        switch (event.type) {
          case 'model_selected':
            await client.query(
              `UPDATE runs SET resolved_model_profile_id = $3,
                 resolved_model_display_name = $4,
                 model_fallback_used = model_fallback_used OR $5
               WHERE organization_id = $1 AND id = $2`,
              [lease.organizationId, lease.runId, event.profileId, event.displayName, event.fallback],
            );
            await appendEvent(client, lease.organizationId, lease.runId, 'model.selected', {
              profileId: event.profileId,
              displayName: event.displayName,
              fallback: event.fallback,
            }, lease.attemptId);
            break;
          case 'model_fallback_selected':
            await client.query(
              `UPDATE runs SET resolved_model_profile_id = $3,
                 resolved_model_display_name = $4, model_fallback_used = true
               WHERE organization_id = $1 AND id = $2`,
              [lease.organizationId, lease.runId, event.toProfileId, event.displayName],
            );
            await appendEvent(client, lease.organizationId, lease.runId, 'model.fallback_selected', {
              fromProfileId: event.fromProfileId,
              toProfileId: event.toProfileId,
              displayName: event.displayName,
            }, lease.attemptId);
            break;
          case 'model_output_discarded':
            await appendEvent(client, lease.organizationId, lease.runId, 'model.output_discarded', {
              profileId: event.profileId,
              reason: event.reason,
            }, lease.attemptId);
            break;
          case 'model_completed':
            await client.query(
              `UPDATE runs SET resolved_model_profile_id = $3,
                 model_fallback_used = model_fallback_used OR $4,
                 model_usage = jsonb_build_object(
                   'inputTokens', COALESCE((model_usage->>'inputTokens')::integer, 0) + $5,
                   'outputTokens', COALESCE((model_usage->>'outputTokens')::integer, 0) + $6,
                   'totalTokens', COALESCE((model_usage->>'totalTokens')::integer, 0) + $7
                 )
               WHERE organization_id = $1 AND id = $2`,
              [lease.organizationId, lease.runId, event.profileId, event.fallbackUsed,
                event.usage.inputTokens, event.usage.outputTokens, event.usage.totalTokens],
            );
            await appendEvent(client, lease.organizationId, lease.runId, 'model.completed', {
              profileId: event.profileId,
              usage: event.usage,
              fallbackUsed: event.fallbackUsed,
            }, lease.attemptId);
            break;
          case 'model_failed':
            await appendEvent(client, lease.organizationId, lease.runId, 'model.failed', {
              profileId: event.profileId,
              failure: event.failure,
              hadOutput: event.hadOutput,
            }, lease.attemptId);
            break;
          case 'tool_status':
            await appendEvent(
              client,
              lease.organizationId,
              lease.runId,
              `tool.${event.status}`,
              {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                safeSummary: event.safeSummary,
              },
              lease.attemptId,
            );
            break;
          case 'output_reset':
            if (event.generation !== currentGeneration + 1) {
              throw new Error('Output reset must advance exactly one generation');
            }
            currentGeneration = event.generation;
            await client.query(
              `UPDATE invocations SET output_generation = $3, has_streamed_output = false
               WHERE organization_id = $1 AND id = $2`,
              [lease.organizationId, lease.invocationId, event.generation],
            );
            await appendEvent(client, lease.organizationId, lease.runId, 'invocation.output_reset', {
              invocationId: lease.invocationId,
              generation: event.generation,
              reason: event.reason,
            }, lease.attemptId);
            break;
          case 'output_started':
            if (event.generation !== currentGeneration) throw new Error('Output generation is stale');
            await client.query(
              `UPDATE invocations SET has_streamed_output = true
               WHERE organization_id = $1 AND id = $2`,
              [lease.organizationId, lease.invocationId],
            );
            await appendEvent(client, lease.organizationId, lease.runId, 'invocation.output_started', {
              invocationId: lease.invocationId,
              generation: event.generation,
            }, lease.attemptId);
            break;
          case 'output_delta':
            if (event.generation !== currentGeneration) throw new Error('Output generation is stale');
            await appendEvent(client, lease.organizationId, lease.runId, 'invocation.output_delta', {
              invocationId: lease.invocationId,
              generation: event.generation,
              text: event.text,
            }, lease.attemptId);
            break;
          case 'output_completed':
            if (event.generation !== currentGeneration) throw new Error('Output generation is stale');
            await appendEvent(client, lease.organizationId, lease.runId, 'invocation.output_completed', {
              invocationId: lease.invocationId,
              generation: event.generation,
            }, lease.attemptId);
            break;
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveOutputReady(lease: RunLease, text: string): Promise<'ready' | 'cancelled'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await verifyLease(client, lease);
      const run = await selectRun(client, lease.organizationId, lease.runId, true);
      if (!run || run.status !== 'running') {
        await client.query('COMMIT');
        return 'cancelled';
      }
      if (run.prepared_output !== null) {
        await client.query('COMMIT');
        return 'ready';
      }
      await client.query(
        `UPDATE invocations SET prepared_output = $3, output_ready_at = clock_timestamp()
         WHERE organization_id = $1 AND id = $2`,
        [lease.organizationId, lease.invocationId, JSON.stringify({ text })],
      );
      await client.query(
        `UPDATE execution_checkpoints SET consumed_at = clock_timestamp()
         WHERE organization_id = $1 AND run_id = $2 AND consumed_at IS NULL`,
        [lease.organizationId, lease.runId],
      );
      await appendEvent(client, lease.organizationId, lease.runId, 'invocation.output_ready', {
        invocationId: lease.invocationId,
        text,
      }, lease.attemptId);
      await client.query('COMMIT');
      return 'ready';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(lease: RunLease, assistantMessageId: MessageId): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await verifyLease(client, lease);
      const run = await selectRun(client, lease.organizationId, lease.runId, true);
      if (!run || run.status !== 'running' || run.prepared_output === null) throw new StaleLeaseError();
      await client.query(
        `UPDATE invocations SET status = 'succeeded', completed_at = clock_timestamp()
         WHERE organization_id = $1 AND id = $2`,
        [lease.organizationId, lease.invocationId],
      );
      await client.query(
        `UPDATE runs SET status = 'succeeded', assistant_message_id = $3,
           completed_at = clock_timestamp()
         WHERE organization_id = $1 AND id = $2`,
        [lease.organizationId, lease.runId, assistantMessageId],
      );
      await client.query(
        `UPDATE run_dispatch SET status = 'completed', updated_at = clock_timestamp()
         WHERE run_id = $1`,
        [lease.runId],
      );
      await appendEvent(client, lease.organizationId, lease.runId, 'assistant_message.appended', {
        messageId: assistantMessageId,
      }, lease.attemptId);
      await appendEvent(client, lease.organizationId, lease.runId, 'invocation.succeeded', {
        invocationId: lease.invocationId,
      }, lease.attemptId);
      await appendEvent(client, lease.organizationId, lease.runId, 'run.succeeded', {}, lease.attemptId);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(lease: RunLease, failure: RunFailure): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await verifyLease(client, lease);
      const run = await selectRun(client, lease.organizationId, lease.runId, true);
      if (!run || run.status !== 'running' || run.prepared_output !== null) throw new StaleLeaseError();
      await client.query(
        `UPDATE invocations SET status = 'failed', completed_at = clock_timestamp()
         WHERE organization_id = $1 AND id = $2`,
        [lease.organizationId, lease.invocationId],
      );
      await client.query(
        `UPDATE runs SET status = 'failed', failure = $3, completed_at = clock_timestamp()
         WHERE organization_id = $1 AND id = $2`,
        [lease.organizationId, lease.runId, JSON.stringify(failure)],
      );
      await client.query(`UPDATE run_dispatch SET status = 'failed' WHERE run_id = $1`, [lease.runId]);
      await appendEvent(client, lease.organizationId, lease.runId, 'run.failed', { failure }, lease.attemptId);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export function resolvedEchoAgent(
  agentId: string,
  agentRevisionId: string,
): ResolvedAgentRevision {
  return {
    agentId: agentId as ResolvedAgentRevision['agentId'],
    agentRevisionId: agentRevisionId as ResolvedAgentRevision['agentRevisionId'],
    engineKind: 'echo',
    engineVersion: '1',
  };
}
