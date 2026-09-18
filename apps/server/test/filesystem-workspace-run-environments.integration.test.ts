import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PostgresWorkspaceCatalog,
  PostgresWorkspaceRunEnvironments,
  type WorkspaceSandboxAdapter,
  WorkspaceNotFoundError,
  WorkspaceRunEnvironmentUnavailableError,
  workspaceCommandId,
  workspaceInvocationId,
  workspaceRevisionId,
} from '@cmaster/workspaces';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString });
const organization = organizationId(randomUUID());
const owner = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Workspace Run Environment test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Environment owner',
});
const colleague = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Workspace Run Environment test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Colleague',
});

describe('PostgreSQL Workspace Run Environments', () => {
  beforeAll(async () => {
    await owner.provision();
    await colleague.provision();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('prepares one opaque fixed-Revision environment idempotently and keeps it owner-private', async () => {
    const created = await new PostgresWorkspaceCatalog(pool).provisionEmpty(
      owner.resolveRequest(),
      {
        commandId: workspaceCommandId(randomUUID()),
        name: 'Run environment',
        operationMode: 'observe',
      },
    );
    const root = created.value.defaultWorkingRoot;
    if (!root) throw new Error('Expected a default Working Root');
    const environments = new PostgresWorkspaceRunEnvironments(pool, {
      sandbox: {
        prepare: async () => {}, release: async () => {},
        list: async () => [{
          path: 'README.md', mediaType: 'text/plain; charset=utf-8',
          sizeBytes: Buffer.byteLength('sandbox bytes\n'),
          sha256: createHash('sha256').update('sandbox bytes\n').digest('hex'),
        }],
        open: async () => Buffer.from('sandbox bytes\n'),
      },
    });
    const request = {
      invocationId: workspaceInvocationId(randomUUID()),
      workspaceId: created.value.id,
      workingRootId: root.id,
      revisionId: root.currentRevisionId,
    };

    const first = await environments.prepare(owner.resolveRequest(), request);
    const replay = await environments.prepare(owner.resolveRequest(), request);

    expect(replay).toEqual(first);
    await expect(environments.prepare(owner.resolveRequest(), {
      ...request,
      revisionId: workspaceRevisionId(randomUUID()),
    })).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    expect(first).toMatchObject({
      invocationId: request.invocationId,
      workspaceId: request.workspaceId,
      workingRootId: request.workingRootId,
      revisionId: request.revisionId,
      status: 'prepared',
    });
    expect(JSON.stringify(first)).not.toMatch(/storage|path|root\//i);
    await expect(environments.listFiles(owner.resolveRequest(), request.invocationId, {
      limit: 20,
    })).resolves.toMatchObject({ items: [{ path: 'README.md' }] });
    await expect(environments.openFile(owner.resolveRequest(), request.invocationId, 'README.md'))
      .resolves.toMatchObject({ path: 'README.md', content: 'sandbox bytes\n' });
    await expect(environments.searchFiles(owner.resolveRequest(), request.invocationId, {
      query: 'bytes', limit: 20,
    })).resolves.toMatchObject({
      items: [{ path: 'README.md', line: 1, column: 9 }],
    });
    await expect(environments.listFiles(colleague.resolveRequest(), request.invocationId, {
      limit: 20,
    })).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(environments.get(colleague.resolveRequest(), request.invocationId))
      .rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(environments.get(owner.resolveRequest(), workspaceInvocationId(randomUUID())))
      .rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await environments.release(owner.resolveRequest(), request.invocationId);
    await environments.release(owner.resolveRequest(), request.invocationId);
    await expect(environments.listFiles(owner.resolveRequest(), request.invocationId, {
      limit: 20,
    })).rejects.toBeInstanceOf(WorkspaceRunEnvironmentUnavailableError);
  });

  it('reconciles the same durable preparation after a Worker loses the first attempt', async () => {
    const created = await new PostgresWorkspaceCatalog(pool).provisionEmpty(
      owner.resolveRequest(),
      {
        commandId: workspaceCommandId(randomUUID()),
        name: 'Recover environment',
        operationMode: 'observe',
      },
    );
    const root = created.value.defaultWorkingRoot;
    if (!root) throw new Error('Expected a default Working Root');
    const invocationId = workspaceInvocationId(randomUUID());
    let attempts = 0;
    const sandbox: WorkspaceSandboxAdapter = {
      async prepare() {
        attempts += 1;
        if (attempts === 1) throw new Error('simulated Worker loss');
      },
      async release() {},
      async list() { return []; },
      async open() { return Buffer.alloc(0); },
    };
    const request = {
      invocationId,
      workspaceId: created.value.id,
      workingRootId: root.id,
      revisionId: root.currentRevisionId,
    };

    await expect(new PostgresWorkspaceRunEnvironments(pool, { sandbox })
      .prepare(owner.resolveRequest(), request))
      .rejects.toBeInstanceOf(WorkspaceRunEnvironmentUnavailableError);
    await expect(new PostgresWorkspaceRunEnvironments(pool, { sandbox })
      .get(owner.resolveRequest(), invocationId))
      .resolves.toMatchObject({ status: 'preparing' });
    const recovered = await new PostgresWorkspaceRunEnvironments(pool, { sandbox })
      .prepare(owner.resolveRequest(), request);

    expect(recovered.status).toBe('prepared');
    expect(attempts).toBe(2);
  });
});
