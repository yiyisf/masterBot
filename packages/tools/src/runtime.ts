import { createHash, randomUUID } from 'node:crypto';
import type { OrganizationId } from '@cmaster/identity';
import {
  approvalCommandId,
  type ApprovalId,
  type ApprovalModule,
  type PolicyModule,
} from '@cmaster/governance';
import { Ajv } from 'ajv/dist/ajv.js';
import type { Pool, PoolClient } from 'pg';
import {
  type InvokeToolCommand,
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
  effect: ToolEffect;
  recovery: ToolRecovery;
  risks: ToolRisk[];
  provider_key: string;
}

interface ToolCallRow {
  id: string;
  organization_id: string;
  run_id: string;
  invocation_id: string;
  capability_id: string;
  tool_revision_id: string;
  status: 'running' | 'succeeded' | 'failed' | 'requires_review' | 'awaiting_confirmation';
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
): Promise<RuntimeRevisionRow | undefined> {
  const result = await client.query<RuntimeRevisionRow>(
    `SELECT r.* FROM tool_grants g
     JOIN tool_revisions r
       ON r.organization_id = g.organization_id
      AND r.capability_id = $3
      AND r.status = 'active'
     WHERE g.organization_id = $1 AND g.id = $2
       AND g.capability_ids ? $3`,
    [command.identity.organizationId, command.grantId, command.capabilityId],
  );
  return result.rows[0];
}

export class ToolAuthorizationDeniedError extends Error {}
export class ToolInvocationConflictError extends Error {}
export class ToolProviderUnavailableError extends Error {}
export class ToolPersistenceError extends Error {}

export class PostgresToolRuntime implements ToolRuntime {
  private readonly providers: ReadonlyMap<string, ToolProvider>;

  constructor(
    private readonly pool: Pool,
    private readonly policy: PolicyModule,
    private readonly approvals: ApprovalModule,
    providers: readonly ToolProvider[],
  ) {
    this.providers = new Map(providers.map((provider) => [provider.key, provider]));
  }

  async invoke(command: InvokeToolCommand): Promise<ToolOutcome> {
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
    const initialStatus = requiresConfirmation ? 'awaiting_confirmation' : 'running';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `tool-call:${command.identity.organizationId}:${command.invocationId}:${command.modelRequestId}`,
      ]);
      const existing = await client.query<ToolCallRow>(
        `SELECT * FROM tool_calls
         WHERE organization_id = $1 AND invocation_id = $2 AND model_request_id = $3`,
        [command.identity.organizationId, command.invocationId, command.modelRequestId],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) throw new ToolInvocationConflictError();
        if (previous.status === 'awaiting_confirmation' && previous.approval_id) {
          await client.query('COMMIT');
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
        const previousOutcome = mapCall(previous).outcome;
        if (!previousOutcome) throw new ToolInvocationConflictError();
        await client.query('COMMIT');
        return previousOutcome;
      }
      await client.query(
        `INSERT INTO tool_calls (
           id, organization_id, run_id, invocation_id, model_request_id,
           capability_id, tool_revision_id, status, idempotency_key,
           effect, recovery, risks, request_hash, request_payload, request_summary
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [toolCallId, command.identity.organizationId, command.runId, command.invocationId,
          command.modelRequestId, command.capabilityId, revision.id, initialStatus,
          idempotencyKey, revision.effect, revision.recovery, JSON.stringify(revision.risks),
          requestHash, requestPayload, requestSummary],
      );
      if (!requiresConfirmation) {
        await client.query(
          `INSERT INTO tool_dispatch_attempts (
             id, organization_id, tool_call_id, attempt_number, status
           ) VALUES ($1, $2, $3, 1, 'running')`,
          [randomUUID(), command.identity.organizationId, toolCallId],
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
      const approval = await this.approvals.request(command.identity, {
        commandId: approvalCommandId(toolCallId),
        subject: {
          kind: 'tool_call',
          subjectRef: toolCallId,
          toolRevisionRef: revision.id,
          requestHash,
          safeSummary: safeRequestSummary,
        },
        policyVersion: decision.policyVersion,
      });
      await this.pool.query(
        `UPDATE tool_calls SET approval_id = $3
         WHERE organization_id = $1 AND id = $2 AND status = 'awaiting_confirmation'`,
        [command.identity.organizationId, toolCallId, approval.value.id],
      );
      return {
        kind: 'confirmation_required',
        toolCallId,
        approval: approval.value,
        safeSummary: safeRequestSummary,
      };
    }

    let result: ToolProviderResult;
    let outcomePayload: string;
    let outcomeSummary: string;
    try {
      result = await provider.execute({
        toolCallId,
        revision: descriptor(revision),
        runId: command.runId,
        invocationId: command.invocationId,
        input: command.input,
        idempotencyKey,
        signal: command.signal,
      });
      outcomePayload = serializeBounded(result.value, MAX_TOOL_PAYLOAD_BYTES);
      outcomeSummary = validateSummary(result.safeSummary);
    } catch {
      const uncertain = revision.effect === 'non_idempotent_write';
      const failure = uncertain
        ? { code: 'external_effect_unknown', message: 'The external effect is unknown.', retryable: false }
        : { code: 'provider_failed', message: 'The Tool Provider failed.', retryable: true };
      const failed = await this.pool.query(
        `WITH completed_attempt AS (
           UPDATE tool_dispatch_attempts
           SET status = $3, failure = $4, completed_at = clock_timestamp()
           WHERE organization_id = $1 AND tool_call_id = $2 AND status = 'running'
         )
         UPDATE tool_calls
         SET status = $5, failure = $4, completed_at = clock_timestamp()
         WHERE organization_id = $1 AND id = $2 AND status = 'running'`,
        [command.identity.organizationId, toolCallId, uncertain ? 'uncertain' : 'failed',
          JSON.stringify(failure), uncertain ? 'requires_review' : 'failed'],
      );
      if (failed.rowCount !== 1) throw new ToolPersistenceError('Tool failure could not be fenced');
      return uncertain
        ? {
          kind: 'requires_review',
          toolCallId,
          failure: {
            code: 'external_effect_unknown',
            message: 'The external effect is unknown.',
            retryable: false,
          },
        }
        : {
          kind: 'failed',
          toolCallId,
          failure: {
            code: 'provider_failed',
            message: 'The Tool Provider failed.',
            retryable: true,
          },
        };
    }
    const outcome: ToolOutcome = {
      kind: 'success',
      toolCallId,
      value: result.value,
      safeSummary: result.safeSummary,
    };
    let completed;
    try {
      completed = await this.pool.query(
        `WITH completed_attempt AS (
           UPDATE tool_dispatch_attempts
           SET status = 'succeeded', completed_at = clock_timestamp()
           WHERE organization_id = $1 AND tool_call_id = $2 AND status = 'running'
         )
         UPDATE tool_calls
         SET status = 'succeeded', outcome_payload = $3, outcome_summary = $4,
             external_operation_id = $5, completed_at = clock_timestamp()
         WHERE organization_id = $1 AND id = $2 AND status = 'running'`,
        [command.identity.organizationId, toolCallId, outcomePayload,
          outcomeSummary, result.externalOperationId ?? null],
      );
    } catch {
      throw new ToolPersistenceError('Tool success could not be persisted');
    }
    if (completed.rowCount !== 1) throw new ToolPersistenceError('Tool success was superseded');
    return outcome;
  }

  async listCalls(organizationId: OrganizationId, runId: string): Promise<ToolCall[]> {
    const result = await this.pool.query<ToolCallRow>(
      `SELECT * FROM tool_calls
       WHERE organization_id = $1 AND run_id = $2 ORDER BY created_at`,
      [organizationId, runId],
    );
    return result.rows.map(mapCall);
  }
}
