import { randomUUID } from 'node:crypto';
import { agentRevisionId } from '@cmaster/agents';
import { Slice3BaselinePolicy } from '@cmaster/governance';
import {
  PostgresToolCatalog,
  PostgresToolRuntime,
  toolGrantId,
  toolRevisionId,
  type ToolProvider,
} from '@cmaster/tools';
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

describe('PostgresToolCatalog', () => {
  it('lists only active Tool Capabilities contained in the Agent Tool Grant', async () => {
    const identity = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Tool Catalog ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Tool Catalog Employee',
    });
    await identity.provision();
    const organization = identity.resolveRequest().organizationId;
    const catalog = new PostgresToolCatalog(pool);
    const grantId = toolGrantId(randomUUID());
    const currentTimeRevisionId = toolRevisionId(randomUUID());

    await catalog.provision(organization, {
      revisions: [
        {
          id: currentTimeRevisionId,
          capabilityId: 'cmaster.utility.current_time:v1',
          name: 'Current time',
          description: 'Returns the current time.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          effect: 'read_only',
          recovery: 'retry_same_call',
          risks: [],
          providerKey: 'built-in:current-time',
        },
        {
          id: toolRevisionId(randomUUID()),
          capabilityId: 'cmaster.utility.text_statistics:v1',
          name: 'Text statistics',
          description: 'Counts text characters, words, and lines.',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
          effect: 'read_only',
          recovery: 'retry_same_call',
          risks: [],
          providerKey: 'built-in:text-statistics',
        },
      ],
      grants: [{ id: grantId, capabilityIds: ['cmaster.utility.current_time:v1'] }],
    });

    const tools = await catalog.list({ organizationId: organization, grantId });

    expect(tools).toEqual([
      {
        revisionId: currentTimeRevisionId,
        capabilityId: 'cmaster.utility.current_time:v1',
        name: 'Current time',
        description: 'Returns the current time.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        effect: 'read_only',
        recovery: 'retry_same_call',
        risks: [],
      },
    ]);
  });

  it('persists a running ToolCall and stable idempotency key before Provider I/O', async () => {
    const identityModule = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Tool Runtime ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Tool Runtime Employee',
    });
    await identityModule.provision();
    const identity = identityModule.resolveRequest();
    const catalog = new PostgresToolCatalog(pool);
    const grantId = toolGrantId(randomUUID());
    await catalog.provision(identity.organizationId, {
      revisions: [{
        id: toolRevisionId(randomUUID()),
        capabilityId: 'cmaster.utility.current_time:v1',
        name: 'Current time',
        description: 'Returns the current time.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        effect: 'read_only',
        recovery: 'retry_same_call',
        risks: [],
        providerKey: 'test:current-time',
      }],
      grants: [{ id: grantId, capabilityIds: ['cmaster.utility.current_time:v1'] }],
    });

    let runtime: PostgresToolRuntime;
    const provider: ToolProvider = {
      key: 'test:current-time',
      async execute(request) {
        const calls = await runtime.listCalls(identity.organizationId, request.runId);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ status: 'running', idempotencyKey: request.idempotencyKey });
        return {
          kind: 'success',
          value: { iso: '2026-08-30T00:00:00.000Z' },
          safeSummary: { title: 'Current time returned', details: {} },
        };
      },
    };
    runtime = new PostgresToolRuntime(pool, new Slice3BaselinePolicy(), [provider]);
    const runId = randomUUID();
    const outcome = await runtime.invoke({
      identity,
      agentRevisionId: agentRevisionId(randomUUID()),
      grantId,
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      runId,
      invocationId: randomUUID(),
      modelRequestId: 'model-tool-request-1',
      capabilityId: 'cmaster.utility.current_time:v1',
      input: {},
      safeRequestSummary: { title: 'Read current time', details: {} },
      signal: new AbortController().signal,
    });

    expect(outcome).toMatchObject({
      kind: 'success',
      value: { iso: '2026-08-30T00:00:00.000Z' },
    });
    expect((await runtime.listCalls(identity.organizationId, runId))[0]?.status).toBe('succeeded');
  });
});
