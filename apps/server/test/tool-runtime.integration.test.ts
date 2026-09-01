import { randomUUID } from 'node:crypto';
import { agentRevisionId } from '@cmaster/agents';
import {
  approvalCommandId,
  PostgresApprovalModule,
  Slice3BaselinePolicy,
  type ApprovalModule,
  type PolicyModule,
} from '@cmaster/governance';
import {
  PostgresToolCatalog,
  PostgresToolRuntime,
  ToolInputValidationError,
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
          outputSchema: {
            type: 'object', properties: { iso: { type: 'string' } },
            required: ['iso'], additionalProperties: false,
          },
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
          outputSchema: { type: 'object' },
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
        outputSchema: {
          type: 'object', properties: { iso: { type: 'string' } },
          required: ['iso'], additionalProperties: false,
        },
        effect: 'read_only',
        recovery: 'retry_same_call',
        risks: [],
      },
    ]);

    await catalog.deactivate(organization, currentTimeRevisionId);
    expect(await catalog.list({ organizationId: organization, grantId })).toEqual([]);
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
    const revisionId = toolRevisionId(randomUUID());
    await catalog.provision(identity.organizationId, {
      revisions: [{
        id: revisionId,
        capabilityId: 'cmaster.utility.current_time:v1',
        name: 'Current time',
        description: 'Returns the current time.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
          type: 'object', properties: { iso: { type: 'string' } },
          required: ['iso'], additionalProperties: false,
        },
        effect: 'read_only',
        recovery: 'retry_same_call',
        risks: [],
        providerKey: 'test:current-time',
      }],
      grants: [{ id: grantId, capabilityIds: ['cmaster.utility.current_time:v1'] }],
    });

    let runtime: PostgresToolRuntime;
    let providerCalls = 0;
    let providerMode: 'success' | 'failure' | 'invalid' | 'oversized' = 'success';
    const provider: ToolProvider = {
      key: 'test:current-time',
      summarize() {
        return { title: 'Read current time', details: {} };
      },
      async execute(request) {
        providerCalls += 1;
        const calls = await runtime.listCalls(identity, request.runId);
        expect(calls.find((call) => call.id === request.toolCallId))
          .toMatchObject({ status: 'running', idempotencyKey: request.idempotencyKey });
        if (providerMode === 'failure') throw new Error('raw provider secret');
        return {
          kind: 'success',
          value: providerMode === 'oversized'
            ? { text: 'x'.repeat(64 * 1024) }
            : providerMode === 'invalid'
              ? { iso: 42 }
              : { iso: '2026-08-30T00:00:00.000Z' },
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
    await expect(runtime.invoke({
      ...baseCommand,
      modelRequestId: 'model-tool-request-invalid',
      input: { unexpected: true },
    })).rejects.toBeInstanceOf(ToolInputValidationError);
    expect(await runtime.listCalls(identity, runId)).toHaveLength(1);

    providerMode = 'oversized';
    const oversized = await runtime.invoke({
      ...baseCommand,
      modelRequestId: 'model-tool-request-oversized',
    });
    expect(oversized).toMatchObject({ kind: 'failed', failure: { code: 'provider_failed' } });

    providerMode = 'invalid';
    const invalid = await runtime.invoke({
      ...baseCommand,
      modelRequestId: 'model-tool-request-invalid-output',
    });
    expect(invalid).toMatchObject({ kind: 'failed', failure: { code: 'provider_failed' } });

    providerMode = 'failure';
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
    expect((await runtime.listCalls(identity, runId)).map((call) => call.status))
      .toEqual(['succeeded', 'failed', 'failed', 'failed']);

    await catalog.deactivate(identity.organizationId, revisionId);
    expect(await runtime.invoke({ ...baseCommand, modelRequestId: 'model-tool-request-1' }))
      .toEqual(outcome);
    expect(providerCalls).toBe(4);
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
    const httpRevisionId = toolRevisionId(randomUUID());
    await catalog.provision(identity.organizationId, {
      revisions: [{
        id: httpRevisionId,
        capabilityId: 'cmaster.http.fetch:v1',
        name: 'Fetch HTTPS content',
        description: 'Fetches text from an approved HTTPS host.',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
        outputSchema: {
          type: 'object', properties: { text: { type: 'string' } },
          required: ['text'], additionalProperties: false,
        },
        effect: 'read_only',
        recovery: 'retry_same_call',
        risks: ['open_world'],
        providerKey: 'test:http-fetch',
      }, {
        id: toolRevisionId(randomUUID()),
        capabilityId: 'test.non_idempotent.write:v1',
        name: 'Test non-idempotent write',
        description: 'Integration-only uncertain side effect.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: { type: 'object' },
        effect: 'non_idempotent_write',
        recovery: 'manual_review',
        risks: ['destructive'],
        providerKey: 'test:uncertain-write',
      }],
      grants: [{
        id: grantId,
        capabilityIds: ['cmaster.http.fetch:v1', 'test.non_idempotent.write:v1'],
      }],
    });
    let providerCalls = 0;
    let confirmedProviderMode: 'success' | 'oversized' = 'success';
    const provider: ToolProvider = {
      key: 'test:http-fetch',
      summarize() {
        return {
          title: 'Fetch approved HTTPS content',
          details: { host: 'docs.example.test', path: '/guide', queryKeys: 'token' },
        };
      },
      async execute() {
        providerCalls += 1;
        return {
          kind: 'success',
          value: confirmedProviderMode === 'oversized'
            ? { text: 'x'.repeat(64 * 1024) }
            : { text: 'approved content' },
          safeSummary: { title: 'HTTPS content returned', details: {} },
        };
      },
    };
    const uncertainProvider: ToolProvider = {
      key: 'test:uncertain-write',
      summarize() {
        return { title: 'Perform test write', details: {} };
      },
      async execute() {
        throw new Error('connection lost after dispatch');
      },
    };
    const baseline = new Slice3BaselinePolicy();
    const policy: PolicyModule = {
      evaluate(request) {
        return request.capabilityId === 'test.non_idempotent.write:v1'
          ? Promise.resolve({
            effect: 'allow',
            policyVersion: 'slice3-baseline-v1',
            reason: 'baseline_tool_allowed',
            obligations: [{ kind: 'employee_confirmation' }],
          })
          : baseline.evaluate(request);
      },
    };
    const postgresApprovals = new PostgresApprovalModule(pool);
    let failFirstApprovalRequest = true;
    const approvals: ApprovalModule = {
      request(identity, request) {
        if (failFirstApprovalRequest) {
          failFirstApprovalRequest = false;
          throw new Error('simulated crash before Approval creation');
        }
        return postgresApprovals.request(identity, request);
      },
      get(identity, approvalId) {
        return postgresApprovals.get(identity, approvalId);
      },
      resolve(identity, approvalId, resolution) {
        return postgresApprovals.resolve(identity, approvalId, resolution);
      },
    };
    const runtime = new PostgresToolRuntime(
      pool,
      policy,
      approvals,
      [provider, uncertainProvider],
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
    await expect(runtime.invoke(command))
      .rejects.toThrow('simulated crash before Approval creation');
    const outcome = await runtime.invoke(command);
    const replayed = await runtime.invoke(command);

    expect(outcome).toMatchObject({ kind: 'confirmation_required', approval: { status: 'pending' } });
    expect(replayed).toEqual(outcome);
    expect(providerCalls).toBe(0);
    const waitingCall = (await runtime.listCalls(identity, runId))[0];
    expect(waitingCall).toMatchObject({ status: 'awaiting_confirmation' });
    expect(waitingCall?.requestSummary.details).toEqual({
      host: 'docs.example.test', path: '/guide', queryKeys: 'token',
    });

    const resumed = await runtime.resume({
      identity,
      toolCallId: outcome.toolCallId,
      commandId: approvalCommandId(randomUUID()),
      response: 'confirm',
      principalEntitlements: command.principalEntitlements,
      signal: new AbortController().signal,
    });

    expect(resumed).toMatchObject({ kind: 'success', value: { text: 'approved content' } });
    expect(providerCalls).toBe(1);
    expect((await runtime.listCalls(identity, runId))[0]?.status).toBe('succeeded');

    confirmedProviderMode = 'oversized';
    const waitingForOversizedOutput = await runtime.invoke({
      ...command,
      modelRequestId: 'model-tool-request-resumed-oversized',
    });
    const oversized = await runtime.resume({
      identity,
      toolCallId: waitingForOversizedOutput.toolCallId,
      commandId: approvalCommandId(randomUUID()),
      response: 'confirm',
      principalEntitlements: command.principalEntitlements,
      signal: new AbortController().signal,
    });
    expect(oversized).toMatchObject({ kind: 'failed', failure: { code: 'provider_failed' } });
    expect((await runtime.listCalls(identity, runId))
      .find((call) => call.id === waitingForOversizedOutput.toolCallId)?.status).toBe('failed');
    confirmedProviderMode = 'success';

    const waitingForRejection = await runtime.invoke({
      ...command,
      modelRequestId: 'model-tool-request-rejected',
    });
    const rejected = await runtime.resume({
      identity,
      toolCallId: waitingForRejection.toolCallId,
      commandId: approvalCommandId(randomUUID()),
      response: 'reject',
      principalEntitlements: command.principalEntitlements,
      signal: new AbortController().signal,
    });
    expect(rejected).toEqual({
      kind: 'denied',
      toolCallId: waitingForRejection.toolCallId,
      reason: 'employee_rejected',
    });
    expect(providerCalls).toBe(2);

    const waitingForUncertainWrite = await runtime.invoke({
      ...command,
      modelRequestId: 'model-tool-request-uncertain',
      capabilityId: 'test.non_idempotent.write:v1',
      input: {},
    });
    const uncertain = await runtime.resume({
      identity,
      toolCallId: waitingForUncertainWrite.toolCallId,
      commandId: approvalCommandId(randomUUID()),
      response: 'confirm',
      principalEntitlements: command.principalEntitlements,
      signal: new AbortController().signal,
    });
    expect(uncertain).toMatchObject({
      kind: 'requires_review',
      failure: { code: 'external_effect_unknown', retryable: false },
    });

    const waitingForRevokedRevision = await runtime.invoke({
      ...command,
      modelRequestId: 'model-tool-request-revoked',
    });
    expect(waitingForRevokedRevision.kind).toBe('confirmation_required');
    await catalog.deactivate(identity.organizationId, httpRevisionId);
    const denied = await runtime.resume({
      identity,
      toolCallId: waitingForRevokedRevision.toolCallId,
      commandId: approvalCommandId(randomUUID()),
      response: 'confirm',
      principalEntitlements: command.principalEntitlements,
      signal: new AbortController().signal,
    });
    expect(denied).toEqual({
      kind: 'denied',
      toolCallId: waitingForRevokedRevision.toolCallId,
      reason: 'authorization_revoked',
    });
    expect(providerCalls).toBe(2);
  });
});
