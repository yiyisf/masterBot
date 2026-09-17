import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { organizationId, principalId } from '@cmaster/identity';
import {
  createConfiguredGitWorkspaceProvisioner,
  createConfiguredWorkspaceRevisionContentReader,
  WorkspaceFileNotFoundError,
  workspaceConnectorId,
  workspaceId,
  workspaceRepositoryId,
  workingRootId,
  workspaceRevisionId,
} from './index.js';

const run = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRemote(): Promise<{ root: string; remote: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), 'cmaster-revision-content-'));
  roots.push(root);
  const remote = join(root, 'trusted.git');
  const checkout = join(root, 'checkout');
  await run('git', ['init', '--bare', remote]);
  await run('git', ['init', checkout]);
  await run('git', ['-C', checkout, 'config', 'user.name', 'CMaster Test']);
  await run('git', ['-C', checkout, 'config', 'user.email', 'cmaster@example.invalid']);
  await mkdir(join(checkout, 'src', 'nested'), { recursive: true });
  await writeFile(join(checkout, 'README.md'), '# pinned\n', 'utf8');
  await writeFile(join(checkout, 'src', 'index.ts'), 'export const pinned = true;\n', 'utf8');
  await writeFile(join(checkout, 'secret.txt'), 'git ignored secret\n', 'utf8');
  await writeFile(join(checkout, 'private.txt'), 'cmaster ignored secret\n', 'utf8');
  await writeFile(join(checkout, 'binary.dat'), Buffer.from([0xff, 0xfe, 0xfd]));
  await writeFile(join(checkout, 'oversized.txt'), Buffer.alloc(1_048_577, 0x61));
  await writeFile(join(checkout, 'src', 'nested', 'generated.txt'), 'nested ignored\n', 'utf8');
  await writeFile(join(checkout, '.gitignore'), 'secret.txt\n!private.txt\n', 'utf8');
  await writeFile(join(checkout, '.cmasterignore'), 'private.txt\n', 'utf8');
  await writeFile(join(checkout, 'src', 'nested', '.gitignore'), 'generated.txt\n', 'utf8');
  await symlink('/etc/passwd', join(checkout, 'host-link'));
  await run('git', ['-C', checkout, 'add', '.']);
  await run('git', ['-C', checkout, 'commit', '-m', 'initial']);
  const { stdout: nestedCommit } = await run('git', ['-C', checkout, 'rev-parse', 'HEAD']);
  await run('git', ['-C', checkout, 'update-index', '--add', '--cacheinfo',
    `160000,${nestedCommit.trim()},vendor/nested`]);
  await run('git', ['-C', checkout, 'commit', '-m', 'record nested repository']);
  await run('git', ['-C', checkout, 'branch', '-M', 'main']);
  await run('git', ['-C', checkout, 'remote', 'add', 'origin', remote]);
  await run('git', ['-C', checkout, 'push', '-u', 'origin', 'main']);
  const { stdout } = await run('git', ['-C', checkout, 'rev-parse', 'HEAD']);
  return { root, remote, head: stdout.trim() };
}

describe('configured Workspace Revision content reader', () => {
  it('reads only regular visible files from the pinned Git commit without exposing host paths', async () => {
    const fixture = await createRemote();
    const storageRoot = join(fixture.root, 'workspace-content');
    const organization = organizationId('00000000-0000-4000-8000-000000000001');
    const workspace = workspaceId('00000000-0000-4000-8000-000000000002');
    const connector = workspaceConnectorId('00000000-0000-4000-8000-000000000003');
    const repository = workspaceRepositoryId('00000000-0000-4000-8000-000000000004');
    const provisioner = createConfiguredGitWorkspaceProvisioner({
      storageRoot,
      repositories: [{ organizationId: organization, connectorId: connector,
        repositoryId: repository, remoteUrl: fixture.remote }],
    });
    await provisioner.provision({
      operationId: '00000000-0000-4000-8000-000000000005',
      organizationId: organization,
      principalId: principalId('00000000-0000-4000-8000-000000000006'),
      workspaceId: workspace,
      connectorId: connector,
      repositoryId: repository,
      defaultBranch: 'main',
    });
    const reader = createConfiguredWorkspaceRevisionContentReader({ storageRoot });
    const scope = {
      organizationId: organization,
      workspaceId: workspace,
      workingRootId: workingRootId('00000000-0000-4000-8000-000000000007'),
      revisionId: workspaceRevisionId('00000000-0000-4000-8000-000000000008'),
      source: { kind: 'git' as const, commit: fixture.head },
    };

    await expect(reader.list(scope)).resolves.toMatchObject([
      { path: '.cmasterignore' },
      { path: '.gitignore' },
      { path: 'README.md' },
      { path: 'src/index.ts' },
      { path: 'src/nested/.gitignore' },
    ]);
    await expect(reader.open({ ...scope, path: 'src/index.ts' }))
      .resolves.toEqual(Buffer.from('export const pinned = true;\n'));
    await writeFile(join(
      storageRoot, organization, workspace, 'worktrees',
      '00000000-0000-4000-8000-000000000005', 'src', 'index.ts',
    ), 'export const mutableWorktree = true;\n', 'utf8');
    await expect(reader.open({ ...scope, path: 'src/index.ts' }))
      .resolves.toEqual(Buffer.from('export const pinned = true;\n'));
    for (const path of [
      'secret.txt', 'private.txt', 'binary.dat', 'oversized.txt',
      'src/nested/generated.txt', 'host-link', 'vendor/nested',
    ]) {
      await expect(reader.open({ ...scope, path })).rejects.toBeInstanceOf(
        WorkspaceFileNotFoundError,
      );
    }
    expect(JSON.stringify(await reader.list(scope))).not.toContain(storageRoot);

    await writeFile(join(fixture.root, 'checkout', 'later.txt'), 'not pinned\n', 'utf8');
    await run('git', ['-C', join(fixture.root, 'checkout'), 'add', 'later.txt']);
    await run('git', ['-C', join(fixture.root, 'checkout'), 'commit', '-m', 'later']);
    await run('git', ['-C', join(fixture.root, 'checkout'), 'push']);
    await expect(reader.open({ ...scope, path: 'later.txt' }))
      .rejects.toBeInstanceOf(WorkspaceFileNotFoundError);
    const restartedReader = createConfiguredWorkspaceRevisionContentReader({ storageRoot });
    await expect(restartedReader.open({ ...scope, path: 'src/index.ts' }))
      .resolves.toEqual(Buffer.from('export const pinned = true;\n'));
  });
});
