import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { organizationId } from '@cmaster/identity';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createConfiguredWorkspaceRevisionContentReader,
  createConfiguredWorkspaceRevisionSnapshotStore,
  WorkspaceRevisionContentError,
  workingRootId,
  workspaceId,
  workspaceRevisionId,
} from './index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function entry(path: string, value: string) {
  const bytes = Buffer.from(value);
  return {
    path,
    mediaType: 'text/plain; charset=utf-8',
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes,
  };
}

describe('configured Workspace Revision Snapshot Store', () => {
  it('preserves ignored bytes across immutable snapshots and rejects symlink substitution', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'cmaster-revision-snapshot-'));
    roots.push(storageRoot);
    const common = {
      organizationId: organizationId(randomUUID()),
      workspaceId: workspaceId(randomUUID()),
      workingRootId: workingRootId(randomUUID()),
    };
    const first = { ...common, revisionId: workspaceRevisionId(randomUUID()) };
    const second = { ...common, revisionId: workspaceRevisionId(randomUUID()) };
    const store = createConfiguredWorkspaceRevisionSnapshotStore({ storageRoot });
    await store.put(first, [entry('.cmasterignore', 'hidden.txt\n'), entry('hidden.txt', 'secret\n')]);
    const reader = createConfiguredWorkspaceRevisionContentReader({ storageRoot });
    await expect(reader.list({ ...first, source: { kind: 'snapshot' } }))
      .resolves.toMatchObject([{ path: '.cmasterignore' }]);

    await store.apply(first, second, [{ kind: 'modify', entry: entry('.cmasterignore', '') }]);
    await expect(reader.open({ ...second, source: { kind: 'snapshot' }, path: 'hidden.txt' }))
      .resolves.toEqual(Buffer.from('secret\n'));

    const storedFile = join(storageRoot, common.organizationId, common.workspaceId,
      'revisions', second.revisionId, 'root', 'hidden.txt');
    await rm(storedFile);
    await symlink('/etc/passwd', storedFile);
    await expect(createConfiguredWorkspaceRevisionContentReader({ storageRoot }).open({
      ...second, source: { kind: 'snapshot' }, path: 'hidden.txt',
    })).rejects.toBeInstanceOf(WorkspaceRevisionContentError);
  });

  it('fails closed when persisted snapshot metadata is corrupt', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'cmaster-revision-corrupt-'));
    roots.push(storageRoot);
    const scope = {
      organizationId: organizationId(randomUUID()),
      workspaceId: workspaceId(randomUUID()),
      workingRootId: workingRootId(randomUUID()),
      revisionId: workspaceRevisionId(randomUUID()),
    };
    const store = createConfiguredWorkspaceRevisionSnapshotStore({ storageRoot });
    await store.put(scope, [entry('safe.txt', 'safe\n')]);
    const manifest = join(storageRoot, scope.organizationId, scope.workspaceId,
      'revisions', scope.revisionId, 'manifest.json');
    await rm(manifest);
    await writeFile(manifest, '{');
    await expect(createConfiguredWorkspaceRevisionContentReader({ storageRoot }).list({
      ...scope, source: { kind: 'snapshot' },
    })).rejects.toBeInstanceOf(WorkspaceRevisionContentError);
  });
});
