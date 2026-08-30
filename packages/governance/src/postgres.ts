import { createHash, randomUUID } from 'node:crypto';
import type { OrganizationId, PrincipalId, RequestIdentity } from '@cmaster/identity';
import type { Pool } from 'pg';
import {
  type Approval,
  type ApprovalId,
  ApprovalAlreadyResolvedError,
  ApprovalIdempotencyConflictError,
  type ApprovalModule,
  ApprovalNotFoundError,
  type CommandResult,
  type RequestApprovalCommand,
  type ResolveApprovalCommand,
  type ToolApprovalSubject,
} from './approval.js';

interface ApprovalRow {
  id: string;
  organization_id: string;
  initiating_principal_id: string;
  subject_kind: 'tool_call';
  subject_ref: string;
  tool_revision_ref: string;
  subject_request_hash: string;
  safe_subject_summary: ToolApprovalSubject['safeSummary'];
  policy_version: string;
  status: 'pending' | 'confirmed' | 'rejected';
  request_command_hash: string;
  resolution_command_id: string | null;
  resolution_command_hash: string | null;
  created_at: Date;
  resolved_at: Date | null;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function mapApproval(row: ApprovalRow): Approval {
  return {
    id: row.id as ApprovalId,
    organizationId: row.organization_id as OrganizationId,
    initiatingPrincipalId: row.initiating_principal_id as PrincipalId,
    subject: {
      kind: row.subject_kind,
      subjectRef: row.subject_ref,
      toolRevisionRef: row.tool_revision_ref,
      requestHash: row.subject_request_hash,
      safeSummary: row.safe_subject_summary,
    },
    policyVersion: row.policy_version,
    status: row.status,
    createdAt: row.created_at,
    ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
  };
}

export class PostgresApprovalModule implements ApprovalModule {
  constructor(private readonly pool: Pool) {}

  async request(
    identity: RequestIdentity,
    command: RequestApprovalCommand,
  ): Promise<CommandResult<Approval>> {
    const commandHash = digest({ subject: command.subject, policyVersion: command.policyVersion });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `approval:${identity.organizationId}:${command.commandId}`,
      ]);
      const existing = await client.query<ApprovalRow>(
        `SELECT * FROM approvals
         WHERE organization_id = $1 AND request_command_id = $2`,
        [identity.organizationId, command.commandId],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.request_command_hash !== commandHash) {
          throw new ApprovalIdempotencyConflictError();
        }
        await client.query('COMMIT');
        return { value: mapApproval(previous), replayed: true };
      }

      const inserted = await client.query<ApprovalRow>(
        `INSERT INTO approvals (
           id, organization_id, initiating_principal_id, subject_kind,
           subject_ref, tool_revision_ref, subject_request_hash,
           safe_subject_summary, policy_version, request_command_id,
           request_command_hash
         ) VALUES ($1, $2, $3, 'tool_call', $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [randomUUID(), identity.organizationId, identity.principalId,
          command.subject.subjectRef, command.subject.toolRevisionRef,
          command.subject.requestHash, JSON.stringify(command.subject.safeSummary),
          command.policyVersion, command.commandId, commandHash],
      );
      const created = inserted.rows[0];
      if (!created) throw new Error('Approval insert did not return a row');
      await client.query('COMMIT');
      return { value: mapApproval(created), replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolve(
    identity: RequestIdentity,
    approvalId: ApprovalId,
    command: ResolveApprovalCommand,
  ): Promise<CommandResult<Approval>> {
    const commandHash = digest({ approvalId, response: command.response });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<ApprovalRow>(
        `SELECT * FROM approvals
         WHERE organization_id = $1 AND id = $2 AND initiating_principal_id = $3
         FOR UPDATE`,
        [identity.organizationId, approvalId, identity.principalId],
      );
      const approval = selected.rows[0];
      if (!approval) throw new ApprovalNotFoundError();
      if (approval.resolution_command_id === command.commandId) {
        if (approval.resolution_command_hash !== commandHash) {
          throw new ApprovalIdempotencyConflictError();
        }
        await client.query('COMMIT');
        return { value: mapApproval(approval), replayed: true };
      }
      if (approval.status !== 'pending') throw new ApprovalAlreadyResolvedError();

      const status = command.response === 'confirm' ? 'confirmed' : 'rejected';
      const updated = await client.query<ApprovalRow>(
        `UPDATE approvals
         SET status = $4, resolution_command_id = $5,
             resolution_command_hash = $6, resolved_at = clock_timestamp()
         WHERE organization_id = $1 AND id = $2 AND initiating_principal_id = $3
           AND status = 'pending'
         RETURNING *`,
        [identity.organizationId, approvalId, identity.principalId,
          status, command.commandId, commandHash],
      );
      const resolved = updated.rows[0];
      if (!resolved) throw new ApprovalAlreadyResolvedError();
      await client.query('COMMIT');
      return { value: mapApproval(resolved), replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
