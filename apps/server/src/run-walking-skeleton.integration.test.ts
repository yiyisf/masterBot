import { randomUUID } from 'node:crypto';
import { agentId, agentRevisionId, PostgresAgentModule } from '@cmaster/agents';
import {
  commandId,
  conversationId,
  ConversationNotFoundError,
  IdempotencyConflictError,
  PostgresConversationModule,
} from '@cmaster/conversations';
import {
  EchoAgentEngine,
  PostgresExecutionModule,
  runCommandId,
  runId,
  RunNotFoundError,
  RunWorker,
  StaleLeaseError,
} from '@cmaster/execution';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
  type RequestIdentity,
} from '@cmaster/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildApi } from './app.js';
import { loadServerConfig } from './config.js';
import { PollingRunEventNotifier } from './run-event-notifier.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');

const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID();
const identityConfig = {
  organizationId: organizationId(randomUUID()),
  organizationName: `Integration ${suffix}`,
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Integration Employee',
};
const agentConfig = {
  agentId: agentId(randomUUID()),
  echoRevisionId: agentRevisionId(randomUUID()),
  activeEngineKind: 'echo' as const,
  name: `Echo ${suffix}`,
};
const identity = new PostgresDevelopmentIdentity(pool, identityConfig);
const agents = new PostgresAgentModule(pool, agentConfig);
const conversations = new PostgresConversationModule(pool);
const execution = new PostgresExecutionModule(pool);
const notifier = new PollingRunEventNotifier();
const config = loadServerConfig({
  DATABASE_URL: databaseUrl,
  CMASTER_RUNTIME_ENV: 'test',
  NEXT_ARCHITECTURE_ENABLED: 'true',
  CMASTER_DEVELOPMENT_IDENTITY_ENABLED: 'true',
}, []);

beforeAll(async () => {
  await identity.provision();
  await agents.provision(identity.resolveRequest().organizationId);
});

afterAll(async () => {
  await pool.end();
});

async function acceptRunThroughHttp(text: string) {
  const apiPool = new Pool({ connectionString: databaseUrl });
  const apiIdentity = new PostgresDevelopmentIdentity(apiPool, identityConfig);
  const apiAgents = new PostgresAgentModule(apiPool, agentConfig);
  const apiConversations = new PostgresConversationModule(apiPool);
  const apiExecution = new PostgresExecutionModule(apiPool);
  await apiIdentity.provision();
  await apiAgents.provision(apiIdentity.resolveRequest().organizationId);
  const app = buildApi({
    config,
    database: { check: async () => true },
    runApi: {
      identity: apiIdentity,
      agents: apiAgents,
      conversations: apiConversations,
      execution: apiExecution,
      notifier,
    },
  });
  const conversationResponse = await app.inject({
    method: 'POST', url: '/api/v1/conversations',
    headers: { 'idempotency-key': randomUUID() }, payload: {},
  });
  expect(conversationResponse.statusCode).toBe(201);
  const conversation = conversationResponse.json<{ id: string }>();
  const messageResponse = await app.inject({
    method: 'POST', url: `/api/v1/conversations/${conversation.id}/messages`,
    headers: { 'idempotency-key': randomUUID() },
    payload: { parts: [{ type: 'text', text }] },
  });
  expect(messageResponse.statusCode).toBe(201);
  const message = messageResponse.json<{ id: string }>();
  const runResponse = await app.inject({
    method: 'POST', url: '/api/v1/runs',
    headers: { 'idempotency-key': randomUUID() },
    payload: { trigger: { type: 'message', messageId: message.id } },
  });
  expect(runResponse.statusCode).toBe(202);
  expect(runResponse.headers['idempotency-replayed']).toBe('false');
  const accepted = runResponse.json<{ runId: string; eventsUrl: string }>();
  expect(accepted.eventsUrl).toBe(`/api/v1/runs/${accepted.runId}/events`);
  const snapshotResponse = await app.inject({ method: 'GET', url: `/api/v1/runs/${accepted.runId}` });
  expect(snapshotResponse.statusCode).toBe(200);
  const snapshot = snapshotResponse.json<{ lastSequence: number }>();
  await app.close();
  await apiPool.end();
  return {
    conversation,
    message,
    run: { id: accepted.runId, lastSequence: snapshot.lastSequence },
  };
}

function worker(workerId: string, leaseTtlMs = 1_000): RunWorker {
  return new RunWorker(execution, conversations, [new EchoAgentEngine()], {
    workerId, leaseTtlMs, maxAttempts: 5,
  });
}

async function drainOutbox(runWorker: RunWorker): Promise<void> {
  while (await runWorker.relayOne()) {
    // Drain all accepted Runs so tests do not depend on Outbox ordering.
  }
}

describe('Run Walking Skeleton', () => {
  it('replays a Command with the same payload and rejects key reuse', async () => {
    const key = commandId(randomUUID());
    const first = await conversations.create(identity.resolveRequest(), { commandId: key, title: 'Stable' });
    const replay = await conversations.create(identity.resolveRequest(), { commandId: key, title: 'Stable' });
    expect(replay).toMatchObject({ replayed: true, value: { id: first.value.id } });
    await expect(conversations.create(
      identity.resolveRequest(), { commandId: key, title: 'Different' },
    )).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('completes an accepted Run after the accepting API has stopped', async () => {
    const accepted = await acceptRunThroughHttp('durable echo');
    const runWorker = worker('worker-happy');
    expect(await runWorker.relayOne()).toBe(true);
    expect(await runWorker.executeOne()).toBe(true);

    const snapshot = await execution.getRun(identity.resolveRequest(), runId(accepted.run.id));
    expect(snapshot.status).toBe('succeeded');
    const messages = await conversations.listMessages(
      identity.resolveRequest(), conversationId(accepted.conversation.id), 0, 100,
    );
    expect(messages.map((item) => item.parts[0]?.text)).toEqual(['durable echo', 'durable echo']);
    expect(messages[1]?.sourceRunId).toBe(accepted.run.id);
  });

  it('leases one Run to only one Worker at a time and recovers after expiry', async () => {
    const accepted = await acceptRunThroughHttp('recover me');
    await worker('relay').relayOne();
    const first = await execution.leaseNext('worker-a', 100, 5);
    expect(first).toBeDefined();
    expect(await execution.leaseNext('worker-b', 100, 5)).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 140));
    const recovered = await execution.leaseNext('worker-b', 1_000, 5);
    expect(recovered?.attemptNumber).toBe(2);
    const events = await execution.readEvents(identity.resolveRequest(), runId(accepted.run.id), 0);
    expect(events.map((event) => event.type)).toContain('run.recovery_started');
    await execution.saveOutputReady(recovered!, 'recover me');
    const recoveredMessage = await conversations.appendAssistantMessage({
      organizationId: recovered!.organizationId,
      conversationId: recovered!.conversationId,
      sourceRunId: recovered!.runId,
      sourceInvocationId: recovered!.invocationId,
      parts: [{ type: 'text', text: 'recover me' }],
    });
    await execution.complete(recovered!, recoveredMessage.value.id);
  });

  it('finishes idempotent output delivery even after the Engine attempt limit', async () => {
    const accepted = await acceptRunThroughHttp('recover prepared output');
    await worker('relay-prepared').relayOne();
    const firstLease = await execution.leaseNext('worker-prepared-a', 50, 1);
    expect(firstLease).toBeDefined();
    await execution.saveOutputReady(firstLease!, 'recover prepared output');
    const firstMessage = await conversations.appendAssistantMessage({
      organizationId: firstLease!.organizationId,
      conversationId: firstLease!.conversationId,
      sourceRunId: firstLease!.runId,
      sourceInvocationId: firstLease!.invocationId,
      parts: [{ type: 'text', text: 'recover prepared output' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    const deliveryLease = await execution.leaseNext('worker-prepared-b', 1_000, 1);
    expect(deliveryLease?.preparedOutput).toBe('recover prepared output');
    const replayedMessage = await conversations.appendAssistantMessage({
      organizationId: deliveryLease!.organizationId,
      conversationId: deliveryLease!.conversationId,
      sourceRunId: deliveryLease!.runId,
      sourceInvocationId: deliveryLease!.invocationId,
      parts: [{ type: 'text', text: deliveryLease!.preparedOutput! }],
    });
    expect(replayedMessage).toMatchObject({ replayed: true, value: { id: firstMessage.value.id } });
    await execution.complete(deliveryLease!, replayedMessage.value.id);

    const snapshot = await execution.getRun(identity.resolveRequest(), runId(accepted.run.id));
    expect(snapshot.status).toBe('succeeded');
    const messages = await conversations.listMessages(
      identity.resolveRequest(), conversationId(accepted.conversation.id), 0, 100,
    );
    expect(messages.filter((message) => message.author === 'assistant')).toHaveLength(1);
  });

  it('serializes cancellation against the output-ready boundary', async () => {
    const beforeOutput = await acceptRunThroughHttp('cancel first');
    const cancelled = await execution.cancelRun(
      identity.resolveRequest(), runId(beforeOutput.run.id), runCommandId(randomUUID()),
    );
    expect(cancelled.kind).toBe('cancelled');

    const afterOutput = await acceptRunThroughHttp('output first');
    await drainOutbox(worker('relay-output'));
    const lease = await execution.leaseNext('worker-output', 1_000, 5);
    expect(lease?.runId).toBe(afterOutput.run.id);
    await execution.saveOutputReady(lease!, 'output first');
    const tooLate = await execution.cancelRun(
      identity.resolveRequest(), runId(afterOutput.run.id), runCommandId(randomUUID()),
    );
    expect(tooLate.kind).toBe('too_late');
    const delivered = await conversations.appendAssistantMessage({
      organizationId: lease!.organizationId,
      conversationId: lease!.conversationId,
      sourceRunId: lease!.runId,
      sourceInvocationId: lease!.invocationId,
      parts: [{ type: 'text', text: 'output first' }],
    });
    await execution.complete(lease!, delivered.value.id);

    const racing = await acceptRunThroughHttp('race cancellation');
    await drainOutbox(worker('relay-race'));
    const racingLease = await execution.leaseNext('worker-race', 1_000, 5);
    expect(racingLease?.runId).toBe(racing.run.id);
    const [outputResult, cancellationResult] = await Promise.allSettled([
      execution.saveOutputReady(racingLease!, 'race cancellation'),
      execution.cancelRun(identity.resolveRequest(), runId(racing.run.id), runCommandId(randomUUID())),
    ]);
    expect(cancellationResult.status).toBe('fulfilled');
    if (outputResult.status === 'fulfilled') {
      expect(outputResult.value).toBe('ready');
      expect(cancellationResult.status === 'fulfilled' && cancellationResult.value.kind).toBe('too_late');
      const racingMessage = await conversations.appendAssistantMessage({
        organizationId: racingLease!.organizationId,
        conversationId: racingLease!.conversationId,
        sourceRunId: racingLease!.runId,
        sourceInvocationId: racingLease!.invocationId,
        parts: [{ type: 'text', text: 'race cancellation' }],
      });
      await execution.complete(racingLease!, racingMessage.value.id);
    } else {
      expect(outputResult.reason).toBeInstanceOf(StaleLeaseError);
      expect(cancellationResult.status === 'fulfilled' && cancellationResult.value.kind).toBe('cancelled');
      const messages = await conversations.listMessages(
        identity.resolveRequest(), conversationId(racing.conversation.id), 0, 100,
      );
      expect(messages.filter((message) => message.author === 'assistant')).toHaveLength(0);
    }
  });

  it('replays SSE strictly after Last-Event-ID and hides other Organizations', async () => {
    const accepted = await acceptRunThroughHttp('sse replay');
    const runWorker = worker('worker-sse');
    await drainOutbox(runWorker);
    await runWorker.executeOne();

    const app = buildApi({
      config,
      database: { check: async () => true },
      runApi: { identity, agents, conversations, execution, notifier },
    });
    const response = await app.inject({
      method: 'GET', url: `/api/v1/runs/${accepted.run.id}/events`,
      headers: {
        'last-event-id': String(accepted.run.lastSequence),
        origin: 'http://localhost:3101',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3101');
    const ids = [...response.body.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    expect(ids.every((sequence) => sequence > accepted.run.lastSequence)).toBe(true);
    expect(ids).toEqual([...ids].sort((left, right) => left - right));

    const uiResponse = await app.inject({
      method: 'GET', url: `/api/v1/runs/${accepted.run.id}/ui-stream?afterSequence=0`,
    });
    expect(uiResponse.statusCode).toBe(200);
    expect(uiResponse.headers['x-vercel-ai-ui-message-stream']).toBe('v1');
    const uiIds = [...uiResponse.body.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    expect(uiIds).toEqual([...uiIds].sort((left, right) => left - right));
    const uiChunks = [...uiResponse.body.matchAll(/^data: (\{.*\})$/gm)]
      .map((match) => JSON.parse(match[1]!) as { type: string });
    expect(uiChunks.some((chunk) => chunk.type === 'text-delta')).toBe(true);
    expect(uiResponse.body).toContain('data: [DONE]');
    await app.close();

    const otherIdentity: RequestIdentity = {
      organizationId: organizationId(randomUUID()),
      principalId: principalId(randomUUID()),
      principalType: 'employee',
      displayName: 'Other Employee',
    };
    await expect(execution.getRun(otherIdentity, runId(accepted.run.id))).rejects.toBeInstanceOf(RunNotFoundError);
    await expect(conversations.get(
      otherIdentity, conversationId(accepted.conversation.id),
    )).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});
