import { randomUUID } from 'node:crypto';
import { agentId, agentRevisionId, PostgresAgentModule } from '@cmaster/agents';
import { commandId, PostgresConversationModule } from '@cmaster/conversations';
import { PostgresExecutionModule } from '@cmaster/execution';
import { organizationId, PostgresDevelopmentIdentity, principalId } from '@cmaster/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildApi } from '../src/app.js';
import { loadServerConfig } from '../src/config.js';
import { InMemoryFeatureFlags } from '../src/feature-flags.js';
import { PollingRunEventNotifier } from '../src/run-event-notifier.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });
const organization = organizationId(randomUUID());
const creator = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization, organizationName: 'Continuing Conversations',
  principalId: principalId(randomUUID()), principalDisplayName: 'Creator',
});
const colleague = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization, organizationName: 'Continuing Conversations',
  principalId: principalId(randomUUID()), principalDisplayName: 'Colleague',
});
const revision = agentRevisionId(randomUUID());
const agents = new PostgresAgentModule(pool, {
  agentId: agentId(randomUUID()), echoRevisionId: revision, activeRevisionId: revision,
  name: 'Continuing Conversation Echo',
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

function api(identity: PostgresDevelopmentIdentity) {
  return buildApi({
    config,
    database: { check: async () => true },
    featureFlags: new InMemoryFeatureFlags({ nextArchitecture: true, employeeWorkspace: true }),
    runApi: {
      identity, agents, conversations, execution, notifier: new PollingRunEventNotifier(),
    },
    workspaceApi: { identity, conversations, execution },
  });
}

describe('continuing Conversation HTTP contract', () => {
  it('pages backward from the latest 50 Messages and renames idempotently', async () => {
    const created = await conversations.create(creator.resolveRequest(), {
      commandId: commandId(randomUUID()), title: 'Original title',
    });
    for (let sequence = 1; sequence <= 55; sequence += 1) {
      await conversations.appendEmployeeMessage(
        creator.resolveRequest(), created.value.id,
        {
          commandId: commandId(randomUUID()),
          parts: [{ type: 'text', text: `Message ${sequence}` }],
        },
      );
    }

    const creatorApi = api(creator);
    const latest = await creatorApi.inject({
      method: 'GET', url: `/api/v1/conversations/${created.value.id}/messages?limit=50`,
    });
    expect(latest.statusCode).toBe(200);
    expect(latest.json<{ items: { sequence: number }[]; beforeSequence?: number }>())
      .toMatchObject({
        items: Array.from({ length: 50 }, (_, index) => ({ sequence: index + 6 })),
        beforeSequence: 6,
      });
    const older = await creatorApi.inject({
      method: 'GET',
      url: `/api/v1/conversations/${created.value.id}/messages?limit=50&beforeSequence=6`,
    });
    expect(older.statusCode).toBe(200);
    expect(older.json<{ items: { sequence: number }[] }>().items.map((message) => message.sequence))
      .toEqual([1, 2, 3, 4, 5]);

    const renameCommandId = randomUUID();
    const rename = () => creatorApi.inject({
      method: 'PATCH', url: `/api/v1/conversations/${created.value.id}`,
      headers: { 'idempotency-key': renameCommandId }, payload: { title: '  Release plan  ' },
    });
    const renamed = await rename();
    expect(renamed.statusCode).toBe(200);
    expect(renamed.headers['idempotency-replayed']).toBe('false');
    expect(renamed.json()).toMatchObject({ title: 'Release plan', lastMessageSequence: 55 });
    const replayed = await rename();
    expect(replayed.statusCode).toBe(200);
    expect(replayed.headers['idempotency-replayed']).toBe('true');
    const reconciled = await creatorApi.inject({
      method: 'GET',
      url: `/api/v1/conversations/${created.value.id}/rename-commands/${renameCommandId}`,
    });
    expect(reconciled.statusCode).toBe(200);
    expect(reconciled.json()).toMatchObject({ title: 'Release plan' });
    const conflict = await creatorApi.inject({
      method: 'PATCH', url: `/api/v1/conversations/${created.value.id}`,
      headers: { 'idempotency-key': renameCommandId }, payload: { title: 'Different title' },
    });
    expect(conflict.statusCode).toBe(409);
    await creatorApi.close();

    const colleagueApi = api(colleague);
    for (const request of [
      { method: 'GET' as const, url: `/api/v1/conversations/${created.value.id}/messages?limit=50` },
      {
        method: 'GET' as const,
        url: `/api/v1/conversations/${created.value.id}/rename-commands/${renameCommandId}`,
      },
      {
        method: 'PATCH' as const, url: `/api/v1/conversations/${created.value.id}`,
        headers: { 'idempotency-key': randomUUID() }, payload: { title: 'Not allowed' },
      },
    ]) {
      const response = await colleagueApi.inject(request);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'resource_not_found' });
    }
    await colleagueApi.close();
  });
});
