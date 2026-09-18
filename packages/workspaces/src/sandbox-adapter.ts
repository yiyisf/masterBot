import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  type WorkspaceRunEnvironmentId,
  type WorkspaceSandboxAdapter,
  type WorkspaceSandboxScope,
} from './run-environments.js';
import {
  WorkspaceFileNotFoundError,
  WorkspaceRevisionContentError,
  type WorkspaceFileEntry,
  type WorkspaceRevisionContentReader,
} from './revision-content.js';

const identifierPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hashPattern = /^[0-9a-f]{64}$/u;
const maximumFileBytes = 1_048_576;
const maximumFiles = 10_000;
const manifestName = 'manifest.json';

interface SandboxManifest {
  readonly schemaVersion: 1;
  readonly environmentId: string;
  readonly invocationId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly workingRootId: string;
  readonly revisionId: string;
  readonly entries: readonly WorkspaceFileEntry[];
}

function canonicalPath(value: string): string {
  if (value.length < 1 || value.length > 1024 || value.startsWith('/')
    || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)
    || value !== value.normalize('NFC')) {
    throw new WorkspaceFileNotFoundError();
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'
    || segment === '.git')) {
    throw new WorkspaceFileNotFoundError();
  }
  return segments.join('/');
}

function assertIdentifier(value: string): void {
  if (!identifierPattern.test(value)) {
    throw new WorkspaceRevisionContentError('content_unavailable');
  }
}

function environmentDirectory(storageRoot: string, environmentId: WorkspaceRunEnvironmentId): string {
  assertIdentifier(environmentId);
  return join(storageRoot, 'run-environments', environmentId);
}

function validateEntries(entries: readonly WorkspaceFileEntry[]): void {
  if (entries.length > maximumFiles) {
    throw new WorkspaceRevisionContentError('content_limit_exceeded');
  }
  const paths = new Set<string>();
  for (const entry of entries) {
    if (canonicalPath(entry.path) !== entry.path || paths.has(entry.path)
      || !Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 0
      || entry.sizeBytes > maximumFileBytes || !hashPattern.test(entry.sha256)
      || entry.mediaType.length < 1 || entry.mediaType.length > 100) {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    paths.add(entry.path);
  }
}

function parseManifest(value: unknown, expectedId: WorkspaceRunEnvironmentId): SandboxManifest {
  if (!value || typeof value !== 'object'
    || !('schemaVersion' in value) || value.schemaVersion !== 1
    || !('environmentId' in value) || value.environmentId !== expectedId
    || !('invocationId' in value) || typeof value.invocationId !== 'string'
    || !('organizationId' in value) || typeof value.organizationId !== 'string'
    || !('workspaceId' in value) || typeof value.workspaceId !== 'string'
    || !('workingRootId' in value) || typeof value.workingRootId !== 'string'
    || !('revisionId' in value) || typeof value.revisionId !== 'string'
    || !('entries' in value) || !Array.isArray(value.entries)) {
    throw new WorkspaceRevisionContentError('content_unavailable');
  }
  const entries: WorkspaceFileEntry[] = value.entries.map((entry) => {
    if (!entry || typeof entry !== 'object'
      || !('path' in entry) || typeof entry.path !== 'string'
      || !('mediaType' in entry) || typeof entry.mediaType !== 'string'
      || !('sizeBytes' in entry) || typeof entry.sizeBytes !== 'number'
      || !('sha256' in entry) || typeof entry.sha256 !== 'string') {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    return {
      path: entry.path,
      mediaType: entry.mediaType,
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256,
    };
  });
  validateEntries(entries);
  return {
    schemaVersion: 1,
    environmentId: value.environmentId as string,
    invocationId: value.invocationId,
    organizationId: value.organizationId,
    workspaceId: value.workspaceId,
    workingRootId: value.workingRootId,
    revisionId: value.revisionId,
    entries,
  };
}

async function loadManifest(
  storageRoot: string,
  environmentId: WorkspaceRunEnvironmentId,
): Promise<SandboxManifest> {
  try {
    const bytes = await readFile(join(environmentDirectory(storageRoot, environmentId), manifestName));
    return parseManifest(JSON.parse(bytes.toString('utf8')) as unknown, environmentId);
  } catch (error) {
    if (error instanceof WorkspaceRevisionContentError) throw error;
    throw new WorkspaceFileNotFoundError();
  }
}

function sameScope(manifest: SandboxManifest, scope: WorkspaceSandboxScope): boolean {
  return manifest.environmentId === scope.environmentId
    && manifest.invocationId === scope.invocationId
    && manifest.organizationId === scope.organizationId
    && manifest.workspaceId === scope.workspaceId
    && manifest.workingRootId === scope.workingRootId
    && manifest.revisionId === scope.revisionId;
}

async function removeMaterialization(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      await chmod(path, 0o700);
      for (const entry of await readdir(path)) {
        await removeMaterialization(join(path, entry));
      }
    } else {
      await chmod(path, 0o600);
    }
  } catch {
    return;
  }
  await rm(path, { recursive: true, force: true });
}

/**
 * Materializes only pre-filtered immutable Revision bytes. The fixed root is made read-only;
 * Invocation-private temp/overlay directories are separate and never exposed by the public Module.
 */
export function createConfiguredWorkspaceSandboxAdapter(options: {
  readonly storageRoot: string;
  readonly revisionContent: WorkspaceRevisionContentReader;
}): WorkspaceSandboxAdapter {
  return {
    async prepare(scope) {
      for (const id of [scope.environmentId, scope.invocationId, scope.organizationId,
        scope.workspaceId, scope.workingRootId, scope.revisionId]) assertIdentifier(id);
      const destination = environmentDirectory(options.storageRoot, scope.environmentId);
      const parent = dirname(destination);
      await mkdir(parent, { recursive: true, mode: 0o700 });
      for (const entry of await readdir(parent)) {
        if (entry.startsWith(`${scope.environmentId}.staging-`)) {
          await removeMaterialization(join(parent, entry));
        }
      }
      try {
        const existing = await loadManifest(options.storageRoot, scope.environmentId);
        if (!sameScope(existing, scope)) {
          throw new WorkspaceRevisionContentError('content_unavailable');
        }
        return;
      } catch (error) {
        if (!(error instanceof WorkspaceFileNotFoundError)) throw error;
      }

      const entries = await options.revisionContent.list(scope);
      validateEntries(entries);
      const staging = `${destination}.staging-${randomUUID()}`;
      const fixedRoot = join(staging, 'root');
      try {
        await mkdir(fixedRoot, { recursive: true, mode: 0o700 });
        await mkdir(join(staging, 'temp'), { mode: 0o700 });
        await mkdir(join(staging, 'overlay'), { mode: 0o700 });
        const directories = new Set<string>([fixedRoot]);
        for (const entry of entries) {
          const target = join(fixedRoot, ...entry.path.split('/'));
          const parent = dirname(target);
          await mkdir(parent, { recursive: true, mode: 0o700 });
          let current = parent;
          while (current.startsWith(`${fixedRoot}${sep}`)) {
            directories.add(current);
            current = dirname(current);
          }
          const bytes = await options.revisionContent.open({ ...scope, path: entry.path });
          if (bytes.byteLength !== entry.sizeBytes
            || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
            throw new WorkspaceRevisionContentError('content_unavailable');
          }
          await writeFile(target, bytes, { flag: 'wx', mode: 0o400 });
          await chmod(target, 0o400);
        }
        for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
          await chmod(directory, 0o500);
        }
        const manifest: SandboxManifest = {
          schemaVersion: 1,
          environmentId: scope.environmentId,
          invocationId: scope.invocationId,
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          workingRootId: scope.workingRootId,
          revisionId: scope.revisionId,
          entries,
        };
        await writeFile(join(staging, manifestName), JSON.stringify(manifest), {
          flag: 'wx', mode: 0o400,
        });
        try {
          await rename(staging, destination);
        } catch {
          const existing = await loadManifest(options.storageRoot, scope.environmentId);
          if (!sameScope(existing, scope)) {
            throw new WorkspaceRevisionContentError('content_unavailable');
          }
        }
      } finally {
        await removeMaterialization(staging);
      }
    },

    async release({ environmentId }) {
      await removeMaterialization(environmentDirectory(options.storageRoot, environmentId));
    },

    async list(environmentId) {
      return (await loadManifest(options.storageRoot, environmentId)).entries;
    },

    async open(environmentId, path) {
      const canonical = canonicalPath(path);
      const manifest = await loadManifest(options.storageRoot, environmentId);
      const entry = manifest.entries.find((candidate) => candidate.path === canonical);
      if (!entry) throw new WorkspaceFileNotFoundError();
      const root = join(environmentDirectory(options.storageRoot, environmentId), 'root');
      const target = resolve(root, ...canonical.split('/'));
      try {
        const [resolvedRoot, resolvedTarget, stat] = await Promise.all([
          realpath(root), realpath(target), lstat(target),
        ]);
        if (relative(resolvedRoot, resolvedTarget).startsWith('..') || !stat.isFile()
          || stat.isSymbolicLink()) throw new WorkspaceFileNotFoundError();
        const bytes = await readFile(resolvedTarget);
        if (bytes.byteLength !== entry.sizeBytes
          || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
          throw new WorkspaceRevisionContentError('content_unavailable');
        }
        return bytes;
      } catch (error) {
        if (error instanceof WorkspaceRevisionContentError
          || error instanceof WorkspaceFileNotFoundError) throw error;
        throw new WorkspaceFileNotFoundError();
      }
    },
  };
}
