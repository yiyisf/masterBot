import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { OrganizationId } from '@cmaster/identity';
import { WorkspaceFileNotFoundError, WorkspaceRevisionContentError } from './workspace-types.js';

export interface WorkspaceChangeContentEntry {
  readonly path: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly bytes: Buffer;
}

export interface WorkspaceChangeContentScope {
  readonly organizationId: OrganizationId;
  readonly changeSetId: string;
}

export interface WorkspaceChangeContentStore {
  put(scope: WorkspaceChangeContentScope, entries: readonly WorkspaceChangeContentEntry[]): Promise<void>;
  open(scope: WorkspaceChangeContentScope, path: string): Promise<Buffer>;
}

interface StoredManifest {
  readonly schemaVersion: 1;
  readonly changeSetId: string;
  readonly entries: readonly Omit<WorkspaceChangeContentEntry, 'bytes'>[];
}

const identifierPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hashPattern = /^[0-9a-f]{64}$/u;

function canonicalPath(value: string): string {
  if (value.length < 1 || value.length > 1024 || value.startsWith('/')
    || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)
    || value !== value.normalize('NFC')
    || value.split('/').some((segment) => segment === '' || segment === '.'
      || segment === '..' || segment === '.git')) {
    throw new WorkspaceRevisionContentError('content_unavailable');
  }
  return value;
}

function directory(storageRoot: string, scope: WorkspaceChangeContentScope): string {
  if (!identifierPattern.test(scope.organizationId)
    || !identifierPattern.test(scope.changeSetId)) {
    throw new WorkspaceRevisionContentError('content_unavailable');
  }
  return join(storageRoot, scope.organizationId, 'change-sets', scope.changeSetId);
}

function metadata(entry: WorkspaceChangeContentEntry): Omit<WorkspaceChangeContentEntry, 'bytes'> {
  return {
    path: entry.path,
    mediaType: entry.mediaType,
    sizeBytes: entry.sizeBytes,
    sha256: entry.sha256,
  };
}

function validate(entries: readonly WorkspaceChangeContentEntry[]): void {
  const paths = new Set<string>();
  for (const entry of entries) {
    if (canonicalPath(entry.path) !== entry.path || paths.has(entry.path)
      || entry.mediaType.length < 1 || entry.mediaType.length > 100
      || !Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 0
      || entry.sizeBytes > 1_048_576 || entry.bytes.byteLength !== entry.sizeBytes
      || !hashPattern.test(entry.sha256)
      || createHash('sha256').update(entry.bytes).digest('hex') !== entry.sha256) {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    paths.add(entry.path);
  }
}

async function loadManifest(
  storageRoot: string,
  scope: WorkspaceChangeContentScope,
): Promise<StoredManifest> {
  try {
    const value: unknown = JSON.parse(await readFile(
      join(directory(storageRoot, scope), 'manifest.json'), 'utf8',
    ));
    if (!value || typeof value !== 'object'
      || !('schemaVersion' in value) || value.schemaVersion !== 1
      || !('changeSetId' in value) || value.changeSetId !== scope.changeSetId
      || !('entries' in value) || !Array.isArray(value.entries)) {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    const entries = value.entries.map((entry): Omit<WorkspaceChangeContentEntry, 'bytes'> => {
      if (!entry || typeof entry !== 'object'
        || !('path' in entry) || typeof entry.path !== 'string'
        || !('mediaType' in entry) || typeof entry.mediaType !== 'string'
        || !('sizeBytes' in entry) || typeof entry.sizeBytes !== 'number'
        || !('sha256' in entry) || typeof entry.sha256 !== 'string') {
        throw new WorkspaceRevisionContentError('content_unavailable');
      }
      return {
        path: canonicalPath(entry.path), mediaType: entry.mediaType,
        sizeBytes: entry.sizeBytes, sha256: entry.sha256,
      };
    });
    return { schemaVersion: 1, changeSetId: scope.changeSetId, entries };
  } catch (error) {
    if (error instanceof WorkspaceRevisionContentError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WorkspaceFileNotFoundError();
    }
    throw new WorkspaceRevisionContentError('content_unavailable');
  }
}

export function createConfiguredWorkspaceChangeContentStore(options: {
  readonly storageRoot: string;
}): WorkspaceChangeContentStore {
  return {
    async put(scope, entries) {
      validate(entries);
      const destination = directory(options.storageRoot, scope);
      try {
        const existing = await loadManifest(options.storageRoot, scope);
        if (JSON.stringify(existing.entries) !== JSON.stringify(entries.map(metadata))) {
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
        const manifest: StoredManifest = {
          schemaVersion: 1,
          changeSetId: scope.changeSetId,
          entries: entries.map(metadata),
        };
        await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest), {
          flag: 'wx', mode: 0o400,
        });
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        try {
          await rename(staging, destination);
        } catch {
          const existing = await loadManifest(options.storageRoot, scope);
          if (JSON.stringify(existing.entries) !== JSON.stringify(manifest.entries)) {
            throw new WorkspaceRevisionContentError('content_unavailable');
          }
        }
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    },

    async open(scope, path) {
      const canonical = canonicalPath(path);
      const manifest = await loadManifest(options.storageRoot, scope);
      const entry = manifest.entries.find((candidate) => candidate.path === canonical);
      if (!entry) throw new WorkspaceFileNotFoundError();
      try {
        const root = join(directory(options.storageRoot, scope), 'root');
        const target = join(root, ...canonical.split('/'));
        const stat = await lstat(target);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new WorkspaceRevisionContentError('content_unavailable');
        }
        const [actualRoot, actualTarget] = await Promise.all([realpath(root), realpath(target)]);
        const fromRoot = relative(actualRoot, actualTarget);
        if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
          throw new WorkspaceRevisionContentError('content_unavailable');
        }
        const bytes = await readFile(actualTarget);
        if (bytes.byteLength !== entry.sizeBytes
          || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
          throw new WorkspaceRevisionContentError('content_unavailable');
        }
        return bytes;
      } catch (error) {
        if (error instanceof WorkspaceRevisionContentError) throw error;
        throw new WorkspaceFileNotFoundError();
      }
    },
  };
}
