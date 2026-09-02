import { randomUUID } from 'node:crypto';
import { agentId, agentRevisionId, PostgresAgentModule } from '@cmaster/agents';
import {
  commandId,
  conversationId,
  PostgresConversationModule,
} from '@cmaster/conversations';
import {
  AiSdkAgentEngine,
  PostgresExecutionModule,
  runCommandId,
  RunWorker,
} from '@cmaster/execution';
import {
  PostgresApprovalModule,
  Slice3BaselinePolicy,
} from '@cmaster/governance';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import {
  modelProfileId,
  PostgresModelGateway,
  type ModelAdapter,
  type ModelAdapterEvent,
  type ModelAdapterRequest,
  type ModelFailure,
} from '@cmaster/models';
import {
  PostgresToolCatalog,
  PostgresToolRuntime,
  toolGrantId,
  toolRevisionId,
  type ToolProvider,
} from '@cmaster/tools';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { GovernedAgentToolRuntime } from '../src/governed-agent-tools.js';
import {
  Slice3DevelopmentEntitlements,
  ToolConfirmationCoordinator,
} from '../src/tool-confirmation-coordinator.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });

afterAll(async () => {
  await pool.end();
});

class ConfirmationModelAdapter implements ModelAdapter {
  readonly providerKind = 'openai-compatible' as const;
  calls = 0;
  resumedToolOutput: unknown;

  async *stream(request: ModelAdapterRequest): AsyncIterable<ModelAdapterEvent> {
    this.calls += 1;
    if (this.calls === 1) {
      yield {
        type: 'tool_requested',
        request: {
          requestId: 'provider-http-call-1',
          name: 'https_fetch',
          input: { url: 'https://docs.example.test/guide' },
        },
      };
      yield { type: 'completed', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } };
      return;
    }
    this.resumedToolOutput = request.transcript?.at(-1);
    yield { type: 'text_delta', text: 'The approved content is safe.' };
    yield { type: 'completed', usage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 } };
  }

  classifyError(): ModelFailure {
    return { code: 'unknown_provider_error', message: 'Model failed.', retryable: false };
  }
}

async function fixture(options: { unknownEffect?: boolean } = {}) {
  const identity = new PostgresDevelopmentIdentity(pool, {
    organizationId: organizationId(randomUUID()),
    organizationName: `Governed Tool Loop ${randomUUID()}`,
    principalId: principalId(randomUUID()),
    principalDisplayName: 'Tool Loop Employee',
  });
  await identity.provision();
  const agent = new PostgresAgentModule(pool, {
    agentId: agentId(randomUUID()),
    echoRevisionId: agentRevisionId(randomUUID()),
    aiSdkRevisionId: agentRevisionId(randomUUID()),
    activeEngineKind: 'ai-sdk',
    name: `Tool Agent ${randomUUID()}`,
  });
  await agent.provision(identity.resolveRequest().organizationId);
  const revision = await agent.resolveDefault(identity.resolveRequest().organizationId);

  const adapter = new ConfirmationModelAdapter();
  const models = new PostgresModelGateway(pool, adapter, {
    credentials: new Map([['env:test', 'model-secret']]),
  });
  await models.provision(identity.resolveRequest().organizationId, [{
    id: modelProfileId(randomUUID()),
    displayName: 'Tool Model',
    routeRole: 'primary',
    baseUrl: 'https://models.example.test/v1',
    providerModelId: 'tool-model',
    credentialRef: 'env:test',
    dataHandlingTier: 'test',
    costTier: 'test',
  }]);

  const grantId = toolGrantId(randomUUID());
  const catalog = new PostgresToolCatalog(pool);
  await catalog.provision(identity.resolveRequest().organizationId, {
    revisions: [{
      id: toolRevisionId(randomUUID()),
      capabilityId: 'cmaster.http.fetch:v1',
      name: 'https_fetch',
      description: 'Fetches approved HTTPS content.',
      inputSchema: {
        type: 'object', required: ['url'], additionalProperties: false,
        properties: { url: { type: 'string' } },
      },
      outputSchema: {
        type: 'object', required: ['body'], additionalProperties: false,
        properties: { body: { type: 'string' } },
      },
      effect: options.unknownEffect ? 'non_idempotent_write' : 'read_only',
      recovery: options.unknownEffect ? 'manual_review' : 'retry_same_call',
      risks: ['open_world'],
      providerKey: 'test:https-fetch',
    }],
    grants: [{ id: grantId, capabilityIds: ['cmaster.http.fetch:v1'] }],
  });
  let providerCalls = 0;
  const provider: ToolProvider = {
    key: 'test:https-fetch',
    summarize() {
      return { title: 'Fetch approved HTTPS content', details: { host: 'docs.example.test' } };
    },
    async execute() {
      providerCalls += 1;
      if (options.unknownEffect) throw new Error('connection lost after dispatch');
      return {
        kind: 'success',
        value: { body: 'safe' },
        safeSummary: { title: 'Approved HTTPS content fetched', details: {} },
      };
    },
  };
  const tools = new PostgresToolRuntime(
    pool, new Slice3BaselinePolicy(), new PostgresApprovalModule(pool), [provider],
  );
  const entitlements = new Slice3DevelopmentEntitlements();
  const execution = new PostgresExecutionModule(pool);
  const agentTools = new GovernedAgentToolRuntime(
    catalog, tools, identity, entitlements, grantId, execution,
  );
  const conversations = new PostgresConversationModule(pool);
  const created = await conversations.create(identity.resolveRequest(), {
    commandId: commandId(randomUUID()),
  });
  const message = await conversations.appendEmployeeMessage(
    identity.resolveRequest(), created.value.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: 'Fetch the approved guide.' }],
    },
  );
  const accepted = await execution.acceptRun(identity.resolveRequest(), {
    commandId: runCommandId(randomUUID()),
    conversationId: created.value.id,
    messageId: message.value.id,
    agent: revision,
  });
  const worker = new RunWorker(
    execution,
    conversations,
    [new AiSdkAgentEngine(models, agentTools)],
    { workerId: `tool-loop-${randomUUID()}`, leaseTtlMs: 1_000, maxAttempts: 5 },
  );
  return {
    identity,
    adapter,
    tools,
    execution,
    conversations,
    worker,
    coordinator: new ToolConfirmationCoordinator(execution, tools, entitlements),
    runId: accepted.value.id,
    conversationId: created.value.id,
    providerCalls: () => providerCalls,
  };
}

describe('governed Tool Loop', () => {
  it('waits durably for confirmation and resumes without regenerating or repeating the ToolCall', async () => {
    const runtime = await fixture();
    await runtime.worker.relayOne();
    await runtime.worker.executeOne();

    const waiting = await runtime.execution.getRun(
      runtime.identity.resolveRequest(), runtime.runId,
    );
    expect(waiting).toMatchObject({
      status: 'waiting',
      rootInvocation: { status: 'interrupted' },
      activeInterrupt: { kind: 'tool_confirmation' },
    });
    expect(runtime.adapter.calls).toBe(1);
    expect(runtime.providerCalls()).toBe(0);
    const interrupt = waiting.activeInterrupt;
    if (!interrupt) throw new Error('Tool confirmation Interrupt expected');

    const confirmationCommandId = randomUUID();
    await runtime.coordinator.resolve(
      runtime.identity.resolveRequest(), runtime.runId, interrupt.id, {
        commandId: confirmationCommandId,
        response: 'confirm',
        signal: new AbortController().signal,
      },
    );
    await expect(runtime.coordinator.resolve(
      runtime.identity.resolveRequest(), runtime.runId, interrupt.id, {
        commandId: confirmationCommandId,
        response: 'confirm',
        signal: new AbortController().signal,
      },
    )).resolves.toMatchObject({ replayed: true });
    expect(runtime.providerCalls()).toBe(1);
    await runtime.worker.executeOne();

    expect(await runtime.execution.getRun(
      runtime.identity.resolveRequest(), runtime.runId,
    )).toMatchObject({
      status: 'succeeded',
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
    });
    expect(runtime.adapter.calls).toBe(2);
    expect(runtime.providerCalls()).toBe(1);
    expect(runtime.adapter.resumedToolOutput).toMatchObject({
      role: 'tool',
      requestId: 'provider-http-call-1',
      output: { body: 'safe' },
    });
    expect(await runtime.tools.listCalls(
      runtime.identity.resolveRequest(), runtime.runId,
    )).toHaveLength(1);
    expect((await runtime.execution.readEvents(
      runtime.identity.resolveRequest(), runtime.runId, 0,
    )).map((event) => event.type)).toEqual(expect.arrayContaining([
      'tool.confirmation_required', 'tool.succeeded',
    ]));
    const messages = await runtime.conversations.listMessages(
      runtime.identity.resolveRequest(), conversationId(runtime.conversationId), 0, 100,
    );
    expect(messages.map((item) => item.parts[0]?.text)).toEqual([
      'Fetch the approved guide.', 'The approved content is safe.',
    ]);
  });

  it('turns an unknown non-idempotent effect into outcome review before continuing', async () => {
    const runtime = await fixture({ unknownEffect: true });
    await runtime.worker.relayOne();
    await runtime.worker.executeOne();
    const confirmation = await runtime.execution.getRun(
      runtime.identity.resolveRequest(), runtime.runId,
    );
    if (!confirmation.activeInterrupt) throw new Error('Confirmation expected');
    await runtime.coordinator.resolve(
      runtime.identity.resolveRequest(), runtime.runId, confirmation.activeInterrupt.id, {
        commandId: randomUUID(),
        response: 'confirm',
        signal: new AbortController().signal,
      },
    );

    await runtime.worker.executeOne();
    const review = await runtime.execution.getRun(
      runtime.identity.resolveRequest(), runtime.runId,
    );
    expect(review).toMatchObject({
      status: 'waiting',
      activeInterrupt: { kind: 'tool_outcome_review' },
    });
    expect(runtime.adapter.calls).toBe(1);
    expect(runtime.providerCalls()).toBe(1);
    if (!review.activeInterrupt) throw new Error('Outcome review expected');
    await runtime.execution.resolveInterrupt(
      runtime.identity.resolveRequest(), runtime.runId, review.activeInterrupt.id, {
        commandId: runCommandId(randomUUID()),
        response: 'continue_with_uncertainty',
      },
    );
    await runtime.worker.executeOne();

    expect(await runtime.execution.getRun(
      runtime.identity.resolveRequest(), runtime.runId,
    )).toMatchObject({ status: 'succeeded' });
    expect(runtime.providerCalls()).toBe(1);
    expect(runtime.adapter.calls).toBe(2);
    expect(runtime.adapter.resumedToolOutput).toMatchObject({
      role: 'tool',
      output: { status: 'uncertain', code: 'external_effect_unknown' },
    });
    expect((await runtime.execution.readEvents(
      runtime.identity.resolveRequest(), runtime.runId, 0,
    )).map((event) => event.type)).toContain('tool.requires_review');
  });

  it('continues with a denied Tool Outcome when the initiating Employee rejects', async () => {
    const runtime = await fixture();
    await runtime.worker.relayOne();
    await runtime.worker.executeOne();
    const waiting = await runtime.execution.getRun(
      runtime.identity.resolveRequest(), runtime.runId,
    );
    const interrupt = waiting.activeInterrupt;
    if (!interrupt) throw new Error('Tool confirmation Interrupt expected');

    await runtime.coordinator.resolve(
      runtime.identity.resolveRequest(), runtime.runId, interrupt.id, {
        commandId: randomUUID(),
        response: 'reject',
        signal: new AbortController().signal,
      },
    );
    await runtime.worker.executeOne();

    expect(await runtime.execution.getRun(
      runtime.identity.resolveRequest(), runtime.runId,
    )).toMatchObject({ status: 'succeeded' });
    expect(runtime.providerCalls()).toBe(0);
    expect(runtime.adapter.calls).toBe(2);
    expect(runtime.adapter.resumedToolOutput).toMatchObject({
      role: 'tool',
      output: { status: 'denied', reason: 'employee_rejected' },
    });
    expect((await runtime.execution.readEvents(
      runtime.identity.resolveRequest(), runtime.runId, 0,
    )).map((event) => event.type)).toContain('tool.denied');
  });
});
