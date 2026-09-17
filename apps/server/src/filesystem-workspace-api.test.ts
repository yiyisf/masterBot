import { randomUUID } from 'node:crypto';
import {
  createInMemoryWorkspaceCatalog,
  type WorkspaceCatalog,
  type WorkspaceWorkingRoots,
} from '@cmaster/workspaces';
import { organizationId, principalId, type IdentityModule } from '@cmaster/identity';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerFilesystemWorkspaceApi } from './filesystem-workspace-api.js';

const requestIdentity = {
  organizationId: organizationId('00000000-0000-4000-8000-000000000001'),
  principalId: principalId('00000000-0000-4000-8000-000000000002'),
  principalType: 'employee' as const,
  displayName: 'Employee',
};
const identity: IdentityModule = {
  async provision() {},
  resolveRequest: () => requestIdentity,
};
const unavailableWorkingRoots: WorkspaceWorkingRoots = {
  async listWorktrees() { return { items: [] }; },
  async createWorktree() { throw new Error('Not used by this test'); },
  async archiveWorktree() { throw new Error('Not used by this test'); },
  async getWorktreeOperationByCommand() { throw new Error('Not used by this test'); },
  async getWorktreeLifecycleByCommand() { throw new Error('Not used by this test'); },
};
function dependencies(catalog: WorkspaceCatalog) {
  return { identity, catalog, workingRoots: unavailableWorkingRoots };
}

describe('Filesystem Workspace API', () => {
  it('provisions an empty Workspace from trusted identity and returns its public Contract', async () => {
    const app = Fastify();
    const catalog: WorkspaceCatalog = createInMemoryWorkspaceCatalog();
    registerFilesystemWorkspaceApi(app, dependencies(catalog));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workspaces',
      headers: { 'idempotency-key': randomUUID() },
      payload: { name: 'Quarterly planning' },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(response.headers['idempotency-replayed']).toBe('false');
    expect(response.json()).toMatchObject({
      name: 'Quarterly planning',
      source: { kind: 'empty' },
      operationMode: 'edit_with_confirmation',
      lifecycleStatus: 'ready',
      defaultWorkingRoot: { kind: 'default' },
    });
    expect(response.body).not.toContain(requestIdentity.organizationId);
    expect(response.body).not.toContain(requestIdentity.principalId);
    await app.close();
  });

  it('accepts trusted Git references without accepting a Browser server path', async () => {
    const app = Fastify();
    registerFilesystemWorkspaceApi(app, dependencies(createInMemoryWorkspaceCatalog()));
    const source = {
      kind: 'git',
      connectorId: randomUUID(),
      repositoryId: randomUUID(),
      defaultBranch: 'main',
    };

    const accepted = await app.inject({
      method: 'POST', url: '/api/v1/workspaces',
      headers: { 'idempotency-key': randomUUID() },
      payload: { name: 'Trusted Git', source },
    });
    const rejected = await app.inject({
      method: 'POST', url: '/api/v1/workspaces',
      headers: { 'idempotency-key': randomUUID() },
      payload: { name: 'Untrusted path', source: { ...source, serverPath: '/srv/private' } },
    });

    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(accepted.json()).toMatchObject({
      source,
      lifecycleStatus: 'provisioning',
      defaultWorkingRoot: null,
      provisioningFailure: null,
    });
    expect(rejected.statusCode).toBe(400);
    await app.close();
  });

  it('lists only bounded Workspace Contracts from the Catalog', async () => {
    const app = Fastify();
    registerFilesystemWorkspaceApi(app, dependencies(createInMemoryWorkspaceCatalog()));
    await app.inject({
      method: 'POST', url: '/api/v1/workspaces',
      headers: { 'idempotency-key': randomUUID() }, payload: { name: 'Planning' },
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/workspaces?limit=1' });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ name: 'Planning', lifecycleStatus: 'ready' }],
      nextCursor: null,
    });
    await app.close();
  });

  it('reads, archives, replays, and restores one private Workspace', async () => {
    const app = Fastify();
    registerFilesystemWorkspaceApi(app, dependencies(createInMemoryWorkspaceCatalog()));
    const created = await app.inject({
      method: 'POST', url: '/api/v1/workspaces',
      headers: { 'idempotency-key': randomUUID() }, payload: { name: 'Lifecycle' },
    });
    const workspaceId = created.json().id as string;
    const archiveCommandId = randomUUID();

    expect((await app.inject({
      method: 'GET', url: `/api/v1/workspaces/${workspaceId}`,
    })).statusCode).toBe(200);
    const archived = await app.inject({
      method: 'POST', url: `/api/v1/workspaces/${workspaceId}/archive`,
      headers: { 'idempotency-key': archiveCommandId },
    });
    const replayed = await app.inject({
      method: 'POST', url: `/api/v1/workspaces/${workspaceId}/archive`,
      headers: { 'idempotency-key': archiveCommandId },
    });
    const restored = await app.inject({
      method: 'POST', url: `/api/v1/workspaces/${workspaceId}/restore`,
      headers: { 'idempotency-key': randomUUID() },
    });

    expect(archived.json()).toMatchObject({ lifecycleStatus: 'archived' });
    expect(replayed.headers['idempotency-replayed']).toBe('true');
    expect(restored.json()).toMatchObject({ lifecycleStatus: 'ready' });
    await app.close();
  });

  it('reconciles provision and lifecycle Commands through operation-specific routes', async () => {
    const app = Fastify();
    registerFilesystemWorkspaceApi(app, dependencies(createInMemoryWorkspaceCatalog()));
    const provisionCommandId = randomUUID();
    const created = await app.inject({
      method: 'POST', url: '/api/v1/workspaces',
      headers: { 'idempotency-key': provisionCommandId }, payload: { name: 'Recovery' },
    });
    const workspaceId = created.json().id as string;
    const archiveCommandId = randomUUID();
    await app.inject({
      method: 'POST', url: `/api/v1/workspaces/${workspaceId}/archive`,
      headers: { 'idempotency-key': archiveCommandId },
    });

    const provision = await app.inject({
      method: 'GET', url: `/api/v1/workspaces/by-command/${provisionCommandId}`,
    });
    const lifecycle = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/lifecycle-commands/${archiveCommandId}`,
    });

    expect(provision.json()).toMatchObject({ id: workspaceId });
    expect(lifecycle.json()).toMatchObject({ id: workspaceId, lifecycleStatus: 'archived' });
    await app.close();
  });
});
