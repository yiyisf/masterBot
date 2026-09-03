import { spawn } from 'node:child_process';
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
  ToolAuthorizationDeniedError,
  ToolInputValidationError,
  ToolPersistenceError,
  toolGrantId,
  toolRevisionId,
  type CredentialBroker,
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
    const grantedAgentRevisionId = agentRevisionId(randomUUID());
    const ungrantedAgentRevisionId = agentRevisionId(randomUUID());
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
      grants: [{
        id: grantId,
        agentRevisionId: grantedAgentRevisionId,
        capabilityIds: ['cmaster.utility.current_time:v1'],
      }],
    });

    const tools = await catalog.list({
      organizationId: organization,
      agentRevisionId: grantedAgentRevisionId,
    });

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

    expect(await catalog.list({
      organizationId: organization,
      agentRevisionId: ungrantedAgentRevisionId,
    })).toEqual([]);

    await catalog.deactivate(organization, currentTimeRevisionId);
    expect(await catalog.list({
      organizationId: organization,
      agentRevisionId: grantedAgentRevisionId,
    })).toEqual([]);
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
    const grantedAgentRevisionId = agentRevisionId(randomUUID());
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
      grants: [{
        id: grantId,
        agentRevisionId: grantedAgentRevisionId,
        capabilityIds: ['cmaster.utility.current_time:v1'],
      }],
    });

    let runtime: PostgresToolRuntime;
    let providerCalls = 0;
    let providerMode: 'success' | 'failure' | 'invalid' | 'oversized' | 'timeout' = 'success';
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
        if (providerMode === 'timeout') return new Promise<never>(() => undefined);
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
    let issueExpiredCredential = false;
    let credentialRevocations = 0;
    const credentials: CredentialBroker = {
      async issue(command) {
        return {
          id: randomUUID() as never,
          organizationId: command.identity.organizationId,
          principalId: command.identity.principalId,
          toolCallId: command.toolCallId,
          invocationId: command.invocationId,
          allowedOperations: command.allowedOperations,
          expiresAt: new Date(Date.now() + (issueExpiredCredential ? -1 : 60_000)),
          values: {},
        };
      },
      async revoke() { credentialRevocations += 1; },
    };
    runtime = new PostgresToolRuntime(
      pool,
      new Slice3BaselinePolicy(),
      new PostgresApprovalModule(pool),
      [provider],
      credentials,
      { providerTimeoutMs: 100 },
    );
    const runId = randomUUID();
    const baseCommand = {
      identity,
      agentRevisionId: grantedAgentRevisionId,
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
      agentRevisionId: agentRevisionId(randomUUID()),
      modelRequestId: 'model-tool-request-ungranted-agent',
    })).rejects.toBeInstanceOf(ToolAuthorizationDeniedError);
    expect(providerCalls).toBe(1);
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
    providerMode = 'timeout';
    const timedOut = await runtime.invoke({
      ...baseCommand,
      modelRequestId: 'model-tool-request-timeout',
    });
    expect(timedOut).toMatchObject({ kind: 'failed', failure: { code: 'provider_failed' } });
    expect((await runtime.listCalls(identity, runId)).map((call) => call.status))
      .toEqual(['succeeded', 'failed', 'failed', 'failed', 'failed']);
    expect(credentialRevocations).toBe(5);

    issueExpiredCredential = true;
    const expiredCredential = await runtime.invoke({
      ...baseCommand,
      modelRequestId: 'model-tool-request-expired-credential',
    });
    expect(expiredCredential).toMatchObject({
      kind: 'failed', failure: { code: 'provider_failed' },
    });
    expect(providerCalls).toBe(5);
    expect(credentialRevocations).toBe(6);

    await catalog.deactivate(identity.organizationId, revisionId);
    expect(await runtime.invoke({ ...baseCommand, modelRequestId: 'model-tool-request-1' }))
      .toEqual(outcome);
    expect(providerCalls).toBe(5);
  });

  it('recovers an expired safe Dispatch Attempt and fences its late result', async () => {
    const identityModule = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Tool Dispatch Recovery ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Tool Recovery Employee',
    });
    await identityModule.provision();
    const identity = identityModule.resolveRequest();
    const agentRevision = agentRevisionId(randomUUID());
    const catalog = new PostgresToolCatalog(pool);
    await catalog.provision(identity.organizationId, {
      revisions: [{
        id: toolRevisionId(randomUUID()),
        capabilityId: 'cmaster.utility.current_time:v1',
        name: 'Current time',
        description: 'Returns the current time.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
          type: 'object', required: ['iso'], additionalProperties: false,
          properties: { iso: { type: 'string' } },
        },
        effect: 'read_only',
        recovery: 'retry_same_call',
        risks: [],
        providerKey: 'test:recover-time',
      }],
      grants: [{
        id: toolGrantId(randomUUID()),
        agentRevisionId: agentRevision,
        capabilityIds: ['cmaster.utility.current_time:v1'],
      }],
    });

    let providerCalls = 0;
    const idempotencyKeys: string[] = [];
    let releaseFirst: ((value: {
      kind: 'success';
      value: { iso: string };
      safeSummary: { title: string; details: Record<string, string> };
    }) => void) | undefined;
    let markEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const provider: ToolProvider = {
      key: 'test:recover-time',
      summarize: () => ({ title: 'Read current time', details: {} }),
      execute(request) {
        providerCalls += 1;
        idempotencyKeys.push(request.idempotencyKey);
        if (providerCalls === 1) {
          markEntered?.();
          return new Promise((resolve) => { releaseFirst = resolve; });
        }
        return Promise.resolve({
          kind: 'success',
          value: { iso: '2026-09-03T00:00:00.000Z' },
          safeSummary: { title: 'Current time returned', details: {} },
        });
      },
    };
    const runtime = new PostgresToolRuntime(
      pool, new Slice3BaselinePolicy(), new PostgresApprovalModule(pool), [provider],
    );
    const command = {
      identity,
      agentRevisionId: agentRevision,
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      runId: randomUUID(),
      invocationId: randomUUID(),
      modelRequestId: 'stable-model-request',
      capabilityId: 'cmaster.utility.current_time:v1',
      input: {},
      signal: new AbortController().signal,
    } as const;

    const staleAttempt = runtime.invoke(command);
    await entered;
    await pool.query(
      `UPDATE tool_dispatch_attempts SET lease_expires_at = clock_timestamp() - interval '1 second'
       WHERE organization_id = $1 AND tool_call_id IN (
         SELECT id FROM tool_calls WHERE organization_id = $1 AND run_id = $2
       )`,
      [identity.organizationId, command.runId],
    );

    await expect(runtime.invoke(command)).resolves.toMatchObject({ kind: 'success' });
    expect(providerCalls).toBe(2);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    releaseFirst?.({
      kind: 'success',
      value: { iso: '2026-09-03T00:00:01.000Z' },
      safeSummary: { title: 'Late current time', details: {} },
    });
    await expect(staleAttempt).rejects.toBeInstanceOf(ToolPersistenceError);
    expect((await runtime.listCalls(identity, command.runId))[0]?.outcome)
      .toMatchObject({ kind: 'success', value: { iso: '2026-09-03T00:00:00.000Z' } });
  });

  it('reconciles the same ToolCall after its Provider process exits mid-dispatch', async () => {
    const identityModule = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Tool Process Recovery ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Tool Process Recovery Employee',
    });
    await identityModule.provision();
    const identity = identityModule.resolveRequest();
    const agentRevision = agentRevisionId(randomUUID());
    const catalog = new PostgresToolCatalog(pool);
    await catalog.provision(identity.organizationId, {
      revisions: [{
        id: toolRevisionId(randomUUID()),
        capabilityId: 'cmaster.utility.current_time:v1',
        name: 'Current time',
        description: 'Returns the current time.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: {
          type: 'object', required: ['iso'], additionalProperties: false,
          properties: { iso: { type: 'string' } },
        },
        effect: 'read_only',
        recovery: 'reconcile',
        risks: [],
        providerKey: 'test:process-crash-time',
      }],
      grants: [{
        id: toolGrantId(randomUUID()),
        agentRevisionId: agentRevision,
        capabilityIds: ['cmaster.utility.current_time:v1'],
      }],
    });
    const command = {
      identity,
      agentRevisionId: agentRevision,
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      runId: randomUUID(),
      invocationId: randomUUID(),
      modelRequestId: 'process-crash-model-request',
      capabilityId: 'cmaster.utility.current_time:v1',
      input: {},
      signal: new AbortController().signal,
    } as const;
    const child = spawn(process.execPath, [
      '--import', 'tsx', '--conditions=development',
      new URL('./fixtures/tool-dispatch-crash.ts', import.meta.url).pathname,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        TEST_ORGANIZATION_ID: identity.organizationId,
        TEST_PRINCIPAL_ID: identity.principalId,
        TEST_AGENT_REVISION_ID: agentRevision,
        TEST_RUN_ID: command.runId,
        TEST_INVOCATION_ID: command.invocationId,
        TEST_MODEL_REQUEST_ID: command.modelRequestId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let childError = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { childError += chunk; });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    expect(exitCode, childError).toBe(86);

    const persisted = await pool.query<{ idempotency_key: string }>(
      `SELECT c.idempotency_key
       FROM tool_calls c
       JOIN tool_dispatch_attempts a
         ON a.organization_id = c.organization_id AND a.tool_call_id = c.id
       WHERE c.organization_id = $1 AND c.run_id = $2
         AND c.status = 'running' AND a.status = 'running'`,
      [identity.organizationId, command.runId],
    );
    const originalKey = persisted.rows[0]?.idempotency_key;
    expect(originalKey).toBeDefined();
    await pool.query(
      `UPDATE tool_dispatch_attempts SET lease_expires_at = clock_timestamp() - interval '1 second'
       WHERE organization_id = $1 AND status = 'running'`,
      [identity.organizationId],
    );
    let recoveredKey: string | undefined;
    let repeatedDispatches = 0;
    const recoveryProvider: ToolProvider = {
      key: 'test:process-crash-time',
      summarize: () => ({ title: 'Read current time', details: {} }),
      async execute() {
        repeatedDispatches += 1;
        throw new Error('the original effect must not be dispatched during reconciliation');
      },
      async reconcile(request) {
        recoveredKey = request.idempotencyKey;
        return {
          kind: 'success',
          value: { iso: '2026-09-04T00:00:00.000Z' },
          safeSummary: { title: 'Current time reconciled', details: {} },
        };
      },
    };
    const recoveredRuntime = new PostgresToolRuntime(
      pool, new Slice3BaselinePolicy(), new PostgresApprovalModule(pool), [recoveryProvider],
    );
    await expect(recoveredRuntime.invoke(command)).resolves.toMatchObject({ kind: 'success' });
    expect(repeatedDispatches).toBe(0);
    expect(recoveredKey).toBe(originalKey);
    const attempts = await pool.query<{ attempt_number: number; status: string }>(
      `SELECT attempt_number, status FROM tool_dispatch_attempts
       WHERE organization_id = $1 AND tool_call_id IN (
         SELECT id FROM tool_calls WHERE organization_id = $1 AND run_id = $2
       ) ORDER BY attempt_number`,
      [identity.organizationId, command.runId],
    );
    expect(attempts.rows).toEqual([
      { attempt_number: 1, status: 'failed' },
      { attempt_number: 2, status: 'succeeded' },
    ]);
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
    const grantedAgentRevisionId = agentRevisionId(randomUUID());
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
        agentRevisionId: grantedAgentRevisionId,
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
    let uncertainProviderMode: 'throw' | 'hang' = 'throw';
    let markUncertainEntered: (() => void) | undefined;
    let releaseUncertain: ((result: {
      kind: 'success'; value: Record<string, never>;
      safeSummary: { title: string; details: Record<string, string> };
    }) => void) | undefined;
    const uncertainProvider: ToolProvider = {
      key: 'test:uncertain-write',
      summarize() {
        return { title: 'Perform test write', details: {} };
      },
      execute() {
        if (uncertainProviderMode === 'throw') {
          return Promise.reject(new Error('connection lost after dispatch'));
        }
        markUncertainEntered?.();
        return new Promise((resolve) => { releaseUncertain = resolve; });
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
    let credentialLeases = 0;
    let credentialRevocations = 0;
    const credentials: CredentialBroker = {
      async issue(leaseCommand) {
        credentialLeases += 1;
        return {
          id: randomUUID() as never,
          organizationId: leaseCommand.identity.organizationId,
          principalId: leaseCommand.identity.principalId,
          toolCallId: leaseCommand.toolCallId,
          invocationId: leaseCommand.invocationId,
          allowedOperations: leaseCommand.allowedOperations,
          expiresAt: new Date(Date.now() + 60_000),
          values: {},
        };
      },
      async revoke() { credentialRevocations += 1; },
    };
    const runtime = new PostgresToolRuntime(
      pool,
      policy,
      approvals,
      [provider, uncertainProvider],
      credentials,
    );
    const runId = randomUUID();

    const command = {
      identity,
      agentRevisionId: grantedAgentRevisionId,
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
    expect(credentialLeases).toBe(0);
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
    expect(credentialLeases).toBe(1);
    expect(credentialRevocations).toBe(1);
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

    uncertainProviderMode = 'hang';
    const waitingForCrashedWrite = await runtime.invoke({
      ...command,
      modelRequestId: 'model-tool-request-crashed-write',
      capabilityId: 'test.non_idempotent.write:v1',
      input: {},
    });
    const uncertainEntered = new Promise<void>((resolve) => { markUncertainEntered = resolve; });
    const recoveryCommandId = approvalCommandId(randomUUID());
    const interruptedResume = runtime.resume({
      identity,
      toolCallId: waitingForCrashedWrite.toolCallId,
      commandId: recoveryCommandId,
      response: 'confirm',
      principalEntitlements: command.principalEntitlements,
      signal: new AbortController().signal,
    });
    await uncertainEntered;
    await pool.query(
      `UPDATE tool_dispatch_attempts SET lease_expires_at = clock_timestamp() - interval '1 second'
       WHERE organization_id = $1 AND tool_call_id = $2`,
      [identity.organizationId, waitingForCrashedWrite.toolCallId],
    );
    await expect(runtime.resume({
      identity,
      toolCallId: waitingForCrashedWrite.toolCallId,
      commandId: recoveryCommandId,
      response: 'confirm',
      principalEntitlements: command.principalEntitlements,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ kind: 'requires_review' });
    releaseUncertain?.({
      kind: 'success', value: {},
      safeSummary: { title: 'Late uncertain write', details: {} },
    });
    await expect(interruptedResume).rejects.toBeInstanceOf(ToolPersistenceError);

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
    expect(credentialLeases).toBe(4);
    expect(credentialRevocations).toBe(4);
  });
});
