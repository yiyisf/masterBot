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
  WorkspaceIdempotencyConflictError,
  type WorkspaceRevisionContentReader,
  workspaceId,
  workspaceInvocationId,
  workspaceOverlayCommandId,
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
      async isPathVisible(_scope, path) { return path !== 'ignored.txt'; },
      async pathExists(_scope, path) { return path === 'src/readme.txt' || path === 'linked'; },
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

    await expect(recoveredWorker.mutateOverlay(scope, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      kind: 'write',
      path: '../escape.txt',
      mediaType: 'text/plain; charset=utf-8',
      bytes: Buffer.from('escape\n'),
    })).rejects.toBeInstanceOf(WorkspaceFileNotFoundError);
    await expect(recoveredWorker.mutateOverlay(scope, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      kind: 'write',
      path: 'binary.txt',
      mediaType: 'text/plain; charset=utf-8',
      bytes: Buffer.from([0xff]),
    })).rejects.toThrow('content_unavailable');
    await expect(recoveredWorker.mutateOverlay(scope, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      kind: 'write',
      path: 'oversized.txt',
      mediaType: 'text/plain; charset=utf-8',
      bytes: Buffer.alloc(1_048_577, 0x61),
    })).rejects.toThrow('content_limit_exceeded');
    const writeCommand = workspaceOverlayCommandId(randomUUID());
    const written = await recoveredWorker.mutateOverlay(scope, {
      commandId: writeCommand,
      kind: 'write',
      path: 'notes/new.md',
      mediaType: 'text/markdown; charset=utf-8',
      bytes: Buffer.from('# New\n'),
    });
    await expect(firstWorker.mutateOverlay(scope, {
      commandId: writeCommand,
      kind: 'write',
      path: 'notes/new.md',
      mediaType: 'text/markdown; charset=utf-8',
      bytes: Buffer.from('# New\n'),
    })).resolves.toEqual({ ...written, replayed: true });
    await expect(firstWorker.mutateOverlay(scope, {
      commandId: writeCommand,
      kind: 'write',
      path: 'notes/new.md',
      mediaType: 'text/markdown; charset=utf-8',
      bytes: Buffer.from('# Conflict\n'),
    })).rejects.toBeInstanceOf(WorkspaceIdempotencyConflictError);
    await expect(firstWorker.mutateOverlay(scope, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      kind: 'write',
      path: 'notes/new.md/child.txt',
      mediaType: 'text/plain; charset=utf-8',
      bytes: Buffer.from('collision\n'),
    })).rejects.toBeInstanceOf(WorkspaceFileNotFoundError);
    await expect(recoveredWorker.mutateOverlay(scope, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      kind: 'write',
      path: 'ignored.txt',
      mediaType: 'text/plain; charset=utf-8',
      bytes: Buffer.from('hidden\n'),
    })).rejects.toBeInstanceOf(WorkspaceFileNotFoundError);
    await expect(recoveredWorker.mutateOverlay(scope, {
      commandId: workspaceOverlayCommandId(randomUUID()),
      kind: 'write',
      path: 'linked',
      mediaType: 'text/plain; charset=utf-8',
      bytes: Buffer.from('replace\n'),
    })).rejects.toBeInstanceOf(WorkspaceFileNotFoundError);
    await expect(firstWorker.snapshotOverlay(scope)).resolves.toMatchObject({
      entries: [{ kind: 'write', path: 'notes/new.md', baseExists: false,
        bytes: Buffer.from('# New\n') }],
    });

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
    await writeFile(join(
      storageRoot, 'run-environments', scope.environmentId, 'overlay', 'overlay-manifest.json',
    ), '{corrupt', 'utf8');
    await expect(recoveredWorker.prepare(scope)).rejects.toBeInstanceOf(WorkspaceFileNotFoundError);
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
