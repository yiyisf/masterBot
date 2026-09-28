import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { OrganizationId } from '@cmaster/identity';
import {
  WorkspaceFileNotFoundError,
  WorkspaceRevisionContentError,
  type WorkingRootId,
  type WorkspaceFileEntry,
  type WorkspaceId,
  type WorkspaceRevisionId,
} from './workspace-types.js';

export interface WorkspaceRevisionSnapshotScope {
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly workingRootId: WorkingRootId;
  readonly revisionId: WorkspaceRevisionId;
}

export interface WorkspaceRevisionSnapshotEntry extends WorkspaceFileEntry {
  readonly bytes: Buffer;
}

export type WorkspaceRevisionSnapshotChange =
  | { readonly kind: 'delete'; readonly path: string }
  | { readonly kind: 'add' | 'modify'; readonly entry: WorkspaceRevisionSnapshotEntry };

export interface WorkspaceRevisionSnapshotStore {
  put(
    scope: WorkspaceRevisionSnapshotScope,
    entries: readonly WorkspaceRevisionSnapshotEntry[],
  ): Promise<void>;
  apply(
    current: WorkspaceRevisionSnapshotScope,
    result: WorkspaceRevisionSnapshotScope,
    changes: readonly WorkspaceRevisionSnapshotChange[],
  ): Promise<readonly WorkspaceRevisionSnapshotEntry[]>;
}

interface SnapshotManifest {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly workingRootId: string;
  readonly revisionId: string;
  readonly entries: readonly WorkspaceFileEntry[];
}

const identifierPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hashPattern = /^[0-9a-f]{64}$/u;

function canonicalPath(value: string): boolean {
  return value.length > 0 && value.length <= 1024 && value === value.normalize('NFC')
    && !value.startsWith('/') && !value.includes('\\')
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && value.split('/').every((segment) => segment.length > 0
      && segment !== '.' && segment !== '..' && segment !== '.git');
}

function snapshotDirectory(storageRoot: string, scope: WorkspaceRevisionSnapshotScope): string {
  if (![scope.organizationId, scope.workspaceId, scope.workingRootId, scope.revisionId]
    .every((value) => identifierPattern.test(value))) {
    throw new WorkspaceRevisionContentError('content_unavailable');
  }
  return join(storageRoot, scope.organizationId, scope.workspaceId, 'revisions', scope.revisionId);
}

function metadata(entry: WorkspaceRevisionSnapshotEntry): WorkspaceFileEntry {
  return {
    path: entry.path,
    mediaType: entry.mediaType,
    sizeBytes: entry.sizeBytes,
    sha256: entry.sha256,
  };
}

function validateEntries(entries: readonly WorkspaceRevisionSnapshotEntry[]): void {
  if (entries.length > 10_000) throw new WorkspaceRevisionContentError('content_limit_exceeded');
  let totalBytes = 0;
  let previousPath: string | undefined;
  for (const entry of entries) {
    totalBytes += entry.sizeBytes;
    if (!canonicalPath(entry.path) || entry.path <= (previousPath ?? '')
      || entry.mediaType.length < 1 || entry.mediaType.length > 100
      || !Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 0
      || entry.sizeBytes > 1_048_576 || entry.bytes.byteLength !== entry.sizeBytes
      || !hashPattern.test(entry.sha256)
      || createHash('sha256').update(entry.bytes).digest('hex') !== entry.sha256) {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    previousPath = entry.path;
  }
  if (totalBytes > 64 * 1_048_576) {
    throw new WorkspaceRevisionContentError('content_limit_exceeded');
  }
}

export async function readWorkspaceRevisionSnapshotManifest(
  storageRoot: string,
  scope: WorkspaceRevisionSnapshotScope,
): Promise<readonly WorkspaceFileEntry[]> {
  try {
    const value: unknown = JSON.parse(await readFile(
      join(snapshotDirectory(storageRoot, scope), 'manifest.json'), 'utf8',
    ));
    if (!value || typeof value !== 'object'
      || !('schemaVersion' in value) || value.schemaVersion !== 1
      || !('workspaceId' in value) || value.workspaceId !== scope.workspaceId
      || !('workingRootId' in value) || value.workingRootId !== scope.workingRootId
      || !('revisionId' in value) || value.revisionId !== scope.revisionId
      || !('entries' in value) || !Array.isArray(value.entries)) {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    const entries = value.entries.map((entry): WorkspaceFileEntry => {
      if (!entry || typeof entry !== 'object'
        || !('path' in entry) || typeof entry.path !== 'string'
        || !('mediaType' in entry) || typeof entry.mediaType !== 'string'
        || !('sizeBytes' in entry) || typeof entry.sizeBytes !== 'number'
        || !('sha256' in entry) || typeof entry.sha256 !== 'string'
        || !canonicalPath(entry.path) || !hashPattern.test(entry.sha256)) {
        throw new WorkspaceRevisionContentError('content_unavailable');
      }
      return {
        path: entry.path, mediaType: entry.mediaType,
        sizeBytes: entry.sizeBytes, sha256: entry.sha256,
      };
    });
    if (entries.length > 10_000) {
      throw new WorkspaceRevisionContentError('content_limit_exceeded');
    }
    let previous: string | undefined;
    let totalBytes = 0;
    for (const entry of entries) {
      totalBytes += entry.sizeBytes;
      if (entry.path <= (previous ?? '') || entry.mediaType.length < 1
        || entry.mediaType.length > 100 || !Number.isInteger(entry.sizeBytes)
        || entry.sizeBytes < 0 || entry.sizeBytes > 1_048_576) {
        throw new WorkspaceRevisionContentError('content_unavailable');
      }
      previous = entry.path;
    }
    if (totalBytes > 64 * 1_048_576) {
      throw new WorkspaceRevisionContentError('content_limit_exceeded');
    }
    return entries;
  } catch (error) {
    if (error instanceof WorkspaceRevisionContentError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WorkspaceFileNotFoundError();
    }
    throw new WorkspaceRevisionContentError('content_unavailable');
  }
}

export async function readWorkspaceRevisionSnapshotFile(
  storageRoot: string,
  scope: WorkspaceRevisionSnapshotScope,
  entry: WorkspaceFileEntry,
): Promise<Buffer> {
  try {
    const root = join(snapshotDirectory(storageRoot, scope), 'root');
    const target = join(root, ...entry.path.split('/'));
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    const [actualRoot, actualTarget] = await Promise.all([realpath(root), realpath(target)]);
    const fromRoot = relative(actualRoot, actualTarget);
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    const content = await readFile(actualTarget);
    if (content.byteLength !== entry.sizeBytes
      || createHash('sha256').update(content).digest('hex') !== entry.sha256) {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    return content;
  } catch (error) {
    if (error instanceof WorkspaceRevisionContentError) throw error;
    throw new WorkspaceFileNotFoundError();
  }
}

export function createConfiguredWorkspaceRevisionSnapshotStore(options: {
  readonly storageRoot: string;
}): WorkspaceRevisionSnapshotStore {
  const put = async (
    scope: WorkspaceRevisionSnapshotScope,
    entries: readonly WorkspaceRevisionSnapshotEntry[],
  ): Promise<void> => {
    validateEntries(entries);
    const destination = snapshotDirectory(options.storageRoot, scope);
    const manifest: SnapshotManifest = {
      schemaVersion: 1,
      workspaceId: scope.workspaceId,
      workingRootId: scope.workingRootId,
      revisionId: scope.revisionId,
      entries: entries.map(metadata),
    };
    try {
      const existing = await readWorkspaceRevisionSnapshotManifest(options.storageRoot, scope);
      if (JSON.stringify(existing) !== JSON.stringify(manifest.entries)) {
        throw new WorkspaceRevisionContentError('content_unavailable');
      }
      return;
    } catch (error) {
      if (!(error instanceof WorkspaceFileNotFoundError)) throw error;
    }
    const staging = `${destination}.staging-${randomUUID()}`;
    try {
      await mkdir(join(staging, 'root'), { recursive: true, mode: 0o700 });
      for (const entry of entries) {
        const target = join(staging, 'root', ...entry.path.split('/'));
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, entry.bytes, { flag: 'wx', mode: 0o400 });
      }
      await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest), {
        flag: 'wx', mode: 0o400,
      });
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      try {
        await rename(staging, destination);
      } catch {
        const existing = await readWorkspaceRevisionSnapshotManifest(options.storageRoot, scope);
        if (JSON.stringify(existing) !== JSON.stringify(manifest.entries)) {
          throw new WorkspaceRevisionContentError('content_unavailable');
        }
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  };

  return {
    put,
    async apply(current, result, changes) {
      const existing = await readWorkspaceRevisionSnapshotManifest(options.storageRoot, current);
      const entries = new Map<string, WorkspaceRevisionSnapshotEntry>();
      for (const entry of existing) {
        entries.set(entry.path, {
          ...entry,
          bytes: await readWorkspaceRevisionSnapshotFile(options.storageRoot, current, entry),
        });
      }
      for (const change of changes) {
        if (change.kind === 'delete') entries.delete(change.path);
        else entries.set(change.entry.path, change.entry);
      }
      const resultEntries = [...entries.values()].sort((left, right) => (
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0
      ));
      await put(result, resultEntries);
      return resultEntries;
    },
  };
}
