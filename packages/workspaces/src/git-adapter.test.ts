import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { organizationId, principalId } from '@cmaster/identity';
import {
  createConfiguredGitWorkspaceProvisioner,
  workspaceConnectorId,
  workspaceId,
  workspaceRepositoryId,
} from './index.js';

const run = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRemote(): Promise<{ root: string; remote: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), 'cmaster-git-adapter-'));
  roots.push(root);
  const remote = join(root, 'trusted.git');
  const checkout = join(root, 'checkout');
  await run('git', ['init', '--bare', remote]);
  await run('git', ['init', checkout]);
  await run('git', ['-C', checkout, 'config', 'user.name', 'CMaster Test']);
  await run('git', ['-C', checkout, 'config', 'user.email', 'cmaster@example.invalid']);
  await writeFile(join(checkout, 'README.md'), '# trusted\n', 'utf8');
  await run('git', ['-C', checkout, 'add', 'README.md']);
  await run('git', ['-C', checkout, 'commit', '-m', 'initial']);
  await run('git', ['-C', checkout, 'branch', '-M', 'main']);
  await run('git', ['-C', checkout, 'remote', 'add', 'origin', remote]);
  await run('git', ['-C', checkout, 'push', '-u', 'origin', 'main']);
  const { stdout } = await run('git', ['-C', checkout, 'rev-parse', 'HEAD']);
  return { root, remote, head: stdout.trim() };
}

describe('configured Git Workspace provisioner', () => {
  it('leases and revokes a Credential without writing its value into Workspace storage', async () => {
    const fixture = await createRemote();
    const storageRoot = join(fixture.root, 'credential-content');
    const organization = organizationId('00000000-0000-4000-8000-000000000011');
    const connectorId = workspaceConnectorId('00000000-0000-4000-8000-000000000012');
    const repositoryId = workspaceRepositoryId('00000000-0000-4000-8000-000000000013');
    const actions: string[] = [];
    const secret = 'must-not-be-persisted-credential';
    const provisioner = createConfiguredGitWorkspaceProvisioner({
      storageRoot,
      repositories: [{ organizationId: organization, connectorId, repositoryId,
        remoteUrl: fixture.remote, credentialRef: 'credential-ref' }],
      credentialBroker: {
        async issue() {
          actions.push('issued');
          return {
            id: 'lease-1', secret,
            expiresAt: new Date(Date.now() + 60_000),
          };
        },
        async revoke(id) {
          actions.push(`revoked:${id}`);
        },
      },
    });

    await provisioner.provision({
      operationId: '00000000-0000-4000-8000-000000000014',
      organizationId: organization,
      principalId: principalId('00000000-0000-4000-8000-000000000015'),
      workspaceId: workspaceId('00000000-0000-4000-8000-000000000016'),
      connectorId,
      repositoryId,
      defaultBranch: 'main',
    });

    expect(actions).toEqual(['issued', 'revoked:lease-1']);
    await expect(run('grep', ['-R', '--fixed-strings', secret, storageRoot]))
      .rejects.toMatchObject({ code: 1 });
  });

  it('materializes an isolated Worktree from the pinned default head', async () => {
    const fixture = await createRemote();
    const storageRoot = join(fixture.root, 'worktree-content');
    const organization = organizationId('00000000-0000-4000-8000-000000000021');
    const connectorId = workspaceConnectorId('00000000-0000-4000-8000-000000000022');
    const repositoryId = workspaceRepositoryId('00000000-0000-4000-8000-000000000023');
    const provisioner = createConfiguredGitWorkspaceProvisioner({
      storageRoot,
      repositories: [{ organizationId: organization, connectorId, repositoryId,
        remoteUrl: fixture.remote }],
    });
    const common = {
      organizationId: organization,
      principalId: principalId('00000000-0000-4000-8000-000000000024'),
      workspaceId: workspaceId('00000000-0000-4000-8000-000000000025'),
      connectorId,
      repositoryId,
    };
    await provisioner.provision({
      ...common,
      operationId: '00000000-0000-4000-8000-000000000026',
      defaultBranch: 'main',
    });

    const result = await provisioner.createWorktree({
      ...common,
      operationId: '00000000-0000-4000-8000-000000000027',
      branchName: 'feature/isolated',
      baseCommit: fixture.head,
    });

    expect(result).toEqual({
      headCommit: fixture.head,
      contentManifestHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    const { stdout } = await run('git', [
      '--git-dir', join(storageRoot, organization, common.workspaceId, 'repository.git'),
      'rev-parse', 'refs/heads/feature/isolated',
    ]);
    expect(stdout.trim()).toBe(fixture.head);

    const repositoryPath = join(
      storageRoot, organization, common.workspaceId, 'repository.git',
    );
    await run('git', [
      '--git-dir', repositoryPath, 'branch', 'feature/already-exists', fixture.head,
    ]);
    await expect(provisioner.createWorktree({
      ...common,
      operationId: '00000000-0000-4000-8000-000000000028',
      branchName: 'feature/already-exists',
      baseCommit: fixture.head,
    })).rejects.toMatchObject({ code: 'git_branch_conflict', retryable: false });
  });

  it('materializes only a server-trusted source and pins an operation retry to its first result', async () => {
    const fixture = await createRemote();
    const storageRoot = join(fixture.root, 'workspace-content');
    const organization = organizationId('00000000-0000-4000-8000-000000000001');
    const connectorId = workspaceConnectorId('00000000-0000-4000-8000-000000000002');
    const repositoryId = workspaceRepositoryId('00000000-0000-4000-8000-000000000003');
    const provisioner = createConfiguredGitWorkspaceProvisioner({
      storageRoot,
      repositories: [{ organizationId: organization, connectorId, repositoryId,
        remoteUrl: fixture.remote }],
    });
    const request = {
      operationId: '00000000-0000-4000-8000-000000000004',
      organizationId: organization,
      principalId: principalId('00000000-0000-4000-8000-000000000005'),
      workspaceId: workspaceId('00000000-0000-4000-8000-000000000006'),
      connectorId,
      repositoryId,
      defaultBranch: 'main',
    };

    const first = await provisioner.provision(request);
    await expect(readFile(join(
      storageRoot, organization, request.workspaceId, 'worktrees', request.operationId, 'README.md',
    ), 'utf8')).resolves.toBe('# trusted\n');
    await rm(join(
      storageRoot, organization, request.workspaceId, 'operations', `${request.operationId}.json`,
    ));
    await expect(provisioner.provision(request)).resolves.toEqual(first);
    await writeFile(join(fixture.root, 'checkout', 'README.md'), '# changed later\n', 'utf8');
    await run('git', ['-C', join(fixture.root, 'checkout'), 'commit', '-am', 'later']);
    await run('git', ['-C', join(fixture.root, 'checkout'), 'push']);
    const replay = await provisioner.provision(request);

    expect(first).toEqual({
      headCommit: fixture.head,
      contentManifestHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(replay).toEqual(first);
  });
});
