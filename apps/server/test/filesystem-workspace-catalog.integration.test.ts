import { randomUUID } from 'node:crypto';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import {
  PostgresWorkspaceCatalog,
  WorkspaceIdempotencyConflictError,
  WorkspaceNotFoundError,
  workspaceCommandId,
} from '@cmaster/workspaces';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });
const organization = organizationId(randomUUID());
const owner = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Filesystem Workspace test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Owner',
});
const colleague = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Filesystem Workspace test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Colleague',
});

beforeAll(async () => {
  await owner.provision();
  await colleague.provision();
});
afterAll(async () => pool.end());

describe('PostgreSQL WorkspaceCatalog', () => {
  it('reopens an empty Workspace through a new adapter without exposing it to a colleague', async () => {
    const created = await new PostgresWorkspaceCatalog(pool).provisionEmpty(owner.resolveRequest(), {
      commandId: workspaceCommandId(randomUUID()),
      name: 'Quarterly planning',
      operationMode: 'edit_with_confirmation',
    });

    const reopened = new PostgresWorkspaceCatalog(pool);
    await expect(reopened.get(owner.resolveRequest(), created.value.id))
      .resolves.toEqual(created.value);
    await expect(reopened.get(colleague.resolveRequest(), created.value.id))
      .rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(reopened.get(owner.resolveRequest(), randomUUID() as typeof created.value.id))
      .rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('persists provision Command replay and rejects a changed request', async () => {
    const commandId = workspaceCommandId(randomUUID());
    const command = {
      commandId,
      name: 'Release planning',
      operationMode: 'observe' as const,
    };
    const created = await new PostgresWorkspaceCatalog(pool)
      .provisionEmpty(owner.resolveRequest(), command);
    const replayed = await new PostgresWorkspaceCatalog(pool)
      .provisionEmpty(owner.resolveRequest(), command);

    expect(replayed).toEqual({ value: created.value, replayed: true });
    await expect(new PostgresWorkspaceCatalog(pool).provisionEmpty(owner.resolveRequest(), {
      ...command,
      name: 'Different request',
    })).rejects.toBeInstanceOf(WorkspaceIdempotencyConflictError);
  });

  it('archives, restores, and reconciles lifecycle Commands to current state', async () => {
    const catalog = new PostgresWorkspaceCatalog(pool);
    const created = await catalog.provisionEmpty(owner.resolveRequest(), {
      commandId: workspaceCommandId(randomUUID()),
      name: 'Lifecycle test',
      operationMode: 'edit_with_confirmation',
    });
    const archiveCommandId = workspaceCommandId(randomUUID());
    const archived = await catalog.transitionLifecycle(owner.resolveRequest(), created.value.id, {
      commandId: archiveCommandId,
      targetStatus: 'archived',
    });
    await catalog.transitionLifecycle(owner.resolveRequest(), created.value.id, {
      commandId: workspaceCommandId(randomUUID()),
      targetStatus: 'ready',
    });
    const another = await catalog.provisionEmpty(owner.resolveRequest(), {
      commandId: workspaceCommandId(randomUUID()),
      name: 'Another lifecycle target',
      operationMode: 'observe',
    });

    await expect(catalog.transitionLifecycle(owner.resolveRequest(), another.value.id, {
      commandId: archiveCommandId,
      targetStatus: 'archived',
    })).rejects.toBeInstanceOf(WorkspaceIdempotencyConflictError);
    await expect(new PostgresWorkspaceCatalog(pool).getLifecycleByCommand(
      owner.resolveRequest(), created.value.id, archiveCommandId,
    )).resolves.toMatchObject({ id: archived.value.id, lifecycleStatus: 'ready' });
    await expect(catalog.transitionLifecycle(colleague.resolveRequest(), created.value.id, {
      commandId: workspaceCommandId(randomUUID()),
      targetStatus: 'archived',
    })).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(catalog.get(owner.resolveRequest(), created.value.id))
      .resolves.toMatchObject({ lifecycleStatus: 'ready' });
  });

  it('pages only the owner’s Workspaces with a stable opaque cursor', async () => {
    const listOwner = new PostgresDevelopmentIdentity(pool, {
      organizationId: organization,
      organizationName: 'Filesystem Workspace test',
      principalId: principalId(randomUUID()),
      principalDisplayName: 'List owner',
    });
    await listOwner.provision();
    const catalog = new PostgresWorkspaceCatalog(pool);
    const first = await catalog.provisionEmpty(listOwner.resolveRequest(), {
      commandId: workspaceCommandId(randomUUID()), name: 'First', operationMode: 'observe',
    });
    const second = await catalog.provisionEmpty(listOwner.resolveRequest(), {
      commandId: workspaceCommandId(randomUUID()), name: 'Second', operationMode: 'observe',
    });
    await catalog.provisionEmpty(colleague.resolveRequest(), {
      commandId: workspaceCommandId(randomUUID()), name: 'Colleague only', operationMode: 'observe',
    });

    const latest = await new PostgresWorkspaceCatalog(pool)
      .list(listOwner.resolveRequest(), { limit: 1 });
    expect(latest.items).toEqual([second.value]);
    if (!latest.nextCursor) throw new Error('Expected another owner Workspace page');
    expect(latest.nextCursor).not.toContain(second.value.id);
    await expect(new PostgresWorkspaceCatalog(pool).list(listOwner.resolveRequest(), {
      limit: 1,
      cursor: latest.nextCursor,
    })).resolves.toEqual({ items: [first.value] });
  });
});
