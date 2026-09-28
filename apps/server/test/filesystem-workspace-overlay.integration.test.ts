import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { organizationId, PostgresDevelopmentIdentity, principalId } from '@cmaster/identity';
import {
  createConfiguredWorkspaceChangeContentStore,
  createConfiguredWorkspaceRevisionContentReader,
  createConfiguredWorkspaceRevisionSnapshotStore,
  createConfiguredWorkspaceSandboxAdapter,
  PostgresWorkspaceCatalog,
  PostgresWorkspaceChanges,
  PostgresWorkspaceRunEnvironments,
  PostgresWorkspaceWorkingRoots,
  WorkspaceIdempotencyConflictError,
  WorkspaceNotFoundError,
  WorkspaceOperationModeDeniedError,
  workspaceChangeCommandId,
  workspaceCommandId,
  workspaceInvocationId,
  workspaceOverlayCommandId,
} from '@cmaster/workspaces';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });
const organization = organizationId(randomUUID());
const owner = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Workspace overlay test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Overlay owner',
});
const colleague = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Workspace overlay test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Overlay colleague',
});
let storageRoot: string;

beforeAll(async () => {
  await owner.provision();
  await colleague.provision();
  storageRoot = await mkdtemp(join(tmpdir(), 'cmaster-overlay-'));
});

afterAll(async () => {
  await pool.end();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});

describe('Invocation-private Workspace overlays', () => {
  it('recovers writes on another Worker and proposes one exact whole-set diff', async () => {
    const workspace = (await new PostgresWorkspaceCatalog(pool).provisionEmpty(
      owner.resolveRequest(), {
        commandId: workspaceCommandId(randomUUID()),
        name: 'Overlay edits',
        operationMode: 'edit_with_confirmation',
      },
    )).value;
    const root = workspace.defaultWorkingRoot;
    if (!root) throw new Error('Expected a default Working Root');
    const revisionContent = createConfiguredWorkspaceRevisionContentReader({ storageRoot });
    const snapshotStore = createConfiguredWorkspaceRevisionSnapshotStore({ storageRoot });
    const contentStore = createConfiguredWorkspaceChangeContentStore({ storageRoot });
    const changes = new PostgresWorkspaceChanges(pool, {
      contentStore, revisionContent, snapshotStore,
    });

    const setupInvocation = workspaceInvocationId(randomUUID());
    const setupEnvironments = new PostgresWorkspaceRunEnvironments(pool, {
      sandbox: createConfiguredWorkspaceSandboxAdapter({ storageRoot, revisionContent }),
    });
    await setupEnvironments.prepare(owner.resolveRequest(), {
      invocationId: setupInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: root.currentRevisionId,
    });
    const baseline = await changes.propose(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      invocationId: setupInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      baseRevisionId: root.currentRevisionId,
      entries: [
        { kind: 'add', path: 'modify.txt', mediaType: 'text/plain; charset=utf-8',
          content: Buffer.from('before\n') },
        { kind: 'add', path: 'delete.txt', mediaType: 'text/plain; charset=utf-8',
          content: Buffer.from('remove\n') },
        { kind: 'add', path: 'unchanged.txt', mediaType: 'text/plain; charset=utf-8',
          content: Buffer.from('same\n') },
      ],
    });
    const baselineApplied = await changes.apply(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      changeSetId: baseline.value.id,
    });
    await setupEnvironments.release(owner.resolveRequest(), setupInvocation);
    const baseRevisionId = baselineApplied.value.resultingRevisionId!;

    const invocationId = workspaceInvocationId(randomUUID());
    const firstWorker = new PostgresWorkspaceRunEnvironments(pool, {
      sandbox: createConfiguredWorkspaceSandboxAdapter({ storageRoot, revisionContent }),
      changes,
    });
    await firstWorker.prepare(owner.resolveRequest(), {
      invocationId,
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: baseRevisionId,
    });
    await expect(firstWorker.listOverlay(colleague.resolveRequest(), invocationId))
      .rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(firstWorker.writeFile(colleague.resolveRequest(), invocationId, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      path: 'private.txt', content: 'private\n',
    })).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(firstWorker.proposeChanges(colleague.resolveRequest(), invocationId, {
      commandId: workspaceChangeCommandId(randomUUID()),
    })).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await pool.query(
      `UPDATE workspaces SET operation_mode = 'observe'
       WHERE organization_id = $1 AND id = $2`,
      [organization, workspace.id],
    );
    await expect(firstWorker.writeFile(owner.resolveRequest(), invocationId, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      path: 'reduced.txt', content: 'denied\n',
    })).rejects.toBeInstanceOf(WorkspaceOperationModeDeniedError);
    await pool.query(
      `UPDATE workspaces SET operation_mode = 'edit_with_confirmation'
       WHERE organization_id = $1 AND id = $2`,
      [organization, workspace.id],
    );
    const writeCommand = workspaceOverlayCommandId(randomUUID());
    const firstWrite = await firstWorker.writeFile(owner.resolveRequest(), invocationId, {
      commandId: writeCommand,
      path: 'modify.txt',
      content: 'after\n',
    });
    const replay = await firstWorker.writeFile(owner.resolveRequest(), invocationId, {
      commandId: writeCommand,
      path: 'modify.txt',
      content: 'after\n',
    });
    expect(replay).toEqual({ ...firstWrite, replayed: true });
    await expect(firstWorker.writeFile(owner.resolveRequest(), invocationId, {
      commandId: writeCommand,
      path: 'modify.txt',
      content: 'conflict\n',
    })).rejects.toBeInstanceOf(WorkspaceIdempotencyConflictError);
    await firstWorker.writeFile(owner.resolveRequest(), invocationId, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      path: 'added.md',
      content: '# Added\n',
    });
    await firstWorker.deleteFile(owner.resolveRequest(), invocationId, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      path: 'delete.txt',
    });
    await firstWorker.writeFile(owner.resolveRequest(), invocationId, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      path: 'unchanged.txt',
      content: 'same\n',
    });
    await firstWorker.writeFile(owner.resolveRequest(), invocationId, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      path: 'net-zero.txt',
      content: 'temporary\n',
    });
    await firstWorker.deleteFile(owner.resolveRequest(), invocationId, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      path: 'net-zero.txt',
    });

    const restartedWorker = new PostgresWorkspaceRunEnvironments(pool, {
      sandbox: createConfiguredWorkspaceSandboxAdapter({ storageRoot, revisionContent }),
      changes,
    });
    await expect(restartedWorker.listOverlay(owner.resolveRequest(), invocationId))
      .resolves.toMatchObject({
        items: [
          { kind: 'write', path: 'added.md' },
          { kind: 'delete', path: 'delete.txt' },
          { kind: 'write', path: 'modify.txt' },
          { kind: 'write', path: 'unchanged.txt' },
        ],
      });
    const proposalCommand = workspaceChangeCommandId(randomUUID());
    const proposed = await restartedWorker.proposeChanges(owner.resolveRequest(), invocationId, {
      commandId: proposalCommand,
    });
    const proposalReplay = await restartedWorker.proposeChanges(
      owner.resolveRequest(), invocationId, { commandId: proposalCommand },
    );
    expect(proposalReplay).toEqual({ ...proposed, replayed: true });
    expect(proposed.value.entries).toMatchObject([
      { kind: 'add', path: 'added.md' },
      { kind: 'delete', path: 'delete.txt' },
      { kind: 'modify', path: 'modify.txt' },
    ]);
    await restartedWorker.writeFile(owner.resolveRequest(), invocationId, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      path: 'after-proposal.txt',
      content: 'later\n',
    });
    await expect(restartedWorker.proposeChanges(owner.resolveRequest(), invocationId, {
      commandId: proposalCommand,
    })).rejects.toBeInstanceOf(WorkspaceIdempotencyConflictError);

    const files = new PostgresWorkspaceWorkingRoots(pool, { revisionContent });
    await expect(files.openFile(owner.resolveRequest(), {
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: baseRevisionId,
      path: 'modify.txt',
    })).resolves.toMatchObject({ content: 'before\n' });
    const current = await new PostgresWorkspaceCatalog(pool).get(owner.resolveRequest(), workspace.id);
    expect(current.defaultWorkingRoot?.currentRevisionId).toBe(baseRevisionId);
    expect(JSON.stringify(await restartedWorker.listOverlay(owner.resolveRequest(), invocationId)))
      .not.toMatch(/run-environments|storageRoot|before\\n|remove\\n/i);
    await restartedWorker.release(owner.resolveRequest(), invocationId);
  });

  it('denies overlay mutation when the environment captured Observe mode', async () => {
    const workspace = (await new PostgresWorkspaceCatalog(pool).provisionEmpty(
      owner.resolveRequest(), {
        commandId: workspaceCommandId(randomUUID()),
        name: 'Observe overlay',
        operationMode: 'observe',
      },
    )).value;
    const root = workspace.defaultWorkingRoot;
    if (!root) throw new Error('Expected a default Working Root');
    const revisionContent = createConfiguredWorkspaceRevisionContentReader({ storageRoot });
    const environments = new PostgresWorkspaceRunEnvironments(pool, {
      sandbox: createConfiguredWorkspaceSandboxAdapter({ storageRoot, revisionContent }),
    });
    const invocationId = workspaceInvocationId(randomUUID());
    await environments.prepare(owner.resolveRequest(), {
      invocationId,
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: root.currentRevisionId,
    });
    await pool.query(
      `UPDATE workspaces SET operation_mode = 'edit_with_confirmation'
       WHERE organization_id = $1 AND id = $2`,
      [organization, workspace.id],
    );
    await expect(environments.writeFile(owner.resolveRequest(), invocationId, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      path: 'denied.txt',
      content: 'denied\n',
    })).rejects.toBeInstanceOf(WorkspaceOperationModeDeniedError);
    await environments.release(owner.resolveRequest(), invocationId);
  });
});
