import { createHash, randomUUID } from 'node:crypto';
import type { OrganizationId } from '@cmaster/identity';
import {
  approvalCommandId,
  type ApprovalModule,
  type PolicyModule,
} from '@cmaster/governance';
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
  status: 'running' | 'succeeded' | 'awaiting_confirmation';
  idempotency_key: string;
  request_hash: string;
  request_summary: SafeToolSummary;
  outcome_payload: unknown | null;
  outcome_summary: SafeToolSummary | null;
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
  const outcome = row.status === 'succeeded' && row.outcome_summary !== null
    ? {
      kind: 'success' as const,
      toolCallId: row.id as ToolCallId,
      value: row.outcome_payload,
      safeSummary: row.outcome_summary,
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
        if (previous.request_hash !== requestHash || !previous.outcome_summary) {
          throw new ToolInvocationConflictError();
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
          requestHash, JSON.stringify(command.input), JSON.stringify(command.safeRequestSummary)],
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
          safeSummary: command.safeRequestSummary,
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
        safeSummary: command.safeRequestSummary,
      };
    }

    const result = await provider.execute({
      toolCallId,
      revision: descriptor(revision),
      runId: command.runId,
      invocationId: command.invocationId,
      input: command.input,
      idempotencyKey,
      signal: command.signal,
    });
    const outcome: ToolOutcome = {
      kind: 'success',
      toolCallId,
      value: result.value,
      safeSummary: result.safeSummary,
    };
    await this.pool.query(
      `WITH completed_attempt AS (
         UPDATE tool_dispatch_attempts
         SET status = 'succeeded', completed_at = clock_timestamp()
         WHERE organization_id = $1 AND tool_call_id = $2 AND status = 'running'
       )
       UPDATE tool_calls
       SET status = 'succeeded', outcome_payload = $3, outcome_summary = $4,
           external_operation_id = $5, completed_at = clock_timestamp()
       WHERE organization_id = $1 AND id = $2 AND status = 'running'`,
      [command.identity.organizationId, toolCallId, JSON.stringify(result.value),
        JSON.stringify(result.safeSummary), result.externalOperationId ?? null],
    );
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
