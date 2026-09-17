import { randomUUID } from 'node:crypto';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import {
  GitWorkspaceProvisioningError,
  PostgresWorkspaceCatalog,
  PostgresWorkspaceProvisioningWorker,
  PostgresWorkspaceWorktreeWorker,
  PostgresWorkspaceWorkingRoots,
  WorkspaceIdempotencyConflictError,
  WorkspaceLifecycleConflictError,
  WorkspaceNotFoundError,
  workspaceCommandId,
  workspaceConnectorId,
  workspaceRepositoryId,
  type GitWorkspaceProvisioner,
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
  it('durably accepts and completes a Git provision exactly once through a recoverable Worker lease', async () => {
    const accepted = await new PostgresWorkspaceCatalog(pool).provisionGit(owner.resolveRequest(), {
      commandId: workspaceCommandId(randomUUID()),
      name: 'Worker provisioned Git',
      operationMode: 'observe',
      source: {
        connectorId: workspaceConnectorId(randomUUID()),
        repositoryId: workspaceRepositoryId(randomUUID()),
        defaultBranch: 'main',
      },
    });
    expect(accepted).toMatchObject({
      replayed: false,
      value: {
        name: 'Worker provisioned Git',
        lifecycleStatus: 'provisioning',
        defaultWorkingRoot: null,
        provisioningFailure: null,
      },
    });
    await expect(new PostgresWorkspaceCatalog(pool).get(
      owner.resolveRequest(), accepted.value.id,
    )).resolves.toEqual(accepted.value);

    const requests: unknown[] = [];
    const provisioner: GitWorkspaceProvisioner = {
      async provision(request) {
        requests.push(request);
        return {
          headCommit: '1111111111111111111111111111111111111111',
          contentManifestHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        };
      },
      async createWorktree(request) {
        requests.push(request);
        return {
          headCommit: '1111111111111111111111111111111111111111',
          contentManifestHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        };
      },
    };
    const worker = new PostgresWorkspaceProvisioningWorker(pool, provisioner, {
      workerId: 'workspace-test-worker',
      leaseTtlMs: 30_000,
    });

    await expect(worker.executeOne()).resolves.toBe(true);
    await expect(worker.executeOne()).resolves.toBe(false);
    expect(requests).toHaveLength(1);
    await expect(new PostgresWorkspaceCatalog(pool).get(
      owner.resolveRequest(), accepted.value.id,
    )).resolves.toMatchObject({
      id: accepted.value.id,
      lifecycleStatus: 'ready',
      defaultWorkingRoot: { kind: 'git_worktree' },
      provisioningFailure: null,
    });
    const workingRoots = new PostgresWorkspaceWorkingRoots(pool);
    await expect(workingRoots.listWorktrees(
      owner.resolveRequest(), accepted.value.id, { limit: 20 },
    )).resolves.toMatchObject({
      items: [{
        workspaceId: accepted.value.id,
        branchName: 'main',
        lifecycleStatus: 'ready',
        isDefault: true,
      }],
    });
    const commandId = workspaceCommandId(randomUUID());
    const worktreeOperation = await workingRoots.createWorktree(
      owner.resolveRequest(), accepted.value.id,
      { commandId, branchName: 'feature/private-work' },
    );
    expect(worktreeOperation).toMatchObject({
      replayed: false,
      value: {
        workspaceId: accepted.value.id,
        branchName: 'feature/private-work',
        status: 'pending',
      },
    });
    await expect(new PostgresWorkspaceWorkingRoots(pool).createWorktree(
      owner.resolveRequest(), accepted.value.id,
      { commandId, branchName: 'feature/private-work' },
    )).resolves.toEqual({ ...worktreeOperation, replayed: true });
    await expect(new PostgresWorkspaceWorkingRoots(pool).createWorktree(
      owner.resolveRequest(), accepted.value.id,
      { commandId, branchName: 'feature/changed-request' },
    )).rejects.toBeInstanceOf(WorkspaceIdempotencyConflictError);

    await expect(workingRoots.getWorktreeOperationByCommand(
      colleague.resolveRequest(), accepted.value.id, commandId,
    )).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await pool.query(
      `UPDATE workspace_operations
          SET status = 'running', lease_owner = 'lost-worktree-worker',
              lease_expires_at = now() - interval '1 second'
        WHERE organization_id = $1 AND id = $2 AND operation_type = 'create_worktree'`,
      [organization, worktreeOperation.value.id],
    );
    const worktreeWorker = new PostgresWorkspaceWorktreeWorker(pool, provisioner, {
      workerId: 'worktree-test-worker',
      leaseTtlMs: 30_000,
    });
    await expect(worktreeWorker.executeOne()).resolves.toBe(true);
    await expect(worktreeWorker.executeOne()).resolves.toBe(false);
    const completedRoots = new PostgresWorkspaceWorkingRoots(pool);
    const worktrees = await completedRoots.listWorktrees(
      owner.resolveRequest(), accepted.value.id, { limit: 20 },
    );
    expect(worktrees).toMatchObject({
      items: [
        { branchName: 'main', isDefault: true },
        { branchName: 'feature/private-work', isDefault: false },
      ],
    });
    const firstWorktreePage = await completedRoots.listWorktrees(
      owner.resolveRequest(), accepted.value.id, { limit: 1 },
    );
    expect(firstWorktreePage.items).toMatchObject([{ branchName: 'main', isDefault: true }]);
    expect(firstWorktreePage.nextCursor).toBeTypeOf('string');
    if (!firstWorktreePage.nextCursor) throw new Error('Expected another Worktree page');
    await expect(completedRoots.listWorktrees(
      owner.resolveRequest(), accepted.value.id,
      { limit: 1, cursor: firstWorktreePage.nextCursor },
    )).resolves.toMatchObject({
      items: [{ branchName: 'feature/private-work', isDefault: false }],
    });

    const feature = worktrees.items.find((worktree) => !worktree.isDefault);
    if (!feature) throw new Error('Expected the isolated Worktree');
    const archiveCommand = workspaceCommandId(randomUUID());
    await expect(completedRoots.archiveWorktree(
      owner.resolveRequest(), accepted.value.id, feature.id,
      { commandId: archiveCommand },
    )).resolves.toMatchObject({
      replayed: false,
      value: { id: feature.id, lifecycleStatus: 'archived' },
    });
    await expect(new PostgresWorkspaceWorkingRoots(pool).archiveWorktree(
      owner.resolveRequest(), accepted.value.id, feature.id,
      { commandId: archiveCommand },
    )).resolves.toMatchObject({
      replayed: true,
      value: { id: feature.id, lifecycleStatus: 'archived' },
    });
    await expect(completedRoots.archiveWorktree(
      colleague.resolveRequest(), accepted.value.id, feature.id,
      { commandId: workspaceCommandId(randomUUID()) },
    )).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('records safe provisioning failure and recovers an expired Worker lease after restart', async () => {
    const source = {
      connectorId: workspaceConnectorId(randomUUID()),
      repositoryId: workspaceRepositoryId(randomUUID()),
      defaultBranch: 'main',
    };
    const failed = await new PostgresWorkspaceCatalog(pool).provisionGit(owner.resolveRequest(), {
      commandId: workspaceCommandId(randomUUID()),
      name: 'Failed Git provision',
      operationMode: 'observe',
      source,
    });
    const failingProvisioner: GitWorkspaceProvisioner = {
      async provision() {
        throw new GitWorkspaceProvisioningError('top-secret-credential-value', false);
      },
      async createWorktree() {
        throw new Error('Not used');
      },
    };
    await new PostgresWorkspaceProvisioningWorker(pool, failingProvisioner, {
      workerId: 'failed-provision-worker', leaseTtlMs: 30_000,
    }).executeOne();
    const failedCatalog = new PostgresWorkspaceCatalog(pool);
    await expect(failedCatalog.get(
      owner.resolveRequest(), failed.value.id,
    )).resolves.toMatchObject({
      lifecycleStatus: 'failed',
      defaultWorkingRoot: null,
      provisioningFailure: { code: 'git_provision_failed', retryable: true },
    });
    await expect(failedCatalog.transitionLifecycle(
      owner.resolveRequest(), failed.value.id,
      { commandId: workspaceCommandId(randomUUID()), targetStatus: 'ready' },
    )).rejects.toBeInstanceOf(WorkspaceLifecycleConflictError);

    const recoverable = await new PostgresWorkspaceCatalog(pool).provisionGit(
      owner.resolveRequest(), {
        commandId: workspaceCommandId(randomUUID()),
        name: 'Restarted Git provision',
        operationMode: 'observe',
        source,
      },
    );
    await pool.query(
      `UPDATE workspace_operations
          SET status = 'running', lease_owner = 'lost-worker',
              lease_expires_at = now() - interval '1 second'
        WHERE organization_id = $1 AND workspace_id = $2 AND operation_type = 'provision_git'`,
      [organization, recoverable.value.id],
    );
    const succeedingProvisioner: GitWorkspaceProvisioner = {
      async provision() {
        return {
          headCommit: '2222222222222222222222222222222222222222',
          contentManifestHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        };
      },
      async createWorktree() { throw new Error('Not used'); },
    };
    await expect(new PostgresWorkspaceProvisioningWorker(pool, succeedingProvisioner, {
      workerId: 'restarted-provision-worker', leaseTtlMs: 30_000,
    }).executeOne()).resolves.toBe(true);
    await expect(new PostgresWorkspaceCatalog(pool).get(
      owner.resolveRequest(), recoverable.value.id,
    )).resolves.toMatchObject({ lifecycleStatus: 'ready', provisioningFailure: null });
  });

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
