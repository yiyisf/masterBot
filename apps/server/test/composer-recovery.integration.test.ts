import { randomUUID } from 'node:crypto';
import { agentId, agentRevisionId, PostgresAgentModule } from '@cmaster/agents';
import {
  commandId,
  ConversationNotFoundError,
  PostgresConversationModule,
} from '@cmaster/conversations';
import {
  EchoAgentEngine,
  InvalidRunCursorError,
  PostgresExecutionModule,
  RunWorker,
  runCommandId,
  RunNotFoundError,
} from '@cmaster/execution';
import { organizationId, PostgresDevelopmentIdentity, principalId } from '@cmaster/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildApi } from '../src/app.js';
import { loadServerConfig } from '../src/config.js';
import { PollingRunEventNotifier } from '../src/run-event-notifier.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });
const organization = organizationId(randomUUID());
const creator = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization, organizationName: 'Composer recovery',
  principalId: principalId(randomUUID()), principalDisplayName: 'Creator',
});
const colleague = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization, organizationName: 'Composer recovery',
  principalId: principalId(randomUUID()), principalDisplayName: 'Colleague',
});
const revisionId = agentRevisionId(randomUUID());
const agents = new PostgresAgentModule(pool, {
  agentId: agentId(randomUUID()), echoRevisionId: revisionId, activeRevisionId: revisionId,
  name: 'Composer recovery Echo',
});
const conversations = new PostgresConversationModule(pool);
const execution = new PostgresExecutionModule(pool);
const config = loadServerConfig({
  DATABASE_URL: databaseUrl, CMASTER_RUNTIME_ENV: 'test', NEXT_ARCHITECTURE_ENABLED: 'true',
  CMASTER_DEVELOPMENT_IDENTITY_ENABLED: 'true',
}, []);

beforeAll(async () => {
  await creator.provision();
  await colleague.provision();
  await agents.provision(organization);
});
afterAll(async () => pool.end());

describe('Composer Command recovery queries', () => {
  it('recovers creator-private Commands and distinguishes an explicit retryable Run attempt', async () => {
    const identity = creator.resolveRequest();
    const conversationCommandId = commandId(randomUUID());
    const messageCommandId = commandId(randomUUID());
    const firstRunCommandId = runCommandId(randomUUID());
    const secondRunCommandId = runCommandId(randomUUID());
    const conversation = (await conversations.create(identity, {
      commandId: conversationCommandId,
    })).value;
    const message = (await conversations.appendEmployeeMessage(identity, conversation.id, {
      commandId: messageCommandId,
      parts: [{ type: 'text', text: 'Prepare a project brief' }],
    })).value;
    const agent = await agents.resolveDefault(organization);
    const first = (await execution.acceptRun(identity, {
      commandId: firstRunCommandId, messageId: message.id, conversationId: conversation.id, agent,
    })).value;
    const runWorker = new RunWorker(
      execution, conversations, [new EchoAgentEngine()],
      { workerId: `failed-attempt-${randomUUID()}`, leaseTtlMs: 1_000, maxAttempts: 5 },
    );
    expect(await runWorker.relayOne()).toBe(true);
    const failedLease = await execution.leaseNext(
      `failed-attempt-${randomUUID()}`, 1_000, 5,
    );
    if (!failedLease || failedLease.runId !== first.id) {
      throw new Error('Expected to lease the first Run attempt');
    }
    await execution.fail(failedLease, {
      code: 'model_failed', message: 'The deterministic attempt failed.', retryable: true,
    });
    const second = (await execution.acceptRun(identity, {
      commandId: secondRunCommandId, messageId: message.id, conversationId: conversation.id, agent,
    })).value;

    await expect(conversations.getCreatedByCommand(identity, conversationCommandId))
      .resolves.toMatchObject({ id: conversation.id });
    await expect(conversations.getEmployeeMessageByCommand(identity, messageCommandId))
      .resolves.toMatchObject({ id: message.id });
    await expect(execution.getRunByCommand(identity, firstRunCommandId))
      .resolves.toMatchObject({ id: first.id });
    const firstAttemptPage = await execution.listConversationRuns(
      identity, conversation.id, { limit: 1 },
    );
    expect(firstAttemptPage.items).toHaveLength(1);
    expect(firstAttemptPage.nextCursor).toEqual(expect.any(String));
    if (!firstAttemptPage.nextCursor) throw new Error('Expected another Run attempt page');
    expect(firstAttemptPage.nextCursor).not.toContain(firstAttemptPage.items[0]?.id ?? '');
    const secondAttemptPage = await execution.listConversationRuns(
      identity, conversation.id, { limit: 1, cursor: firstAttemptPage.nextCursor },
    );
    expect([...firstAttemptPage.items, ...secondAttemptPage.items]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.id, triggerMessageId: message.id, status: 'failed', retryable: true,
        }),
        expect.objectContaining({ id: second.id, triggerMessageId: message.id }),
      ]),
    );
    await expect(execution.listConversationRuns(
      identity, conversation.id, { limit: 1, cursor: 'not-a-cursor' },
    )).rejects.toBeInstanceOf(InvalidRunCursorError);

    const app = buildApi({
      config,
      database: { check: async () => true },
      runApi: {
        identity: creator, agents, conversations, execution,
        notifier: new PollingRunEventNotifier(),
      },
    });
    for (const [url, expectedId] of [
      [`/api/v1/conversations/by-command/${conversationCommandId}`, conversation.id],
      [`/api/v1/messages/by-command/${messageCommandId}`, message.id],
      [`/api/v1/runs/by-command/${firstRunCommandId}`, first.id],
    ] as const) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: expectedId });
    }
    const attempts = await app.inject({
      method: 'GET', url: `/api/v1/conversations/${conversation.id}/runs?limit=1`,
    });
    expect(attempts.statusCode).toBe(200);
    const attemptsPage = attempts.json<{ items: unknown[]; nextCursor?: string }>();
    expect(attemptsPage.items).toHaveLength(1);
    expect(attemptsPage.nextCursor).toEqual(expect.any(String));
    if (!attemptsPage.nextCursor) throw new Error('Expected another HTTP Run attempt page');
    const olderAttempts = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversation.id}/runs?limit=1&cursor=${encodeURIComponent(attemptsPage.nextCursor)}`,
    });
    expect(olderAttempts.statusCode).toBe(200);
    expect(olderAttempts.json<{ items: unknown[] }>().items).toHaveLength(1);
    await app.close();

    const colleagueApi = buildApi({
      config,
      database: { check: async () => true },
      runApi: {
        identity: colleague, agents, conversations, execution,
        notifier: new PollingRunEventNotifier(),
      },
    });
    for (const url of [
      `/api/v1/conversations/by-command/${conversationCommandId}`,
      `/api/v1/messages/by-command/${messageCommandId}`,
      `/api/v1/runs/by-command/${firstRunCommandId}`,
      `/api/v1/conversations/${conversation.id}/runs`,
    ]) {
      const response = await colleagueApi.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'resource_not_found' });
    }
    await colleagueApi.close();

    await expect(conversations.getCreatedByCommand(
      colleague.resolveRequest(), conversationCommandId,
    )).rejects.toBeInstanceOf(ConversationNotFoundError);
    await expect(execution.getRunByCommand(
      colleague.resolveRequest(), firstRunCommandId,
    )).rejects.toBeInstanceOf(RunNotFoundError);
  });
});
