import { randomUUID } from 'node:crypto';
import {
  agentId,
  agentRevisionId,
  PostgresAgentModule,
} from '@cmaster/agents';
import {
  commandId,
  PostgresConversationModule,
} from '@cmaster/conversations';
import {
  contextInvocationId,
  contextRunId,
  PostgresContextBuilder,
  slice4BaselineContextPolicy,
  type InvocationContext,
} from '@cmaster/context';
import {
  PostgresExecutionModule,
  RunWorker,
  runCommandId,
  type AgentEngine,
  type EngineInvocation,
  type EngineEvent,
} from '@cmaster/execution';
import {
  modelProfileId,
  type ModelEvent,
  type ModelGateway,
  type ModelInvocationRequest,
} from '@cmaster/models';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
const pool = new Pool({ connectionString: databaseUrl });

beforeAll(async () => {
  await pool.query('SELECT 1');
});

afterAll(async () => {
  await pool.end();
});

const workerSummary = `## Employee Goal\nContinue the work\n## Explicit Constraints\nNone\n## Established Facts\nEarlier work exists\n## Decisions and Commitments\nKeep the boundary\n## Relevant Artifacts\nNone\n## Unresolved Items\nComplete follow-up`;

class SummaryGateway implements Pick<ModelGateway, 'stream'> {
  readonly requests: ModelInvocationRequest[] = [];

  constructor(private readonly fail = false) {}

  async *stream(request: ModelInvocationRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const callId = randomUUID() as never;
    const profile = { id: modelProfileId(randomUUID()), displayName: 'Summary Model' };
    yield { type: 'model_selected', callId, profile, fallback: false };
    if (this.fail) {
      yield {
        type: 'model_failed',
        callId,
        profile,
        failure: { code: 'stream_interrupted', message: 'safe failure', retryable: true },
        hadOutput: false,
      };
      return;
    }
    yield { type: 'text_delta', text: workerSummary };
    yield {
      type: 'model_completed',
      callId,
      profile,
      usage: { inputTokens: 1_700, outputTokens: 160, totalTokens: 1_860 },
      fallbackUsed: false,
    };
  }
}

class CapturingEngine implements AgentEngine {
  readonly kind = 'ai-sdk' as const;
  readonly version = '1' as const;
  invocation?: EngineInvocation;

  async *execute(input: EngineInvocation): AsyncIterable<EngineEvent> {
    this.invocation = input;
    if (!input.invocationContext) throw new Error('Invocation Context expected');
    yield {
      type: 'checkpoint_reached',
      checkpoint: {
        schemaVersion: 1,
        engineKind: 'ai-sdk',
        engineVersion: '1',
        contextManifestId: input.invocationContext.manifestId,
        toolCallId: 'context-test-boundary',
        outcome: 'completed',
        toolLoop: {
          modelStepNumber: 0,
          toolCallCount: 0,
          providerNeutralTranscript: [],
          completedToolCallIds: [],
          remainingModelToolRequests: [],
          outputGeneration: 0,
        },
      },
    };
    yield { type: 'text_delta', text: 'context received' };
    yield { type: 'completed' };
  }
}

describe('Context-aware Worker execution', () => {
  it('reuses a precommitted Manifest, excludes later Messages, and emits only safe metadata', async () => {
    const identity = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Context Execution Org ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Context Employee',
    });
    await identity.provision();
    const requestIdentity = identity.resolveRequest();

    const contextRevisionId = agentRevisionId(randomUUID());
    const agents = new PostgresAgentModule(pool, {
      agentId: agentId(randomUUID()),
      echoRevisionId: agentRevisionId(randomUUID()),
      aiSdkRevisionId: agentRevisionId(randomUUID()),
      toolRevisionId: agentRevisionId(randomUUID()),
      contextArtifactRevisionId: contextRevisionId,
      contextPolicyRevision: slice4BaselineContextPolicy.revision,
      activeRevisionId: contextRevisionId,
      name: `Context Agent ${randomUUID()}`,
    });
    await agents.provision(requestIdentity.organizationId);

    const conversations = new PostgresConversationModule(pool);
    const conversation = (await conversations.create(requestIdentity, {
      commandId: commandId(randomUUID()),
      title: 'Recovery boundary',
    })).value;
    await conversations.appendEmployeeMessage(requestIdentity, conversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: `older request ${'a'.repeat(700)}` }],
    });
    await conversations.appendAssistantMessage({
      organizationId: requestIdentity.organizationId,
      conversationId: conversation.id,
      sourceRunId: randomUUID(),
      sourceInvocationId: randomUUID(),
      parts: [{ type: 'text', text: `older answer ${'b'.repeat(700)}` }],
    });
    await conversations.appendEmployeeMessage(requestIdentity, conversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: `initial request ${'c'.repeat(300)}` }],
    });
    await conversations.appendAssistantMessage({
      organizationId: requestIdentity.organizationId,
      conversationId: conversation.id,
      sourceRunId: randomUUID(),
      sourceInvocationId: randomUUID(),
      parts: [{ type: 'text', text: `initial answer ${'d'.repeat(300)}` }],
    });
    const trigger = (await conversations.appendEmployeeMessage(requestIdentity, conversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: 'follow-up request' }],
    })).value;

    const execution = new PostgresExecutionModule(pool);
    const accepted = await execution.acceptRun(requestIdentity, {
      commandId: runCommandId(randomUUID()),
      messageId: trigger.id,
      conversationId: conversation.id,
      agent: await agents.resolveDefault(requestIdentity.organizationId),
    });
    const summaryModels = new SummaryGateway();
    const builder = new PostgresContextBuilder(pool, conversations, summaryModels);
    const modelBudget = {
      primaryProfileId: modelProfileId(randomUUID()),
      strictestContextWindowTokens: 6_296,
      maximumOutputTokens: 100,
    };
    const precommitted = await builder.build({
      organizationId: requestIdentity.organizationId,
      invocationId: contextInvocationId(accepted.value.rootInvocation.id),
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      modelBudget,
      fixedOverheadTokens: 128,
      summaryExecution: {
        runId: contextRunId(accepted.value.id),
        signal: new AbortController().signal,
      },
    });

    await conversations.appendEmployeeMessage(requestIdentity, conversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: 'must remain outside this Run' }],
    });

    const engine = new CapturingEngine();
    const worker = new RunWorker(
      execution,
      conversations,
      [engine],
      { workerId: `context-worker-${randomUUID()}`, leaseTtlMs: 1_000, maxAttempts: 3 },
      {
        agentRevisionId: contextRevisionId,
        builder,
        models: { resolveContextBudget: async () => modelBudget },
        resolveFixedOverheadTokens: async () => 128,
      },
    );
    await worker.relayOne();
    await worker.executeOne();

    expect(engine.invocation?.invocationContext).toEqual<InvocationContext>(
      precommitted.invocationContext,
    );
    expect(engine.invocation?.invocationContext?.messages).not.toContainEqual(
      expect.objectContaining({ text: 'must remain outside this Run' }),
    );
    const events = await execution.readEvents(requestIdentity, accepted.value.id, 0);
    const contextEvent = events.find((event) => event.type === 'invocation.context_built');
    expect(contextEvent?.data).toEqual({
      manifestId: precommitted.manifest.id,
      invocationId: accepted.value.rootInvocation.id,
      itemCount: 6,
      summarized: true,
      estimatedInputTokens: precommitted.manifest.estimatedInputTokens,
      contextPolicyRevision: 'slice4-context-v1',
    });
    expect(summaryModels.requests).toHaveLength(1);
    expect(JSON.stringify(contextEvent)).not.toContain('initial request');
    expect(JSON.stringify(contextEvent)).not.toContain(workerSummary);
    expect(JSON.stringify(contextEvent)).not.toContain(precommitted.manifest.items[0]?.sourceHash);

    const oversizedTrigger = (await conversations.appendEmployeeMessage(
      requestIdentity,
      conversation.id,
      {
        commandId: commandId(randomUUID()),
        parts: [{ type: 'text', text: `mandatory ${'x'.repeat(500)}` }],
      },
    )).value;
    const oversizedRun = await execution.acceptRun(requestIdentity, {
      commandId: runCommandId(randomUUID()),
      messageId: oversizedTrigger.id,
      conversationId: conversation.id,
      agent: await agents.resolveDefault(requestIdentity.organizationId),
    });
    const unusedEngine = new CapturingEngine();
    const rejectingWorker = new RunWorker(
      execution,
      conversations,
      [unusedEngine],
      { workerId: `context-worker-${randomUUID()}`, leaseTtlMs: 1_000, maxAttempts: 3 },
      {
        agentRevisionId: contextRevisionId,
        builder,
        models: {
          resolveContextBudget: async () => ({
            primaryProfileId: modelProfileId(randomUUID()),
            strictestContextWindowTokens: 4_500,
            maximumOutputTokens: 100,
          }),
        },
        resolveFixedOverheadTokens: async () => 250,
      },
    );
    await rejectingWorker.relayOne();
    await rejectingWorker.executeOne();

    expect(unusedEngine.invocation).toBeUndefined();
    await expect(execution.getRun(requestIdentity, oversizedRun.value.id)).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'context_input_too_large', retryable: false },
    });

    const failingConversation = (await conversations.create(requestIdentity, {
      commandId: commandId(randomUUID()),
      title: 'Summary failure',
    })).value;
    await conversations.appendEmployeeMessage(requestIdentity, failingConversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: `older request ${'a'.repeat(700)}` }],
    });
    await conversations.appendAssistantMessage({
      organizationId: requestIdentity.organizationId,
      conversationId: failingConversation.id,
      sourceRunId: randomUUID(),
      sourceInvocationId: randomUUID(),
      parts: [{ type: 'text', text: `older answer ${'b'.repeat(700)}` }],
    });
    await conversations.appendEmployeeMessage(requestIdentity, failingConversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: `recent request ${'c'.repeat(300)}` }],
    });
    await conversations.appendAssistantMessage({
      organizationId: requestIdentity.organizationId,
      conversationId: failingConversation.id,
      sourceRunId: randomUUID(),
      sourceInvocationId: randomUUID(),
      parts: [{ type: 'text', text: `recent answer ${'d'.repeat(300)}` }],
    });
    const failingTrigger = (await conversations.appendEmployeeMessage(
      requestIdentity,
      failingConversation.id,
      {
        commandId: commandId(randomUUID()),
        parts: [{ type: 'text', text: 'trigger summary failure' }],
      },
    )).value;
    const failingRun = await execution.acceptRun(requestIdentity, {
      commandId: runCommandId(randomUUID()),
      messageId: failingTrigger.id,
      conversationId: failingConversation.id,
      agent: await agents.resolveDefault(requestIdentity.organizationId),
    });
    const failingSummaryModels = new SummaryGateway(true);
    const failureWorker = new RunWorker(
      execution,
      conversations,
      [new CapturingEngine()],
      { workerId: `context-worker-${randomUUID()}`, leaseTtlMs: 1_000, maxAttempts: 3 },
      {
        agentRevisionId: contextRevisionId,
        builder: new PostgresContextBuilder(pool, conversations, failingSummaryModels),
        models: { resolveContextBudget: async () => modelBudget },
        resolveFixedOverheadTokens: async () => 128,
      },
    );
    await failureWorker.relayOne();
    await failureWorker.executeOne();

    expect(failingSummaryModels.requests).toHaveLength(1);
    await expect(execution.getRun(requestIdentity, failingRun.value.id)).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'context_build_failed', retryable: true },
    });
  });
});
