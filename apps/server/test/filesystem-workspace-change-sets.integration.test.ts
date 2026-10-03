import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import {
  createConfiguredGitWorkspaceProvisioner,
  createConfiguredWorkspaceChangeContentStore,
  createConfiguredWorkspaceGitSnapshotAdapter,
  createConfiguredWorkspaceRevisionContentReader,
  createConfiguredWorkspaceRevisionSnapshotStore,
  createConfiguredWorkspaceSandboxAdapter,
  PostgresWorkspaceCatalog,
  PostgresWorkspaceChanges,
  PostgresWorkspaceProvisioningWorker,
  PostgresWorkspaceRunEnvironments,
  PostgresWorkspaceWorkingRoots,
  InvalidWorkspaceChangeSetError,
  WorkspaceChangeConflictError,
  WorkspaceChangeSetUnavailableError,
  WorkspaceIdempotencyConflictError,
  WorkspaceNotFoundError,
  WorkspaceOperationModeDeniedError,
  workspaceChangeCommandId,
  workspaceCommandId,
  workspaceConnectorId,
  workspaceInvocationId,
  workspaceRepositoryId,
} from '@cmaster/workspaces';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const run = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });
const organization = organizationId(randomUUID());
const owner = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Workspace Change Set test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Change Set owner',
});
const colleague = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Workspace Change Set test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Colleague',
});
let storageRoot: string;

beforeAll(async () => {
  await owner.provision();
  await colleague.provision();
  storageRoot = await mkdtemp(join(tmpdir(), 'cmaster-change-sets-'));
});

afterAll(async () => {
  await pool.end();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});

describe('PostgreSQL Workspace Change Sets', () => {
  it('proposes one immutable whole-set diff idempotently without changing shared files', async () => {
    const workspace = (await new PostgresWorkspaceCatalog(pool).provisionEmpty(
      owner.resolveRequest(),
      {
        commandId: workspaceCommandId(randomUUID()),
        name: 'Immutable proposal',
        operationMode: 'edit_with_confirmation',
      },
    )).value;
    const root = workspace.defaultWorkingRoot;
    if (!root) throw new Error('Expected a default Working Root');
    const revisionContent = createConfiguredWorkspaceRevisionContentReader({ storageRoot });
    const invocationId = workspaceInvocationId(randomUUID());
    const environments = new PostgresWorkspaceRunEnvironments(pool, {
      sandbox: createConfiguredWorkspaceSandboxAdapter({ storageRoot, revisionContent }),
    });
    await environments.prepare(owner.resolveRequest(), {
      invocationId,
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: root.currentRevisionId,
    });
    const snapshotStore = createConfiguredWorkspaceRevisionSnapshotStore({ storageRoot });
    const changeContentStore = createConfiguredWorkspaceChangeContentStore({ storageRoot });
    const changes = new PostgresWorkspaceChanges(pool, {
      contentStore: changeContentStore,
      revisionContent,
      snapshotStore,
    });
    await expect(changes.propose(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      invocationId,
      workspaceId: workspace.id,
      workingRootId: root.id,
      baseRevisionId: root.currentRevisionId,
      entries: [{ kind: 'add', path: '../escape.txt',
        mediaType: 'text/plain; charset=utf-8', content: Buffer.from('escape') }],
    })).rejects.toBeInstanceOf(InvalidWorkspaceChangeSetError);
    await expect(changes.propose(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      invocationId,
      workspaceId: workspace.id,
      workingRootId: root.id,
      baseRevisionId: root.currentRevisionId,
      entries: [{ kind: 'add', path: 'binary.txt',
        mediaType: 'text/plain; charset=utf-8', content: Buffer.from([0xff]) }],
    })).rejects.toBeInstanceOf(InvalidWorkspaceChangeSetError);
    await expect(changes.propose(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      invocationId,
      workspaceId: workspace.id,
      workingRootId: root.id,
      baseRevisionId: root.currentRevisionId,
      entries: [{ kind: 'add', path: 'oversized.txt',
        mediaType: 'text/plain; charset=utf-8', content: Buffer.alloc(1_048_577, 97) }],
    })).rejects.toBeInstanceOf(InvalidWorkspaceChangeSetError);

    const commandId = workspaceChangeCommandId(randomUUID());
    const request = {
      commandId,
      invocationId,
      workspaceId: workspace.id,
      workingRootId: root.id,
      baseRevisionId: root.currentRevisionId,
      entries: [{
        kind: 'add' as const,
        path: 'src/new.ts',
        mediaType: 'text/plain; charset=utf-8',
        content: Buffer.from('export const added = true;\n'),
      }],
    };

    const first = await changes.propose(owner.resolveRequest(), request);
    const replay = await changes.propose(owner.resolveRequest(), request);

    expect(replay).toEqual({ ...first, replayed: true });
    expect(first).toMatchObject({
      replayed: false,
      value: {
        workspaceId: workspace.id,
        workingRootId: root.id,
        baseRevisionId: root.currentRevisionId,
        invocationId: request.invocationId,
        status: 'proposed',
        entries: [{ kind: 'add', path: 'src/new.ts' }],
      },
    });
    expect(JSON.stringify(first)).not.toMatch(/storageRoot|export const|cmaster-change-sets/i);
    await expect(changes.getApplyAuthority(
      owner.resolveRequest(), invocationId, first.value.id,
    )).resolves.toEqual({
      changeSetId: first.value.id,
      invocationId,
      currentOperationMode: 'edit_with_confirmation',
      maximumOperationMode: 'edit_with_confirmation',
    });
    await expect(changes.getApplyAuthority(
      owner.resolveRequest(), workspaceInvocationId(randomUUID()), first.value.id,
    )).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(changes.getApplyAuthority(
      colleague.resolveRequest(), invocationId, first.value.id,
    )).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await pool.query(
      `UPDATE workspaces SET operation_mode = 'observe'
       WHERE organization_id = $1 AND id = $2`,
      [organization, workspace.id],
    );
    await expect(changes.getApplyAuthority(
      owner.resolveRequest(), invocationId, first.value.id,
    )).resolves.toMatchObject({
      currentOperationMode: 'observe',
      maximumOperationMode: 'edit_with_confirmation',
    });
    await expect(changes.apply(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      changeSetId: first.value.id,
    })).rejects.toBeInstanceOf(WorkspaceOperationModeDeniedError);
    await pool.query(
      `UPDATE workspaces SET operation_mode = 'edit_with_confirmation'
       WHERE organization_id = $1 AND id = $2`,
      [organization, workspace.id],
    );
    await expect(changes.get(colleague.resolveRequest(), first.value.id))
      .rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(changes.propose(colleague.resolveRequest(), {
      ...request,
      commandId: workspaceChangeCommandId(randomUUID()),
    })).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(changes.list(owner.resolveRequest(), {
      workspaceId: workspace.id, workingRootId: root.id,
    }, { limit: 1 })).resolves.toMatchObject({ items: [{ id: first.value.id }] });
    await expect(changes.list(colleague.resolveRequest(), {
      workspaceId: workspace.id, workingRootId: root.id,
    })).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(changes.propose(owner.resolveRequest(), {
      ...request,
      entries: [{ kind: 'delete' as const, path: 'src/new.ts' }],
    })).rejects.toBeInstanceOf(WorkspaceIdempotencyConflictError);

    const files = new PostgresWorkspaceWorkingRoots(pool, { revisionContent });
    await expect(files.listFiles(owner.resolveRequest(), {
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: root.currentRevisionId,
    }, { limit: 20 })).resolves.toEqual({ items: [] });

    const parallelInvocation = workspaceInvocationId(randomUUID());
    await environments.prepare(owner.resolveRequest(), {
      invocationId: parallelInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: root.currentRevisionId,
    });
    const parallel = await changes.propose(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      invocationId: parallelInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      baseRevisionId: root.currentRevisionId,
      entries: [{ kind: 'add', path: 'docs/parallel.md',
        mediaType: 'text/markdown; charset=utf-8', content: Buffer.from('# Parallel\n') }],
    });

    const applyCommandId = workspaceChangeCommandId(randomUUID());
    let failMaterialization = true;
    const interruptedChanges = new PostgresWorkspaceChanges(pool, {
      contentStore: changeContentStore,
      revisionContent,
      snapshotStore: {
        async put(scope, entries) {
          if (failMaterialization) {
            failMaterialization = false;
            throw new Error('simulated process loss');
          }
          return snapshotStore.put(scope, entries);
        },
        async apply(current, result, entries) {
          return snapshotStore.apply(current, result, entries);
        },
      },
    });
    await expect(interruptedChanges.apply(owner.resolveRequest(), {
      commandId: applyCommandId,
      changeSetId: first.value.id,
    })).rejects.toThrow('simulated process loss');
    const applied = await changes.apply(owner.resolveRequest(), {
      commandId: applyCommandId,
      changeSetId: first.value.id,
    });
    expect(applied.replayed).toBe(true);
    const appliedReplay = await changes.apply(owner.resolveRequest(), {
      commandId: applyCommandId,
      changeSetId: first.value.id,
    });
    expect(appliedReplay).toEqual({ ...applied, replayed: true });
    expect(applied.value.status).toBe('applied');
    expect(applied.value.resultingRevisionId).toBeDefined();
    expect(applied.value.resultingRevisionId).not.toBe(root.currentRevisionId);
    await expect(files.listFiles(owner.resolveRequest(), {
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: root.currentRevisionId,
    }, { limit: 20 })).resolves.toEqual({ items: [] });
    const restartedFiles = new PostgresWorkspaceWorkingRoots(pool, {
      revisionContent: createConfiguredWorkspaceRevisionContentReader({ storageRoot }),
    });
    await expect(restartedFiles.openFile(owner.resolveRequest(), {
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: applied.value.resultingRevisionId!,
      path: 'src/new.ts',
    })).resolves.toMatchObject({
      path: 'src/new.ts',
      content: 'export const added = true;\n',
    });
    const parallelApplied = await changes.apply(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      changeSetId: parallel.value.id,
    });
    const mergedRevision = parallelApplied.value.resultingRevisionId!;
    await expect(restartedFiles.openFile(owner.resolveRequest(), {
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: mergedRevision,
      path: 'src/new.ts',
    })).resolves.toMatchObject({ content: 'export const added = true;\n' });
    await expect(restartedFiles.openFile(owner.resolveRequest(), {
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: mergedRevision,
      path: 'docs/parallel.md',
    })).resolves.toMatchObject({ content: '# Parallel\n' });

    const conflictInvocations = [workspaceInvocationId(randomUUID()), workspaceInvocationId(randomUUID())];
    const conflicting = [];
    for (const [index, conflictingInvocation] of conflictInvocations.entries()) {
      await environments.prepare(owner.resolveRequest(), {
        invocationId: conflictingInvocation,
        workspaceId: workspace.id,
        workingRootId: root.id,
        revisionId: mergedRevision,
      });
      conflicting.push(await changes.propose(owner.resolveRequest(), {
        commandId: workspaceChangeCommandId(randomUUID()),
        invocationId: conflictingInvocation,
        workspaceId: workspace.id,
        workingRootId: root.id,
        baseRevisionId: mergedRevision,
        entries: [{ kind: 'modify', path: 'src/new.ts',
          mediaType: 'text/plain; charset=utf-8',
          content: Buffer.from(`export const version = ${index};\n`) }],
      }));
    }
    await changes.apply(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      changeSetId: conflicting[0]!.value.id,
    });
    await expect(changes.apply(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      changeSetId: conflicting[1]!.value.id,
    })).rejects.toBeInstanceOf(WorkspaceChangeConflictError);

    const releasedInvocation = workspaceInvocationId(randomUUID());
    const currentWorkspace = await new PostgresWorkspaceCatalog(pool).get(
      owner.resolveRequest(), workspace.id,
    );
    const currentRoot = currentWorkspace.defaultWorkingRoot;
    if (!currentRoot) throw new Error('Expected the current Working Root');
    await environments.prepare(owner.resolveRequest(), {
      invocationId: releasedInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: currentRoot.currentRevisionId,
    });
    const releasedProposal = await changes.propose(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      invocationId: releasedInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      baseRevisionId: currentRoot.currentRevisionId,
      entries: [{ kind: 'add', path: 'released.txt',
        mediaType: 'text/plain; charset=utf-8', content: Buffer.from('released\n') }],
    });
    await environments.release(owner.resolveRequest(), releasedInvocation);
    await expect(changes.getApplyAuthority(
      owner.resolveRequest(), releasedInvocation, releasedProposal.value.id,
    )).rejects.toBeInstanceOf(WorkspaceChangeSetUnavailableError);
    await expect(changes.apply(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      changeSetId: releasedProposal.value.id,
    })).rejects.toBeInstanceOf(WorkspaceChangeSetUnavailableError);

    const archivedInvocation = workspaceInvocationId(randomUUID());
    await environments.prepare(owner.resolveRequest(), {
      invocationId: archivedInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: currentRoot.currentRevisionId,
    });
    const archivedProposal = await changes.propose(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      invocationId: archivedInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      baseRevisionId: currentRoot.currentRevisionId,
      entries: [{ kind: 'add', path: 'archived.txt',
        mediaType: 'text/plain; charset=utf-8', content: Buffer.from('archived\n') }],
    });
    await pool.query(
      `UPDATE workspaces SET lifecycle_status = 'archived'
       WHERE organization_id = $1 AND id = $2`,
      [organization, workspace.id],
    );
    await expect(changes.getApplyAuthority(
      owner.resolveRequest(), archivedInvocation, archivedProposal.value.id,
    )).rejects.toBeInstanceOf(WorkspaceChangeSetUnavailableError);
    await expect(changes.apply(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      changeSetId: archivedProposal.value.id,
    })).rejects.toBeInstanceOf(WorkspaceChangeSetUnavailableError);
    await pool.query(
      `UPDATE workspaces SET lifecycle_status = 'ready'
       WHERE organization_id = $1 AND id = $2`,
      [organization, workspace.id],
    );
    await environments.release(owner.resolveRequest(), archivedInvocation);

    await environments.release(owner.resolveRequest(), invocationId);
    await environments.release(owner.resolveRequest(), parallelInvocation);
    for (const conflictingInvocation of conflictInvocations) {
      await environments.release(owner.resolveRequest(), conflictingInvocation);
    }
  });

  it('rejects Change Set proposal in Observe mode', async () => {
    const workspace = (await new PostgresWorkspaceCatalog(pool).provisionEmpty(
      owner.resolveRequest(), {
        commandId: workspaceCommandId(randomUUID()),
        name: 'Observe only',
        operationMode: 'observe',
      },
    )).value;
    const root = workspace.defaultWorkingRoot;
    if (!root) throw new Error('Expected a default Working Root');
    const revisionContent = createConfiguredWorkspaceRevisionContentReader({ storageRoot });
    const invocationId = workspaceInvocationId(randomUUID());
    const environments = new PostgresWorkspaceRunEnvironments(pool, {
      sandbox: createConfiguredWorkspaceSandboxAdapter({ storageRoot, revisionContent }),
    });
    await environments.prepare(owner.resolveRequest(), {
      invocationId,
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: root.currentRevisionId,
    });
    const changes = new PostgresWorkspaceChanges(pool, {
      contentStore: createConfiguredWorkspaceChangeContentStore({ storageRoot }),
      revisionContent,
      snapshotStore: createConfiguredWorkspaceRevisionSnapshotStore({ storageRoot }),
    });
    await expect(changes.propose(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      invocationId,
      workspaceId: workspace.id,
      workingRootId: root.id,
      baseRevisionId: root.currentRevisionId,
      entries: [{ kind: 'add', path: 'denied.txt',
        mediaType: 'text/plain; charset=utf-8', content: Buffer.from('denied\n') }],
    })).rejects.toBeInstanceOf(WorkspaceOperationModeDeniedError);
    await environments.release(owner.resolveRequest(), invocationId);
  });

  it('applies a Git-backed snapshot without moving its branch or dropping ignored bytes', async () => {
    const fixture = join(storageRoot, `git-fixture-${randomUUID()}`);
    const remote = join(fixture, 'trusted.git');
    const checkout = join(fixture, 'checkout');
    await mkdir(fixture, { recursive: true });
    await run('git', ['init', '--bare', remote]);
    await run('git', ['init', checkout]);
    await run('git', ['-C', checkout, 'config', 'user.name', 'CMaster Test']);
    await run('git', ['-C', checkout, 'config', 'user.email', 'cmaster@example.invalid']);
    await writeFile(join(checkout, 'README.md'), '# Before\n');
    await writeFile(join(checkout, '.cmasterignore'), 'ignored.txt\n');
    await writeFile(join(checkout, 'ignored.txt'), 'preserve me\n');
    await writeFile(join(checkout, 'binary.dat'), Buffer.from([0, 1, 2, 3]));
    await symlink('README.md', join(checkout, 'linked-readme'));
    const nested = join(checkout, 'nested-repository');
    await run('git', ['init', nested]);
    await run('git', ['-C', nested, 'config', 'user.name', 'Nested Test']);
    await run('git', ['-C', nested, 'config', 'user.email', 'nested@example.invalid']);
    await writeFile(join(nested, 'nested.txt'), 'nested\n');
    await run('git', ['-C', nested, 'add', '.']);
    await run('git', ['-C', nested, 'commit', '-m', 'nested']);
    await run('git', ['-C', checkout, 'add', '.']);
    await run('git', ['-C', checkout, 'commit', '-m', 'initial']);
    await run('git', ['-C', checkout, 'branch', '-M', 'main']);
    await run('git', ['-C', checkout, 'remote', 'add', 'origin', remote]);
    await run('git', ['-C', checkout, 'push', '-u', 'origin', 'main']);

    const connectorId = workspaceConnectorId(randomUUID());
    const repositoryId = workspaceRepositoryId(randomUUID());
    const accepted = await new PostgresWorkspaceCatalog(pool).provisionGit(
      owner.resolveRequest(), {
        commandId: workspaceCommandId(randomUUID()),
        name: 'Git snapshot apply',
        operationMode: 'edit_with_confirmation',
        source: { connectorId, repositoryId, defaultBranch: 'main' },
      },
    );
    await new PostgresWorkspaceProvisioningWorker(pool,
      createConfiguredGitWorkspaceProvisioner({
        storageRoot,
        repositories: [{ organizationId: organization, connectorId, repositoryId,
          remoteUrl: remote }],
      }),
      { workerId: `change-set-${randomUUID()}`, leaseTtlMs: 30_000 },
    ).executeOne();
    const workspace = await new PostgresWorkspaceCatalog(pool).get(
      owner.resolveRequest(), accepted.value.id,
    );
    const root = workspace.defaultWorkingRoot;
    if (!root) throw new Error('Expected a Git Working Root');
    const repositoryPath = join(storageRoot, organization, workspace.id, 'repository.git');
    const { stdout: branchBefore } = await run('git', [
      '--git-dir', repositoryPath, 'rev-parse', 'refs/heads/main',
    ], { encoding: 'utf8' });
    const revisionContent = createConfiguredWorkspaceRevisionContentReader({ storageRoot });
    const environments = new PostgresWorkspaceRunEnvironments(pool, {
      sandbox: createConfiguredWorkspaceSandboxAdapter({ storageRoot, revisionContent }),
    });
    const changes = new PostgresWorkspaceChanges(pool, {
      contentStore: createConfiguredWorkspaceChangeContentStore({ storageRoot }),
      revisionContent,
      snapshotStore: createConfiguredWorkspaceRevisionSnapshotStore({ storageRoot }),
      gitSnapshot: createConfiguredWorkspaceGitSnapshotAdapter({ storageRoot }),
    });
    const firstInvocation = workspaceInvocationId(randomUUID());
    await environments.prepare(owner.resolveRequest(), {
      invocationId: firstInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: root.currentRevisionId,
    });
    for (const unsafePath of ['ignored.txt', 'binary.dat', 'linked-readme', 'nested-repository']) {
      await expect(changes.propose(owner.resolveRequest(), {
        commandId: workspaceChangeCommandId(randomUUID()),
        invocationId: firstInvocation,
        workspaceId: workspace.id,
        workingRootId: root.id,
        baseRevisionId: root.currentRevisionId,
        entries: [{ kind: 'add', path: unsafePath,
          mediaType: 'text/plain; charset=utf-8', content: Buffer.from('replace hidden\n') }],
      })).rejects.toBeInstanceOf(InvalidWorkspaceChangeSetError);
    }
    const proposal = await changes.propose(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      invocationId: firstInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      baseRevisionId: root.currentRevisionId,
      entries: [{ kind: 'modify', path: 'README.md',
        mediaType: 'text/markdown; charset=utf-8', content: Buffer.from('# After\n') }],
    });
    const applied = await changes.apply(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      changeSetId: proposal.value.id,
    });
    await environments.release(owner.resolveRequest(), firstInvocation);
    const firstRevision = applied.value.resultingRevisionId!;
    const { stdout: retainedSnapshot } = await run('git', [
      '--git-dir', repositoryPath, 'rev-parse', `refs/cmaster/revisions/${firstRevision}`,
    ], { encoding: 'utf8' });
    expect(retainedSnapshot.trim()).not.toBe(branchBefore.trim());

    const secondInvocation = workspaceInvocationId(randomUUID());
    await environments.prepare(owner.resolveRequest(), {
      invocationId: secondInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: firstRevision,
    });
    const exposePreserved = await changes.propose(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      invocationId: secondInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      baseRevisionId: firstRevision,
      entries: [{ kind: 'modify', path: '.cmasterignore',
        mediaType: 'text/plain; charset=utf-8', content: Buffer.from('') }],
    });
    const reapplied = await changes.apply(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      changeSetId: exposePreserved.value.id,
    });
    const files = new PostgresWorkspaceWorkingRoots(pool, {
      revisionContent: createConfiguredWorkspaceRevisionContentReader({ storageRoot }),
    });
    await expect(files.openFile(owner.resolveRequest(), {
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: reapplied.value.resultingRevisionId!,
      path: 'ignored.txt',
    })).resolves.toMatchObject({ content: 'preserve me\n' });
    const { stdout: branchAfter } = await run('git', [
      '--git-dir', repositoryPath, 'rev-parse', 'refs/heads/main',
    ], { encoding: 'utf8' });
    expect(branchAfter.trim()).toBe(branchBefore.trim());
    await environments.release(owner.resolveRequest(), secondInvocation);

    const thirdInvocation = workspaceInvocationId(randomUUID());
    const resultingRevisionId = reapplied.value.resultingRevisionId;
    if (!resultingRevisionId) throw new Error('Expected resulting Git Revision');
    await environments.prepare(owner.resolveRequest(), {
      invocationId: thirdInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: resultingRevisionId,
    });
    const archivedProposal = await changes.propose(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      invocationId: thirdInvocation,
      workspaceId: workspace.id,
      workingRootId: root.id,
      baseRevisionId: resultingRevisionId,
      entries: [{ kind: 'modify', path: 'README.md',
        mediaType: 'text/markdown; charset=utf-8', content: Buffer.from('# Archived\n') }],
    });
    await pool.query(
      `UPDATE workspace_git_worktrees SET lifecycle_status = 'archived'
       WHERE organization_id = $1 AND working_root_id = $2`,
      [organization, root.id],
    );
    await expect(changes.getApplyAuthority(
      owner.resolveRequest(), thirdInvocation, archivedProposal.value.id,
    )).rejects.toBeInstanceOf(WorkspaceChangeSetUnavailableError);
    await expect(changes.apply(owner.resolveRequest(), {
      commandId: workspaceChangeCommandId(randomUUID()),
      changeSetId: archivedProposal.value.id,
    })).rejects.toBeInstanceOf(WorkspaceChangeSetUnavailableError);
    await environments.release(owner.resolveRequest(), thirdInvocation);
  });
});
