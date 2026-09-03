import { createHash, randomUUID } from 'node:crypto';
import type { OrganizationId, RequestIdentity } from '@cmaster/identity';
import {
  approvalCommandId,
  type ApprovalId,
  type ApprovalModule,
  type PolicyModule,
} from '@cmaster/governance';
import { Ajv } from 'ajv/dist/ajv.js';
import type { Pool, PoolClient } from 'pg';
import { DevelopmentCredentialBroker } from './credentials.js';
import {
  type CredentialBroker,
  type InvokeToolCommand,
  type ResumeToolCallCommand,
  type SafeToolSummary,
  type ToolCall,
  type ToolCallId,
  type ToolDescriptor,
  type ToolEffect,
  type ToolOutcome,
  type ToolProvider,
  type ToolProviderResult,
  type ToolRecovery,
  type ToolRevisionId,
  type ToolRisk,
  type ToolRuntime,
} from './types.js';

interface RuntimeRevisionRow {
  id: string;
  capability_id: string;
  name: string;
  description: string;
  input_schema: Readonly<Record<string, unknown>>;
  output_schema: Readonly<Record<string, unknown>>;
  effect: ToolEffect;
  recovery: ToolRecovery;
  risks: ToolRisk[];
  provider_key: string;
}

interface GrantedRuntimeRevisionRow extends RuntimeRevisionRow {
  grant_id: string;
}

interface ProviderDispatchInput {
  identity: RequestIdentity;
  organizationId: OrganizationId;
  toolCallId: ToolCallId;
  revision: RuntimeRevisionRow;
  provider: ToolProvider;
  runId: string;
  invocationId: string;
  requestPayload: unknown;
  idempotencyKey: string;
  dispatchAttemptId: string;
  operation: 'execute' | 'reconcile';
  signal: AbortSignal;
}

interface DispatchAttemptRow {
  id: string;
  attempt_number: number;
  status: 'running' | 'succeeded' | 'failed' | 'uncertain';
  lease_expires_at: Date;
}

interface ToolCallRow {
  id: string;
  organization_id: string;
  initiating_principal_id: string;
  run_id: string;
  invocation_id: string;
  agent_revision_id: string;
  grant_id: string;
  capability_id: string;
  request_payload: unknown;
  effect: ToolEffect;
  recovery: ToolRecovery;
  risks: ToolRisk[];
  tool_revision_id: string;
  status: 'running' | 'succeeded' | 'failed' | 'denied' | 'requires_review' | 'awaiting_confirmation';
  idempotency_key: string;
  request_hash: string;
  request_summary: SafeToolSummary;
  outcome_payload: unknown | null;
  outcome_summary: SafeToolSummary | null;
  failure: { code: string; message: string; retryable: boolean } | null;
  approval_id: string | null;
}

const MAX_TOOL_PAYLOAD_BYTES = 64 * 1024;
const MAX_SAFE_SUMMARY_BYTES = 8 * 1024;
const ajv = new Ajv({ allErrors: true, strict: false });

export class ToolInputValidationError extends Error {}
export class ToolOutputValidationError extends Error {}
export class ToolPayloadTooLargeError extends Error {}
export class ToolSafeSummaryError extends Error {}

function serializeBounded(value: unknown, maximumBytes: number): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ToolInputValidationError('Tool payload must be JSON serializable');
  }
  if (serialized === undefined) throw new ToolInputValidationError('Tool payload must be JSON serializable');
  if (Buffer.byteLength(serialized, 'utf8') > maximumBytes) throw new ToolPayloadTooLargeError();
  return serialized;
}

function validateInput(schema: Readonly<Record<string, unknown>>, input: unknown): string {
  const serialized = serializeBounded(input, MAX_TOOL_PAYLOAD_BYTES);
  if (!ajv.compile(schema)(input)) throw new ToolInputValidationError('Tool input does not match its schema');
  return serialized;
}

function validateOutput(schema: Readonly<Record<string, unknown>>, output: unknown): string {
  const serialized = serializeBounded(output, MAX_TOOL_PAYLOAD_BYTES);
  if (!ajv.compile(schema)(output)) throw new ToolOutputValidationError();
  return serialized;
}

function validateSummary(summary: SafeToolSummary): string {
  if (summary.title.length === 0
    || Object.values(summary.details).some((value) => typeof value !== 'string')) {
    throw new ToolSafeSummaryError();
  }
  return serializeBounded(summary, MAX_SAFE_SUMMARY_BYTES);
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function descriptor(row: RuntimeRevisionRow): ToolDescriptor {
  return {
    revisionId: row.id as ToolRevisionId,
    capabilityId: row.capability_id,
    name: row.name,
    description: row.description,
    inputSchema: row.input_schema,
    outputSchema: row.output_schema,
    effect: row.effect,
    recovery: row.recovery,
    risks: row.risks,
  };
}

function mapCall(row: ToolCallRow): ToolCall {
  const outcome: ToolOutcome | undefined = row.status === 'succeeded' && row.outcome_summary !== null
    ? {
      kind: 'success',
      toolCallId: row.id as ToolCallId,
      value: row.outcome_payload,
      safeSummary: row.outcome_summary,
    }
    : row.status === 'denied'
      ? {
        kind: 'denied',
        toolCallId: row.id as ToolCallId,
        reason: (row.outcome_payload as { reason?: 'employee_rejected' | 'authorization_revoked' } | null)?.reason
          ?? 'authorization_revoked',
      }
      : row.status === 'failed'
      ? {
        kind: 'failed',
        toolCallId: row.id as ToolCallId,
        failure: { code: 'provider_failed', message: 'The Tool Provider failed.', retryable: true },
      }
      : row.status === 'requires_review'
        ? {
          kind: 'requires_review',
          toolCallId: row.id as ToolCallId,
          failure: { code: 'external_effect_unknown', message: 'The external effect is unknown.', retryable: false },
        }
        : undefined;
  return {
    id: row.id as ToolCallId,
    organizationId: row.organization_id as OrganizationId,
    runId: row.run_id,
    invocationId: row.invocation_id,
    capabilityId: row.capability_id,
    revisionId: row.tool_revision_id as ToolRevisionId,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    requestSummary: row.request_summary,
    ...(outcome ? { outcome } : {}),
  };
}

async function selectGrantedRevision(
  client: Pool | PoolClient,
  command: InvokeToolCommand,
): Promise<GrantedRuntimeRevisionRow | undefined> {
  const result = await client.query<GrantedRuntimeRevisionRow>(
    `SELECT r.*, g.id AS grant_id
     FROM agent_tool_grants b
     JOIN tool_grants g
       ON g.organization_id = b.organization_id AND g.id = b.grant_id
     JOIN tool_revisions r
       ON r.organization_id = g.organization_id
      AND r.capability_id = $3
      AND r.status = 'active'
     WHERE b.organization_id = $1 AND b.agent_revision_id = $2
       AND g.capability_ids ? $3`,
    [command.identity.organizationId, command.agentRevisionId, command.capabilityId],
  );
  return result.rows[0];
}

export class ToolAuthorizationDeniedError extends Error {}
export class ToolInvocationConflictError extends Error {}
export class ToolProviderUnavailableError extends Error {}
export class ToolPersistenceError extends Error {}

export interface PostgresToolRuntimeOptions {
  providerTimeoutMs?: number;
}

export class PostgresToolRuntime implements ToolRuntime {
  private readonly providers: ReadonlyMap<string, ToolProvider>;
  private readonly providerTimeoutMs: number;

  constructor(
    private readonly pool: Pool,
    private readonly policy: PolicyModule,
    private readonly approvals: ApprovalModule,
    providers: readonly ToolProvider[],
    private readonly credentials: CredentialBroker = new DevelopmentCredentialBroker(),
    options: PostgresToolRuntimeOptions = {},
  ) {
    this.providers = new Map(providers.map((provider) => [provider.key, provider]));
    this.providerTimeoutMs = options.providerTimeoutMs ?? 30_000;
    if (!Number.isFinite(this.providerTimeoutMs) || this.providerTimeoutMs <= 0) {
      throw new Error('Tool Provider timeout must be positive');
    }
  }

  async invoke(command: InvokeToolCommand): Promise<ToolOutcome> {
    const completedReplay = await this.replayCompleted(command);
    if (completedReplay) return completedReplay;

    const revision = await selectGrantedRevision(this.pool, command);
    const decision = await this.policy.evaluate({
      organizationId: command.identity.organizationId,
      principalId: command.identity.principalId,
      agentRevisionId: command.agentRevisionId,
      principalEntitlements: command.principalEntitlements,
      agentGranted: revision !== undefined,
      toolRevisionActive: revision !== undefined,
      capabilityId: command.capabilityId,
    });
    if (decision.effect === 'deny' || !revision) {
      throw new ToolAuthorizationDeniedError(decision.reason);
    }
    const requiresConfirmation = decision.obligations
      .some((obligation) => obligation.kind === 'employee_confirmation');
    const provider = this.providers.get(revision.provider_key);
    if (!provider) throw new ToolProviderUnavailableError();
    const requestPayload = validateInput(revision.input_schema, command.input);
    const safeRequestSummary = provider.summarize(command.input);
    const requestSummary = validateSummary(safeRequestSummary);

    const requestHash = digest({
      capabilityId: command.capabilityId,
      revisionId: revision.id,
      input: command.input,
    });
    const toolCallId = randomUUID() as ToolCallId;
    const idempotencyKey = randomUUID();
    const dispatchAttemptId = randomUUID();
    const initialStatus = requiresConfirmation ? 'awaiting_confirmation' : 'running';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `tool-call:${command.identity.organizationId}:${command.invocationId}:${command.modelRequestId}`,
      ]);
      const existing = await client.query<ToolCallRow>(
        `SELECT * FROM tool_calls
         WHERE organization_id = $1 AND invocation_id = $2 AND model_request_id = $3
           AND initiating_principal_id = $4`,
        [command.identity.organizationId, command.invocationId, command.modelRequestId,
          command.identity.principalId],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash
          || previous.agent_revision_id !== command.agentRevisionId) {
          throw new ToolInvocationConflictError();
        }
        if (previous.status === 'awaiting_confirmation') {
          await client.query('COMMIT');
          if (previous.approval_id) {
            const approval = await this.approvals.get(
              command.identity,
              previous.approval_id as ApprovalId,
            );
            return {
              kind: 'confirmation_required',
              toolCallId: previous.id as ToolCallId,
              approval,
              safeSummary: previous.request_summary,
            };
          }
          return this.requestConfirmation({
            command,
            toolCallId: previous.id as ToolCallId,
            revisionId: previous.tool_revision_id as ToolRevisionId,
            requestHash: previous.request_hash,
            safeSummary: previous.request_summary,
            policyVersion: decision.policyVersion,
          });
        }
        const previousOutcome = mapCall(previous).outcome;
        if (previousOutcome) {
          await client.query('COMMIT');
          return previousOutcome;
        }
        if (previous.status === 'running') {
          await client.query('COMMIT');
          return this.recoverExpiredDispatch(command, previous, revision, provider);
        }
        throw new ToolInvocationConflictError();
      }
      await client.query(
        `INSERT INTO tool_calls (
           id, organization_id, initiating_principal_id, run_id, invocation_id,
           model_request_id, agent_revision_id, grant_id, capability_id,
           tool_revision_id, status, idempotency_key, effect, recovery, risks,
           request_hash, request_payload, request_summary
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14, $15, $16, $17, $18
         )`,
        [toolCallId, command.identity.organizationId, command.identity.principalId,
          command.runId, command.invocationId, command.modelRequestId,
          command.agentRevisionId, revision.grant_id, command.capabilityId,
          revision.id, initialStatus, idempotencyKey, revision.effect,
          revision.recovery, JSON.stringify(revision.risks), requestHash,
          requestPayload, requestSummary],
      );
      if (!requiresConfirmation) {
        await client.query(
          `INSERT INTO tool_dispatch_attempts (
             id, organization_id, tool_call_id, attempt_number, status, lease_expires_at
           ) VALUES (
             $1, $2, $3, 1, 'running',
             clock_timestamp() + ($4 * interval '1 millisecond')
           )`,
          [dispatchAttemptId, command.identity.organizationId, toolCallId,
            this.providerTimeoutMs],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (requiresConfirmation) {
      return this.requestConfirmation({
        command,
        toolCallId,
        revisionId: revision.id as ToolRevisionId,
        requestHash,
        safeSummary: safeRequestSummary,
        policyVersion: decision.policyVersion,
      });
    }

    return this.dispatch({
      identity: command.identity,
      organizationId: command.identity.organizationId,
      toolCallId,
      revision,
      provider,
      runId: command.runId,
      invocationId: command.invocationId,
      requestPayload: command.input,
      idempotencyKey,
      dispatchAttemptId,
      operation: 'execute',
      signal: command.signal,
    });
  }

  private async recoverExpiredDispatch(
    command: Pick<InvokeToolCommand, 'identity' | 'signal'>,
    call: ToolCallRow,
    revision: RuntimeRevisionRow,
    provider: ToolProvider,
  ): Promise<ToolOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const attempts = await client.query<DispatchAttemptRow>(
        `SELECT id, attempt_number, status, lease_expires_at
         FROM tool_dispatch_attempts
         WHERE organization_id = $1 AND tool_call_id = $2
           AND status = 'running' AND lease_expires_at <= clock_timestamp()
         ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE`,
        [command.identity.organizationId, call.id],
      );
      const attempt = attempts.rows[0];
      if (!attempt) throw new ToolInvocationConflictError();
      const safelyRetryable = call.recovery === 'idempotency_key'
        || (call.recovery === 'retry_same_call' && call.effect !== 'non_idempotent_write');
      const canReconcile = call.recovery === 'reconcile' && provider.reconcile !== undefined;
      if (!safelyRetryable && !canReconcile) {
        const failure = {
          code: 'external_effect_unknown' as const,
          message: 'The external effect is unknown.',
          retryable: false as const,
        };
        const closed = await client.query(
          `WITH closed_attempt AS (
             UPDATE tool_dispatch_attempts
             SET status = 'uncertain', failure = $4, completed_at = clock_timestamp()
             WHERE organization_id = $1 AND id = $2 AND tool_call_id = $3
               AND status = 'running'
             RETURNING tool_call_id
           )
           UPDATE tool_calls SET status = 'requires_review', failure = $4,
             completed_at = clock_timestamp()
           WHERE organization_id = $1 AND id = $3 AND status = 'running'
             AND EXISTS (SELECT 1 FROM closed_attempt WHERE tool_call_id = tool_calls.id)`,
          [command.identity.organizationId, attempt.id, call.id, JSON.stringify(failure)],
        );
        if (closed.rowCount !== 1) throw new ToolPersistenceError('Expired Tool effect was superseded');
        await client.query('COMMIT');
        return {
          kind: 'requires_review',
          toolCallId: call.id as ToolCallId,
          failure,
        };
      }

      const dispatchAttemptId = randomUUID();
      const recovered = await client.query(
        `WITH closed_attempt AS (
           UPDATE tool_dispatch_attempts
           SET status = 'failed', failure = $5, completed_at = clock_timestamp()
           WHERE organization_id = $1 AND id = $2 AND tool_call_id = $3
             AND status = 'running'
           RETURNING tool_call_id
         )
         INSERT INTO tool_dispatch_attempts (
           id, organization_id, tool_call_id, attempt_number, status, lease_expires_at
         )
         SELECT $4, $1, tool_call_id, $6, 'running',
           clock_timestamp() + ($7 * interval '1 millisecond')
         FROM closed_attempt
         RETURNING tool_call_id`,
        [command.identity.organizationId, attempt.id, call.id, dispatchAttemptId,
          JSON.stringify({
            code: 'dispatch_interrupted',
            message: 'The prior Tool dispatch lease expired.',
            retryable: true,
          }), attempt.attempt_number + 1, this.providerTimeoutMs],
      );
      if (recovered.rowCount !== 1) throw new ToolPersistenceError('Tool recovery was superseded');
      await client.query('COMMIT');
      return this.dispatch({
        identity: command.identity,
        organizationId: command.identity.organizationId,
        toolCallId: call.id as ToolCallId,
        revision,
        provider,
        runId: call.run_id,
        invocationId: call.invocation_id,
        requestPayload: call.request_payload,
        idempotencyKey: call.idempotency_key,
        dispatchAttemptId,
        operation: canReconcile ? 'reconcile' : 'execute',
        signal: command.signal,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async replayCompleted(command: InvokeToolCommand): Promise<ToolOutcome | undefined> {
    const existing = await this.pool.query<ToolCallRow>(
      `SELECT * FROM tool_calls
       WHERE organization_id = $1 AND invocation_id = $2 AND model_request_id = $3
         AND initiating_principal_id = $4`,
      [command.identity.organizationId, command.invocationId, command.modelRequestId,
        command.identity.principalId],
    );
    const call = existing.rows[0];
    const outcome = call ? mapCall(call).outcome : undefined;
    if (!call || !outcome) return undefined;
    if (call.agent_revision_id !== command.agentRevisionId) {
      throw new ToolInvocationConflictError();
    }

    const revisionResult = await this.pool.query<RuntimeRevisionRow>(
      `SELECT * FROM tool_revisions
       WHERE organization_id = $1 AND id = $2`,
      [command.identity.organizationId, call.tool_revision_id],
    );
    const revision = revisionResult.rows[0];
    if (!revision) throw new ToolInvocationConflictError();
    validateInput(revision.input_schema, command.input);
    const requestHash = digest({
      capabilityId: command.capabilityId,
      revisionId: revision.id,
      input: command.input,
    });
    if (requestHash !== call.request_hash) throw new ToolInvocationConflictError();
    return outcome;
  }

  private async dispatch(input: ProviderDispatchInput): Promise<ToolOutcome> {
    let credentialLease;
    try {
      credentialLease = await this.credentials.issue({
        identity: input.identity,
        toolCallId: input.toolCallId,
        invocationId: input.invocationId,
        capabilityId: input.revision.capability_id,
        allowedOperations: [input.revision.capability_id],
      });
    } catch {
      return this.closeDispatchFailure(input, false);
    }
    let result: ToolProviderResult;
    let outcomePayload: string;
    let outcomeSummary: string;
    try {
      if (credentialLease.expiresAt.getTime() <= Date.now()) {
        throw new Error('Credential Lease expired before dispatch');
      }
      const timeout = AbortSignal.timeout(this.providerTimeoutMs);
      const signal = AbortSignal.any([input.signal, timeout]);
      const aborted = new Promise<never>((_resolve, reject) => {
        if (signal.aborted) {
          reject(new Error('Tool Provider dispatch aborted'));
          return;
        }
        signal.addEventListener(
          'abort',
          () => reject(new Error('Tool Provider dispatch aborted')),
          { once: true },
        );
      });
      const providerRequest = {
        toolCallId: input.toolCallId,
        revision: descriptor(input.revision),
        runId: input.runId,
        invocationId: input.invocationId,
        input: input.requestPayload,
        idempotencyKey: input.idempotencyKey,
        credentialLease,
        signal,
      };
      const providerOperation = input.operation === 'reconcile'
        ? input.provider.reconcile?.(providerRequest)
        : input.provider.execute(providerRequest);
      if (!providerOperation) throw new Error('Tool Provider cannot reconcile this operation');
      result = await Promise.race([providerOperation, aborted]);
      outcomePayload = validateOutput(input.revision.output_schema, result.value);
      outcomeSummary = validateSummary(result.safeSummary);
    } catch {
      return this.closeDispatchFailure(
        input,
        input.revision.effect === 'non_idempotent_write'
          && input.revision.recovery !== 'idempotency_key',
      );
    } finally {
      await this.credentials.revoke(credentialLease.id).catch(() => {
        // Revocation audit failure cannot rewrite an already observed Provider effect.
      });
    }

    let completed;
    try {
      completed = await this.pool.query(
        `WITH completed_attempt AS (
           UPDATE tool_dispatch_attempts
           SET status = 'succeeded', completed_at = clock_timestamp()
           WHERE organization_id = $1 AND id = $6 AND tool_call_id = $2
             AND status = 'running'
           RETURNING tool_call_id
         )
         UPDATE tool_calls
         SET status = 'succeeded', outcome_payload = $3, outcome_summary = $4,
             external_operation_id = $5, completed_at = clock_timestamp()
         WHERE organization_id = $1 AND id = $2 AND status = 'running'
           AND EXISTS (
             SELECT 1 FROM completed_attempt WHERE tool_call_id = tool_calls.id
           )`,
        [input.organizationId, input.toolCallId, outcomePayload,
          outcomeSummary, result.externalOperationId ?? null, input.dispatchAttemptId],
      );
    } catch {
      throw new ToolPersistenceError('Tool success could not be persisted');
    }
    if (completed.rowCount !== 1) throw new ToolPersistenceError('Tool success was superseded');
    return {
      kind: 'success',
      toolCallId: input.toolCallId,
      value: result.value,
      safeSummary: result.safeSummary,
    };
  }

  private async closeDispatchFailure(
    input: ProviderDispatchInput,
    uncertain: boolean,
  ): Promise<ToolOutcome> {
    const failure = uncertain
      ? { code: 'external_effect_unknown', message: 'The external effect is unknown.', retryable: false }
      : { code: 'provider_failed', message: 'The Tool Provider failed.', retryable: true };
    const failed = await this.pool.query(
      `WITH completed_attempt AS (
         UPDATE tool_dispatch_attempts
         SET status = $3, failure = $4, completed_at = clock_timestamp()
         WHERE organization_id = $1 AND id = $6 AND tool_call_id = $2
           AND status = 'running'
         RETURNING tool_call_id
       )
       UPDATE tool_calls
       SET status = $5, failure = $4, completed_at = clock_timestamp()
       WHERE organization_id = $1 AND id = $2 AND status = 'running'
         AND EXISTS (
           SELECT 1 FROM completed_attempt WHERE tool_call_id = tool_calls.id
         )`,
      [input.organizationId, input.toolCallId, uncertain ? 'uncertain' : 'failed',
        JSON.stringify(failure), uncertain ? 'requires_review' : 'failed',
        input.dispatchAttemptId],
    );
    if (failed.rowCount !== 1) throw new ToolPersistenceError('Tool failure could not be fenced');
    return uncertain
      ? {
        kind: 'requires_review',
        toolCallId: input.toolCallId,
        failure: {
          code: 'external_effect_unknown',
          message: 'The external effect is unknown.',
          retryable: false,
        },
      }
      : {
        kind: 'failed',
        toolCallId: input.toolCallId,
        failure: {
          code: 'provider_failed',
          message: 'The Tool Provider failed.',
          retryable: true,
        },
      };
  }

  private async requestConfirmation(input: {
    command: InvokeToolCommand;
    toolCallId: ToolCallId;
    revisionId: ToolRevisionId;
    requestHash: string;
    safeSummary: SafeToolSummary;
    policyVersion: string;
  }): Promise<ToolOutcome> {
    const approval = await this.approvals.request(input.command.identity, {
      commandId: approvalCommandId(input.toolCallId),
      subject: {
        kind: 'tool_call',
        subjectRef: input.toolCallId,
        toolRevisionRef: input.revisionId,
        requestHash: input.requestHash,
        safeSummary: input.safeSummary,
      },
      policyVersion: input.policyVersion,
    });
    const linked = await this.pool.query(
      `UPDATE tool_calls SET approval_id = $3
       WHERE organization_id = $1 AND id = $2
         AND status = 'awaiting_confirmation'
         AND (approval_id IS NULL OR approval_id = $3)`,
      [input.command.identity.organizationId, input.toolCallId, approval.value.id],
    );
    if (linked.rowCount !== 1) {
      throw new ToolPersistenceError('Tool Approval link was superseded');
    }
    return {
      kind: 'confirmation_required',
      toolCallId: input.toolCallId,
      approval: approval.value,
      safeSummary: input.safeSummary,
    };
  }

  async resume(command: ResumeToolCallCommand): Promise<ToolOutcome> {
    const selected = await this.pool.query<ToolCallRow>(
      `SELECT * FROM tool_calls
       WHERE organization_id = $1 AND id = $2 AND initiating_principal_id = $3`,
      [command.identity.organizationId, command.toolCallId, command.identity.principalId],
    );
    const call = selected.rows[0];
    if (!call || !call.approval_id) throw new ToolInvocationConflictError();
    const existingOutcome = mapCall(call).outcome;
    if (existingOutcome) return existingOutcome;
    if (!['awaiting_confirmation', 'running'].includes(call.status)) {
      throw new ToolInvocationConflictError();
    }

    const approval = await this.approvals.resolve(
      command.identity,
      call.approval_id as ApprovalId,
      { commandId: command.commandId, response: command.response },
    );
    if (approval.value.status === 'rejected') {
      const denied = await this.pool.query(
        `UPDATE tool_calls
         SET status = 'denied', outcome_payload = $3, completed_at = clock_timestamp()
         WHERE organization_id = $1 AND id = $2 AND status = 'awaiting_confirmation'`,
        [command.identity.organizationId, command.toolCallId,
          JSON.stringify({ reason: 'employee_rejected' })],
      );
      if (denied.rowCount !== 1) throw new ToolPersistenceError('Tool rejection was superseded');
      return { kind: 'denied', toolCallId: command.toolCallId, reason: 'employee_rejected' };
    }

    const revisionResult = await this.pool.query<RuntimeRevisionRow>(
      `SELECT r.* FROM tool_revisions r
       JOIN tool_grants g
         ON g.organization_id = r.organization_id AND g.id = $2
       JOIN agent_tool_grants b
         ON b.organization_id = g.organization_id
        AND b.agent_revision_id = $5 AND b.grant_id = g.id
       WHERE r.organization_id = $1 AND r.id = $3
         AND r.capability_id = $4 AND r.status = 'active'
         AND g.capability_ids ? r.capability_id`,
      [command.identity.organizationId, call.grant_id,
        call.tool_revision_id, call.capability_id, call.agent_revision_id],
    );
    const revision = revisionResult.rows[0];
    const decision = await this.policy.evaluate({
      organizationId: command.identity.organizationId,
      principalId: command.identity.principalId,
      agentRevisionId: call.agent_revision_id as InvokeToolCommand['agentRevisionId'],
      principalEntitlements: command.principalEntitlements,
      agentGranted: revision !== undefined,
      toolRevisionActive: revision !== undefined,
      capabilityId: call.capability_id,
    });
    if (decision.effect === 'deny' || !revision) {
      const denied = await this.pool.query(
        `UPDATE tool_calls
         SET status = 'denied', outcome_payload = $3, completed_at = clock_timestamp()
         WHERE organization_id = $1 AND id = $2 AND status = 'awaiting_confirmation'`,
        [command.identity.organizationId, command.toolCallId,
          JSON.stringify({ reason: 'authorization_revoked' })],
      );
      if (denied.rowCount !== 1) throw new ToolPersistenceError('Tool denial was superseded');
      return { kind: 'denied', toolCallId: command.toolCallId, reason: 'authorization_revoked' };
    }
    const provider = this.providers.get(revision.provider_key);
    if (!provider) throw new ToolProviderUnavailableError();
    if (call.status === 'running') {
      return this.recoverExpiredDispatch(command, call, revision, provider);
    }
    const dispatchAttemptId = randomUUID();
    const started = await this.pool.query(
      `WITH started_call AS (
         UPDATE tool_calls SET status = 'running'
         WHERE organization_id = $1 AND id = $2 AND status = 'awaiting_confirmation'
         RETURNING id
       )
       INSERT INTO tool_dispatch_attempts (
         id, organization_id, tool_call_id, attempt_number, status, lease_expires_at
       ) SELECT $3, $1, id, 1, 'running',
           clock_timestamp() + ($4 * interval '1 millisecond')
         FROM started_call
       RETURNING tool_call_id`,
      [command.identity.organizationId, command.toolCallId,
        dispatchAttemptId, this.providerTimeoutMs],
    );
    if (started.rowCount !== 1) throw new ToolPersistenceError('Tool resume was superseded');

    return this.dispatch({
      identity: command.identity,
      organizationId: command.identity.organizationId,
      toolCallId: command.toolCallId,
      revision,
      provider,
      runId: call.run_id,
      invocationId: call.invocation_id,
      requestPayload: call.request_payload,
      idempotencyKey: call.idempotency_key,
      dispatchAttemptId,
      operation: 'execute',
      signal: command.signal,
    });
  }

  async listCalls(identity: RequestIdentity, runId: string): Promise<ToolCall[]> {
    const result = await this.pool.query<ToolCallRow>(
      `SELECT * FROM tool_calls
       WHERE organization_id = $1 AND initiating_principal_id = $2 AND run_id = $3
       ORDER BY created_at`,
      [identity.organizationId, identity.principalId, runId],
    );
    return result.rows.map(mapCall);
  }
}
