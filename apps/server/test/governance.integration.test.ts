import { randomUUID } from 'node:crypto';
import {
  approvalCommandId,
  PostgresApprovalModule,
} from '@cmaster/governance';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });

afterAll(async () => {
  await pool.end();
});

describe('PostgresApprovalModule', () => {
  it('idempotently requests one pending Employee Confirmation for an immutable ToolCall Subject', async () => {
    const identityModule = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Governance ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Governance Employee',
    });
    await identityModule.provision();
    const identity = identityModule.resolveRequest();
    const approvals = new PostgresApprovalModule(pool);
    const command = {
      commandId: approvalCommandId(randomUUID()),
      subject: {
        kind: 'tool_call' as const,
        subjectRef: randomUUID(),
        toolRevisionRef: randomUUID(),
        requestHash: 'a'.repeat(64),
        safeSummary: { title: 'Fetch an approved host', details: { host: 'docs.example.test' } },
      },
      policyVersion: 'slice3-baseline-v1',
    };

    const created = await approvals.request(identity, command);
    const replayed = await approvals.request(identity, command);

    expect(created.replayed).toBe(false);
    expect(created.value).toMatchObject({
      organizationId: identity.organizationId,
      initiatingPrincipalId: identity.principalId,
      status: 'pending',
      subject: command.subject,
      policyVersion: 'slice3-baseline-v1',
    });
    expect(replayed).toEqual({ value: created.value, replayed: true });
  });

  it('idempotently confirms a pending Approval for the initiating Employee', async () => {
    const identityModule = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Confirmation ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Confirming Employee',
    });
    await identityModule.provision();
    const identity = identityModule.resolveRequest();
    const approvals = new PostgresApprovalModule(pool);
    const requested = await approvals.request(identity, {
      commandId: approvalCommandId(randomUUID()),
      subject: {
        kind: 'tool_call',
        subjectRef: randomUUID(),
        toolRevisionRef: randomUUID(),
        requestHash: 'b'.repeat(64),
        safeSummary: { title: 'Fetch an approved host', details: { host: 'docs.example.test' } },
      },
      policyVersion: 'slice3-baseline-v1',
    });
    const command = {
      commandId: approvalCommandId(randomUUID()),
      response: 'confirm' as const,
    };

    const confirmed = await approvals.resolve(identity, requested.value.id, command);
    const replayed = await approvals.resolve(identity, requested.value.id, command);

    expect(confirmed.value.status).toBe('confirmed');
    expect(confirmed.value.resolvedAt).toBeInstanceOf(Date);
    expect(confirmed.replayed).toBe(false);
    expect(replayed).toEqual({ value: confirmed.value, replayed: true });
  });
});
