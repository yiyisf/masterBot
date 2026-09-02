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
  type AgentToolRuntime,
} from '@cmaster/execution';
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
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });

afterAll(async () => {
  await pool.end();
});

class ScriptedModelAdapter implements ModelAdapter {
  readonly providerKind = 'openai-compatible' as const;
  fallbackCalls = 0;
  primaryCalls = 0;

  constructor(private readonly mode:
    | 'fallback-after-partial'
    | 'content-refusal'
    | 'primary-success'
    | 'tool-request') {}

  async *stream(request: ModelAdapterRequest): AsyncIterable<ModelAdapterEvent> {
    if (request.profile.routeRole === 'fallback') {
      this.fallbackCalls += 1;
      yield { type: 'text_delta', text: 'final fallback answer' };
      yield {
        type: 'completed',
        usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
      };
      return;
    }
    this.primaryCalls += 1;
    if (this.mode === 'tool-request') {
      if (this.primaryCalls === 1) {
        yield {
          type: 'tool_requested',
          request: { requestId: 'provider-call-1', name: 'current_time', input: {} },
        };
        yield { type: 'completed', usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 } };
        return;
      }
      yield { type: 'text_delta', text: 'It is noon.' };
      yield { type: 'completed', usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } };
      return;
    }
    if (this.mode === 'primary-success') {
      yield { type: 'text_delta', text: 'recovered answer' };
      yield { type: 'completed', usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 } };
      return;
    }
    if (this.mode === 'fallback-after-partial') yield { type: 'text_delta', text: 'discard me' };
    if (this.mode === 'content-refusal') yield { type: 'text_delta', text: 'unsafe partial draft' };
    throw new Error(this.mode);
  }

  classifyError(_error: unknown, hadOutput: boolean): ModelFailure {
    return this.mode === 'content-refusal'
      ? { code: 'content_policy_refusal', message: 'The model provider refused the request for safety reasons.', retryable: false }
      : { code: 'stream_interrupted', message: 'The model stream was interrupted.', retryable: hadOutput };
  }
}

async function fixture(
  adapter: ScriptedModelAdapter,
  execute = true,
  toolRuntime?: AgentToolRuntime,
) {
  const identity = new PostgresDevelopmentIdentity(pool, {
    organizationId: organizationId(randomUUID()),
    organizationName: `Model Runtime ${randomUUID()}`,
    principalId: principalId(randomUUID()),
    principalDisplayName: 'Model Runtime Employee',
  });
  await identity.provision();
  const agent = new PostgresAgentModule(pool, {
    agentId: agentId(randomUUID()),
    echoRevisionId: agentRevisionId(randomUUID()),
    aiSdkRevisionId: agentRevisionId(randomUUID()),
    activeEngineKind: 'ai-sdk',
    name: `AI Agent ${randomUUID()}`,
  });
  await agent.provision(identity.resolveRequest().organizationId);

  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const models = new PostgresModelGateway(pool, adapter, {
    credentials: new Map([
      ['env:primary', 'primary-secret'],
      ['env:fallback', 'fallback-secret'],
    ]),
    tracer: provider.getTracer('model-runtime-integration'),
  });
  const primaryProfileId = modelProfileId(randomUUID());
  const fallbackProfileId = modelProfileId(randomUUID());
  const profiles = [
    {
      id: primaryProfileId,
      displayName: 'Primary Test Model',
      routeRole: 'primary',
      baseUrl: 'https://primary.example.test/v1',
      providerModelId: 'primary-model',
      credentialRef: 'env:primary',
      dataHandlingTier: 'test',
      costTier: 'test',
    },
    {
      id: fallbackProfileId,
      displayName: 'Fallback Test Model',
      routeRole: 'fallback',
      baseUrl: 'https://fallback.example.test/v1',
      providerModelId: 'fallback-model',
      credentialRef: 'env:fallback',
      dataHandlingTier: 'test',
      costTier: 'test',
    },
  ] as const;
  await models.provision(identity.resolveRequest().organizationId, profiles);

  const conversations = new PostgresConversationModule(pool);
  const execution = new PostgresExecutionModule(pool);
  const created = await conversations.create(identity.resolveRequest(), {
    commandId: commandId(randomUUID()),
  });
  const message = await conversations.appendEmployeeMessage(
    identity.resolveRequest(), created.value.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: 'model input' }],
    },
  );
  const accepted = await execution.acceptRun(identity.resolveRequest(), {
    commandId: runCommandId(randomUUID()),
    conversationId: created.value.id,
    messageId: message.value.id,
    agent: await agent.resolveDefault(identity.resolveRequest().organizationId),
  });
  const worker = new RunWorker(
    execution,
    conversations,
    [new AiSdkAgentEngine(models, toolRuntime)],
    { workerId: `model-worker-${randomUUID()}`, leaseTtlMs: 1_000, maxAttempts: 5 },
  );
  if (execute) {
    await worker.relayOne();
    await worker.executeOne();
    await provider.forceFlush();
  }
  return {
    identity,
    conversations,
    execution,
    models,
    exporter,
    provider,
    worker,
    conversationId: created.value.id,
    runId: accepted.value.id,
    primaryProfileId,
    fallbackProfileId,
    profiles,
  };
}

describe('AI SDK Model Runtime', () => {
  it('publishes a Model Tool Request only after its ModelCall is durably completed', async () => {
    const runtime = await fixture(new ScriptedModelAdapter('tool-request'), false);
    await runtime.worker.relayOne();
    const snapshot = await runtime.execution.getRun(
      runtime.identity.resolveRequest(), runtime.runId,
    );
    const events = [];
    for await (const event of runtime.models.stream({
      organizationId: runtime.identity.resolveRequest().organizationId,
      runId: runtime.runId,
      invocationId: snapshot.rootInvocation.id,
      prompt: 'use current time',
      tools: [{
        name: 'current_time',
        description: 'Returns the current time.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: { type: 'object' },
      }],
      signal: new AbortController().signal,
    })) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      'model_selected', 'model_completed', 'tool_requested',
    ]);
    expect(events[2]).toMatchObject({
      type: 'tool_requested',
      request: { requestId: 'provider-call-1', name: 'current_time', input: {} },
    });
    expect((await runtime.models.listCalls(
      runtime.identity.resolveRequest().organizationId, runtime.runId,
    ))[0]).toMatchObject({ status: 'succeeded', hadOutput: true });
    await runtime.execution.cancelRun(
      runtime.identity.resolveRequest(), runtime.runId, runCommandId(randomUUID()),
    );
    await runtime.provider.shutdown();
  });

  it('completes a sequential Tool Loop and accumulates usage across Model Steps', async () => {
    const adapter = new ScriptedModelAdapter('tool-request');
    const invoked: string[] = [];
    const runtime = await fixture(adapter, true, {
      async list() {
        return [{
          name: 'current_time',
          description: 'Returns the current time.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          outputSchema: { type: 'object' },
        }];
      },
      async invoke(_input, request) {
        invoked.push(request.requestId);
        return {
          kind: 'completed',
          outcomeKind: 'success',
          toolCallId: 'tool-call-1',
          modelOutput: { iso: '2026-01-02T12:00:00Z' },
          safeSummary: { title: 'Current time read', details: {} },
        };
      },
      async recover() {
        throw new Error('not expected');
      },
    });

    expect(invoked).toEqual(['provider-call-1']);
    expect(adapter.primaryCalls).toBe(2);
    expect(await runtime.execution.getRun(
      runtime.identity.resolveRequest(), runtime.runId,
    )).toMatchObject({
      status: 'succeeded',
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
    });
    const messages = await runtime.conversations.listMessages(
      runtime.identity.resolveRequest(), conversationId(runtime.conversationId), 0, 100,
    );
    expect(messages.map((message) => message.parts[0]?.text)).toEqual([
      'model input', 'It is noon.',
    ]);
    await runtime.provider.shutdown();
  });

  it('discards partial Primary output and completes with the audited Fallback', async () => {
    const adapter = new ScriptedModelAdapter('fallback-after-partial');
    const runtime = await fixture(adapter);
    const snapshot = await runtime.execution.getRun(
      runtime.identity.resolveRequest(), runtime.runId,
    );
    expect(snapshot).toMatchObject({
      status: 'succeeded',
      model: {
        profileId: runtime.fallbackProfileId,
        displayName: 'Fallback Test Model',
        fallbackUsed: true,
      },
      usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
    });
    const messages = await runtime.conversations.listMessages(
      runtime.identity.resolveRequest(), conversationId(runtime.conversationId), 0, 100,
    );
    expect(messages.map((message) => message.parts[0]?.text)).toEqual([
      'model input',
      'final fallback answer',
    ]);
    const events = await runtime.execution.readEvents(runtime.identity.resolveRequest(), runtime.runId, 0);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'model.output_discarded',
      'invocation.output_reset',
      'model.fallback_selected',
      'model.completed',
      'run.succeeded',
    ]));
    expect(JSON.stringify(events)).not.toContain('env:primary');
    expect(JSON.stringify(events)).not.toContain('primary-secret');
    const calls = await runtime.models.listCalls(runtime.identity.resolveRequest().organizationId, runtime.runId);
    expect(calls.map((call) => call.status)).toEqual(['discarded', 'succeeded']);
    expect(calls[1]).toMatchObject({
      modelProfileId: runtime.fallbackProfileId,
      usage: { totalTokens: 7 },
    });
    expect(calls.every((call) => call.traceId && call.spanId)).toBe(true);
    await expect(runtime.models.provision(
      runtime.identity.resolveRequest().organizationId,
      [{ ...runtime.profiles[0], displayName: 'Mutated Profile' }],
    )).rejects.toThrow('immutable profile');
    await expect(runtime.models.provision(
      runtime.identity.resolveRequest().organizationId,
      [runtime.profiles[0], { ...runtime.profiles[1], dataHandlingTier: 'less-restricted' }],
    )).rejects.toThrow('preserve Primary');
    const spans = runtime.exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    expect(spans[1]?.attributes).toMatchObject({
      'gen_ai.provider.name': 'openai-compatible',
      'gen_ai.request.model': 'fallback-model',
      'gen_ai.usage.input_tokens': 4,
      'gen_ai.usage.output_tokens': 3,
    });
    expect(Object.keys(spans[1]?.attributes ?? {})).not.toContain('gen_ai.prompt');
    await runtime.provider.shutdown();
  });

  it('resets durable partial output before a recovered Lease starts a new generation', async () => {
    const runtime = await fixture(new ScriptedModelAdapter('primary-success'), false);
    await runtime.worker.relayOne();
    const crashedLease = await runtime.execution.leaseNext('crashed-worker', 300, 5);
    if (!crashedLease) throw new Error('Expected the crashed Worker to acquire a Lease');
    const interrupted = runtime.models.stream({
      organizationId: crashedLease.organizationId,
      runId: crashedLease.runId,
      invocationId: crashedLease.invocationId,
      prompt: 'model input',
      signal: new AbortController().signal,
    })[Symbol.asyncIterator]();
    expect((await interrupted.next()).value?.type).toBe('model_selected');
    expect((await interrupted.next()).value?.type).toBe('text_delta');
    await interrupted.return?.();
    await runtime.execution.recordProgress(crashedLease, [{
      type: 'output_started', generation: 0,
    }]);
    await runtime.execution.recordProgress(crashedLease, [{
      type: 'output_delta', generation: 0, text: 'orphaned partial answer',
    }]);
    await new Promise((resolve) => setTimeout(resolve, 350));

    await runtime.worker.executeOne();
    const events = await runtime.execution.readEvents(runtime.identity.resolveRequest(), runtime.runId, 0);
    const reset = events.find((event) => event.type === 'invocation.output_reset');
    expect(reset?.data).toMatchObject({ generation: 1, reason: 'recovery' });
    const calls = await runtime.models.listCalls(
      runtime.identity.resolveRequest().organizationId, runtime.runId,
    );
    expect(calls.map((call) => [call.attemptNumber, call.status])).toEqual([
      [1, 'failed'],
      [2, 'succeeded'],
    ]);
    expect(calls[0]?.failure).toMatchObject({ code: 'stream_interrupted' });
    const messages = await runtime.conversations.listMessages(
      runtime.identity.resolveRequest(), runtime.conversationId, 0, 100,
    );
    expect(messages.map((message) => message.parts[0]?.text)).toEqual([
      'model input',
      'recovered answer',
    ]);
    await runtime.provider.shutdown();
  });

  it('does not bypass a content-policy refusal with Fallback', async () => {
    const adapter = new ScriptedModelAdapter('content-refusal');
    const runtime = await fixture(adapter);
    const snapshot = await runtime.execution.getRun(
      runtime.identity.resolveRequest(), runtime.runId,
    );
    expect(snapshot).toMatchObject({
      status: 'failed',
      failure: { code: 'model_failed', retryable: false },
    });
    expect(adapter.fallbackCalls).toBe(0);
    const events = await runtime.execution.readEvents(
      runtime.identity.resolveRequest(), runtime.runId, 0,
    );
    expect(events.find((event) => event.type === 'invocation.output_reset')?.data)
      .toMatchObject({ reason: 'failure' });
    const calls = await runtime.models.listCalls(
      runtime.identity.resolveRequest().organizationId, runtime.runId,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: 'discarded', hadOutput: true });
    const messages = await runtime.conversations.listMessages(
      runtime.identity.resolveRequest(), runtime.conversationId, 0, 100,
    );
    expect(messages.filter((message) => message.author === 'assistant')).toHaveLength(0);
    const serializedSpans = JSON.stringify(runtime.exporter.getFinishedSpans().map((span) => ({
      name: span.name, attributes: span.attributes, events: span.events, status: span.status,
    })));
    expect(serializedSpans).not.toContain('model input');
    expect(serializedSpans).not.toContain('content-refusal');
    await runtime.provider.shutdown();
  });
});
