import { randomUUID } from 'node:crypto';
import { PostgresDevelopmentIdentity, organizationId, principalId } from '@cmaster/identity';
import { PostgresWorkspaceCatalog } from '@cmaster/workspaces';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { buildApi } from '../src/app.js';
import { loadServerConfig } from '../src/config.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });
const organization = organizationId(randomUUID());
const owner = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Filesystem Workspace HTTP test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Owner',
});
const colleague = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Filesystem Workspace HTTP test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Colleague',
});
const config = loadServerConfig({
  DATABASE_URL: databaseUrl,
  CMASTER_SERVER_ROLE: 'api',
  CMASTER_RUNTIME_ENV: 'test',
  NEXT_ARCHITECTURE_ENABLED: 'true',
  CMASTER_DEVELOPMENT_IDENTITY_ENABLED: 'true',
  CMASTER_FILESYSTEM_WORKSPACE_ENABLED: 'true',
}, []);
let currentIdentity = owner.resolveRequest();
const identity = {
  async provision() {},
  resolveRequest: () => currentIdentity,
};

function api() {
  return buildApi({
    config,
    database: { check: async () => true },
    filesystemWorkspaceApi: { identity, catalog: new PostgresWorkspaceCatalog(pool) },
  });
}

beforeAll(async () => {
  await owner.provision();
  await colleague.provision();
  currentIdentity = owner.resolveRequest();
});
afterAll(async () => pool.end());

describe('Filesystem Workspace HTTP privacy and recovery', () => {
  it('reconciles Commands across API restart and hides owner resources from a colleague', async () => {
    const provisionCommandId = randomUUID();
    const firstApi = api();
    const created = await firstApi.inject({
      method: 'POST', url: '/api/v1/workspaces',
      headers: { 'idempotency-key': provisionCommandId },
      payload: { name: 'Private workspace' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const workspaceId = created.json().id as string;
    await firstApi.close();

    const restartedApi = api();
    const replayed = await restartedApi.inject({
      method: 'POST', url: '/api/v1/workspaces',
      headers: { 'idempotency-key': provisionCommandId },
      payload: { name: 'Private workspace' },
    });
    expect(replayed.headers['idempotency-replayed']).toBe('true');
    expect(replayed.json()).toEqual(created.json());
    const conflicting = await restartedApi.inject({
      method: 'POST', url: '/api/v1/workspaces',
      headers: { 'idempotency-key': provisionCommandId },
      payload: { name: 'Changed request' },
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json()).toMatchObject({ code: 'idempotency_conflict', status: 409 });
    const archiveCommandId = randomUUID();
    expect((await restartedApi.inject({
      method: 'POST', url: `/api/v1/workspaces/${workspaceId}/archive`,
      headers: { 'idempotency-key': archiveCommandId },
    })).json()).toMatchObject({ lifecycleStatus: 'archived' });
    expect((await restartedApi.inject({
      method: 'POST', url: `/api/v1/workspaces/${workspaceId}/restore`,
      headers: { 'idempotency-key': randomUUID() },
    })).json()).toMatchObject({ lifecycleStatus: 'ready' });
    expect((await restartedApi.inject({
      method: 'GET', url: `/api/v1/workspaces/by-command/${provisionCommandId}`,
    })).json()).toMatchObject({ id: workspaceId, lifecycleStatus: 'ready' });
    expect((await restartedApi.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/lifecycle-commands/${archiveCommandId}`,
    })).json()).toMatchObject({ id: workspaceId, lifecycleStatus: 'ready' });

    currentIdentity = colleague.resolveRequest();
    const forbidden = await restartedApi.inject({
      method: 'GET', url: `/api/v1/workspaces/${workspaceId}`,
    });
    const unknown = await restartedApi.inject({
      method: 'GET', url: `/api/v1/workspaces/${randomUUID()}`,
    });
    expect(forbidden.statusCode).toBe(404);
    expect(forbidden.json()).toMatchObject({
      code: 'resource_not_found', title: 'Resource not found', status: 404,
    });
    expect(unknown.json()).toMatchObject({
      code: 'resource_not_found', title: 'Resource not found', status: 404,
    });

    const forbiddenLifecycle = await restartedApi.inject({
      method: 'POST', url: `/api/v1/workspaces/${workspaceId}/archive`,
      headers: { 'idempotency-key': randomUUID() },
    });
    const unknownLifecycle = await restartedApi.inject({
      method: 'POST', url: `/api/v1/workspaces/${randomUUID()}/archive`,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(forbiddenLifecycle.statusCode).toBe(404);
    expect(unknownLifecycle.statusCode).toBe(404);
    expect({ ...forbiddenLifecycle.json(), instance: undefined })
      .toEqual({ ...unknownLifecycle.json(), instance: undefined });

    const forbiddenProvisionRecovery = await restartedApi.inject({
      method: 'GET', url: `/api/v1/workspaces/by-command/${provisionCommandId}`,
    });
    const unknownProvisionRecovery = await restartedApi.inject({
      method: 'GET', url: `/api/v1/workspaces/by-command/${randomUUID()}`,
    });
    expect(forbiddenProvisionRecovery.statusCode).toBe(404);
    expect({ ...forbiddenProvisionRecovery.json(), instance: undefined })
      .toEqual({ ...unknownProvisionRecovery.json(), instance: undefined });
    expect((await restartedApi.inject({ method: 'GET', url: '/api/v1/workspaces' })).json())
      .toEqual({ items: [], nextCursor: null });
    await restartedApi.close();
  });
});
