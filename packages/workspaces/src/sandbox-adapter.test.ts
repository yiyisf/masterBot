import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { organizationId } from '@cmaster/identity';
import {
  createConfiguredWorkspaceSandboxAdapter,
  type WorkspaceFileEntry,
  WorkspaceFileNotFoundError,
  type WorkspaceRevisionContentReader,
  workspaceId,
  workspaceInvocationId,
  workspaceRevisionId,
  type WorkspaceRunEnvironmentId,
  workingRootId,
} from './index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('configured Workspace Sandbox Adapter', () => {
  it('materializes immutable safe files and recovers them without exposing storage paths', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'cmaster-sandbox-'));
    roots.push(storageRoot);
    let content = Buffer.from('pinned content\n');
    const entry = (): WorkspaceFileEntry => ({
      path: 'src/readme.txt',
      mediaType: 'text/plain; charset=utf-8',
      sizeBytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    });
    const revisionContent: WorkspaceRevisionContentReader = {
      async list() { return [entry()]; },
      async open() { return content; },
    };
    const scope = {
      environmentId: randomUUID() as WorkspaceRunEnvironmentId,
      invocationId: workspaceInvocationId(randomUUID()),
      organizationId: organizationId(randomUUID()),
      workspaceId: workspaceId(randomUUID()),
      workingRootId: workingRootId(randomUUID()),
      revisionId: workspaceRevisionId(randomUUID()),
      source: { kind: 'git' as const, commit: 'a'.repeat(40) },
    };
    const firstWorker = createConfiguredWorkspaceSandboxAdapter({
      storageRoot,
      revisionContent,
    });

    await firstWorker.prepare(scope);
    content = Buffer.from('mutable source changed\n');
    const recoveredWorker = createConfiguredWorkspaceSandboxAdapter({
      storageRoot,
      revisionContent,
    });

    await expect(recoveredWorker.list(scope.environmentId))
      .resolves.toEqual([entryFromPinnedContent()]);
    await expect(recoveredWorker.open(scope.environmentId, 'src/readme.txt'))
      .resolves.toEqual(Buffer.from('pinned content\n'));
    await expect(recoveredWorker.open(scope.environmentId, '../host-secret'))
      .rejects.toBeInstanceOf(WorkspaceFileNotFoundError);
    expect(JSON.stringify(await recoveredWorker.list(scope.environmentId)))
      .not.toContain(storageRoot);

    const fixedFile = join(
      storageRoot, 'run-environments', scope.environmentId, 'root', 'src', 'readme.txt',
    );
    await expect(writeFile(fixedFile, 'mutation denied\n', 'utf8')).rejects.toThrow();
    await chmod(join(fixedFile, '..'), 0o700);
    await chmod(fixedFile, 0o600);
    await rm(fixedFile);
    await symlink('/etc/hosts', fixedFile);
    await expect(recoveredWorker.open(scope.environmentId, 'src/readme.txt'))
      .rejects.toBeInstanceOf(WorkspaceFileNotFoundError);
    await recoveredWorker.release({ environmentId: scope.environmentId });
    await expect(recoveredWorker.list(scope.environmentId))
      .rejects.toBeInstanceOf(WorkspaceFileNotFoundError);
  });
});

function entryFromPinnedContent(): WorkspaceFileEntry {
  const bytes = Buffer.from('pinned content\n');
  return {
    path: 'src/readme.txt',
    mediaType: 'text/plain; charset=utf-8',
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
