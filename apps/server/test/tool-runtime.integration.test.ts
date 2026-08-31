import { randomUUID } from 'node:crypto';
import { agentRevisionId } from '@cmaster/agents';
import { PostgresApprovalModule, Slice3BaselinePolicy } from '@cmaster/governance';
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
    let failProvider = false;
    const provider: ToolProvider = {
      key: 'test:current-time',
      summarize() {
        return { title: 'Read current time', details: {} };
      },
      async execute(request) {
        const calls = await runtime.listCalls(identity.organizationId, request.runId);
        expect(calls.find((call) => call.id === request.toolCallId))
          .toMatchObject({ status: 'running', idempotencyKey: request.idempotencyKey });
        if (failProvider) throw new Error('raw provider secret');
        return {
          kind: 'success',
          value: { iso: '2026-08-30T00:00:00.000Z' },
          safeSummary: { title: 'Current time returned', details: {} },
        };
      },
    };
    runtime = new PostgresToolRuntime(
      pool,
      new Slice3BaselinePolicy(),
      new PostgresApprovalModule(pool),
      [provider],
    );
    const runId = randomUUID();
    const baseCommand = {
      identity,
      agentRevisionId: agentRevisionId(randomUUID()),
      grantId,
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      runId,
      invocationId: randomUUID(),
      capabilityId: 'cmaster.utility.current_time:v1',
      input: {},
      signal: new AbortController().signal,
    } as const;
    const outcome = await runtime.invoke({ ...baseCommand, modelRequestId: 'model-tool-request-1' });

    expect(outcome).toMatchObject({
      kind: 'success',
      value: { iso: '2026-08-30T00:00:00.000Z' },
    });
    failProvider = true;
    const failure = await runtime.invoke({ ...baseCommand, modelRequestId: 'model-tool-request-2' });
    expect(failure).toEqual({
      kind: 'failed',
      toolCallId: expect.any(String),
      failure: {
        code: 'provider_failed',
        message: 'The Tool Provider failed.',
        retryable: true,
      },
    });
    expect((await runtime.listCalls(identity.organizationId, runId)).map((call) => call.status))
      .toEqual(['succeeded', 'failed']);
  });

  it('persists Employee Confirmation before an open-world Provider can execute', async () => {
    const identityModule = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Tool Confirmation ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Confirming Tool Employee',
    });
    await identityModule.provision();
    const identity = identityModule.resolveRequest();
    const catalog = new PostgresToolCatalog(pool);
    const grantId = toolGrantId(randomUUID());
    await catalog.provision(identity.organizationId, {
      revisions: [{
        id: toolRevisionId(randomUUID()),
        capabilityId: 'cmaster.http.fetch:v1',
        name: 'Fetch HTTPS content',
        description: 'Fetches text from an approved HTTPS host.',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
        effect: 'read_only',
        recovery: 'retry_same_call',
        risks: ['open_world'],
        providerKey: 'test:http-fetch',
      }],
      grants: [{ id: grantId, capabilityIds: ['cmaster.http.fetch:v1'] }],
    });
    const provider: ToolProvider = {
      key: 'test:http-fetch',
      summarize() {
        return {
          title: 'Fetch approved HTTPS content',
          details: { host: 'docs.example.test', path: '/guide', queryKeys: 'token' },
        };
      },
      async execute() {
        throw new Error('Provider must not execute before Employee Confirmation');
      },
    };
    const runtime = new PostgresToolRuntime(
      pool,
      new Slice3BaselinePolicy(),
      new PostgresApprovalModule(pool),
      [provider],
    );
    const runId = randomUUID();

    const command = {
      identity,
      agentRevisionId: agentRevisionId(randomUUID()),
      grantId,
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      runId,
      invocationId: randomUUID(),
      modelRequestId: 'model-tool-request-confirmation',
      capabilityId: 'cmaster.http.fetch:v1',
      input: { url: 'https://docs.example.test/guide?token=private' },
      signal: new AbortController().signal,
    } as const;
    const outcome = await runtime.invoke(command);
    const replayed = await runtime.invoke(command);

    expect(outcome).toMatchObject({ kind: 'confirmation_required', approval: { status: 'pending' } });
    expect(replayed).toEqual(outcome);
    const call = (await runtime.listCalls(identity.organizationId, runId))[0];
    expect(call).toMatchObject({ status: 'awaiting_confirmation' });
    expect(call?.requestSummary.details).toEqual({
      host: 'docs.example.test', path: '/guide', queryKeys: 'token',
    });
  });
});
