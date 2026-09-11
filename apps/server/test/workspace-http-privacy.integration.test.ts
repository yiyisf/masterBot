import { randomUUID } from 'node:crypto';
import { agentId, agentRevisionId, PostgresAgentModule } from '@cmaster/agents';
import { PostgresConversationModule } from '@cmaster/conversations';
import { PostgresExecutionModule } from '@cmaster/execution';
import { PostgresApprovalModule } from '@cmaster/governance';
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
  organizationId: organization, organizationName: 'HTTP privacy',
  principalId: principalId(randomUUID()), principalDisplayName: 'Creator',
});
const colleague = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization, organizationName: 'HTTP privacy',
  principalId: principalId(randomUUID()), principalDisplayName: 'Colleague',
});
const revision = agentRevisionId(randomUUID());
const agents = new PostgresAgentModule(pool, {
  agentId: agentId(randomUUID()), echoRevisionId: revision, activeRevisionId: revision,
  name: 'HTTP privacy Echo',
});
const conversations = new PostgresConversationModule(pool);
const execution = new PostgresExecutionModule(pool);
const approvals = new PostgresApprovalModule(pool);
const notifier = new PollingRunEventNotifier();
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
    featureFlags: new InMemoryFeatureFlags({
      nextArchitecture: true, employeeWorkspace: true,
    }),
    runApi: { identity, agents, conversations, execution, notifier },
    workspaceApi: { identity, conversations, execution, approvals },
  });
}

describe('Workspace HTTP privacy', () => {
  it('returns the same not-found response for colleague and unknown resources', async () => {
    const creatorApi = api(creator);
    const created = await creatorApi.inject({
      method: 'POST', url: '/api/v1/conversations',
      headers: { 'idempotency-key': randomUUID() }, payload: {},
    });
    const conversation = created.json<{ id: string }>();
    const appended = await creatorApi.inject({
      method: 'POST', url: `/api/v1/conversations/${conversation.id}/messages`,
      headers: { 'idempotency-key': randomUUID() },
      payload: { parts: [{ type: 'text', text: 'Private quarterly plan' }] },
    });
    const message = appended.json<{ id: string }>();
    const accepted = await creatorApi.inject({
      method: 'POST', url: '/api/v1/runs', headers: { 'idempotency-key': randomUUID() },
      payload: { trigger: { type: 'message', messageId: message.id } },
    });
    const run = accepted.json<{ runId: string }>();
    await creatorApi.close();

    const colleagueApi = api(colleague);
    for (const url of [
      `/api/v1/conversations/${conversation.id}`,
      `/api/v1/conversations/${conversation.id}/messages`,
      `/api/v1/runs/${run.runId}`,
      `/api/v1/conversations/${randomUUID()}`,
      `/api/v1/runs/${randomUUID()}`,
    ]) {
      const response = await colleagueApi.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'resource_not_found' });
    }
    const forbiddenTrigger = await colleagueApi.inject({
      method: 'POST', url: '/api/v1/runs', headers: { 'idempotency-key': randomUUID() },
      payload: { trigger: { type: 'message', messageId: message.id } },
    });
    expect(forbiddenTrigger.statusCode).toBe(404);

    const workspace = await colleagueApi.inject({
      method: 'GET', url: '/api/v1/workspace/conversations',
    });
    expect(workspace.statusCode).toBe(200);
    expect(workspace.json()).toMatchObject({ items: [] });
    await colleagueApi.close();
  });
});
