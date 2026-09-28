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
  type WorkspaceOverlayEntry,
  type WorkspaceOverlayCommandResult,
  type WorkspaceRunEnvironmentId,
  type WorkspaceSandboxAdapter,
  type WorkspaceSandboxOverlayCommand,
  type WorkspaceSandboxScope,
} from './run-environments.js';
import { WorkspaceIdempotencyConflictError } from './workspace-types.js';
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
const overlayManifestName = 'overlay-manifest.json';
const maximumOverlayEntries = 100;
const maximumOverlayBytes = 8 * 1024 * 1024;
const maximumOverlayReceipts = 1_000;

interface SandboxManifest {
  readonly schemaVersion: 1;
  readonly environmentId: string;
  readonly invocationId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly workingRootId: string;
  readonly revisionId: string;
  readonly source: WorkspaceSandboxScope['source'];
  readonly overlayInitialized: boolean;
  readonly entries: readonly WorkspaceFileEntry[];
}

interface OverlayReceipt {
  readonly commandId: string;
  readonly requestHash: string;
  readonly value: WorkspaceOverlayEntry | null;
}

interface OverlayManifest {
  readonly schemaVersion: 1;
  readonly environmentId: string;
  readonly entries: readonly WorkspaceOverlayEntry[];
  readonly receipts: readonly OverlayReceipt[];
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
    || !('source' in value) || !value.source || typeof value.source !== 'object'
    || !('kind' in value.source)
    || (value.source.kind !== 'empty' && value.source.kind !== 'snapshot'
      && (value.source.kind !== 'git' || !('commit' in value.source)
        || typeof value.source.commit !== 'string'))
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
    source: value.source as WorkspaceSandboxScope['source'],
    overlayInitialized: 'overlayInitialized' in value && value.overlayInitialized === true,
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
    && manifest.revisionId === scope.revisionId
    && JSON.stringify(manifest.source) === JSON.stringify(scope.source);
}

function parseOverlayEntry(value: unknown): WorkspaceOverlayEntry {
  if (!value || typeof value !== 'object'
    || !('kind' in value) || (value.kind !== 'write' && value.kind !== 'delete')
    || !('path' in value) || typeof value.path !== 'string') {
    throw new WorkspaceRevisionContentError('content_unavailable');
  }
  const path = canonicalPath(value.path);
  if (value.kind === 'delete') return { kind: 'delete', path };
  if (!('mediaType' in value) || typeof value.mediaType !== 'string'
    || value.mediaType.length < 1 || value.mediaType.length > 100
    || !('sizeBytes' in value) || typeof value.sizeBytes !== 'number'
    || !Number.isInteger(value.sizeBytes) || value.sizeBytes < 0
    || value.sizeBytes > maximumFileBytes
    || !('sha256' in value) || typeof value.sha256 !== 'string'
    || !hashPattern.test(value.sha256)) {
    throw new WorkspaceRevisionContentError('content_unavailable');
  }
  return {
    kind: 'write', path, mediaType: value.mediaType,
    sizeBytes: value.sizeBytes, sha256: value.sha256,
  };
}

function parseOverlayManifest(
  value: unknown,
  expectedId: WorkspaceRunEnvironmentId,
): OverlayManifest {
  if (!value || typeof value !== 'object'
    || !('schemaVersion' in value) || value.schemaVersion !== 1
    || !('environmentId' in value) || value.environmentId !== expectedId
    || !('entries' in value) || !Array.isArray(value.entries)
    || !('receipts' in value) || !Array.isArray(value.receipts)
    || value.entries.length > maximumOverlayEntries
    || value.receipts.length > maximumOverlayReceipts) {
    throw new WorkspaceRevisionContentError('content_unavailable');
  }
  const paths = new Set<string>();
  const entries = value.entries.map((entry): WorkspaceOverlayEntry => {
    const parsed = parseOverlayEntry(entry);
    if (paths.has(parsed.path)) throw new WorkspaceRevisionContentError('content_unavailable');
    paths.add(parsed.path);
    return parsed;
  });
  if (entries.reduce((total, entry) => total + (entry.kind === 'write' ? entry.sizeBytes : 0), 0)
    > maximumOverlayBytes) {
    throw new WorkspaceRevisionContentError('content_unavailable');
  }
  const receipts = value.receipts.map((receipt): OverlayReceipt => {
    if (!receipt || typeof receipt !== 'object'
      || !('commandId' in receipt) || typeof receipt.commandId !== 'string'
      || !identifierPattern.test(receipt.commandId)
      || !('requestHash' in receipt) || typeof receipt.requestHash !== 'string'
      || !hashPattern.test(receipt.requestHash)
      || !('value' in receipt)) {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    return {
      commandId: receipt.commandId,
      requestHash: receipt.requestHash,
      value: receipt.value === null ? null : parseOverlayEntry(receipt.value),
    };
  });
  if (new Set(receipts.map(({ commandId }) => commandId)).size !== receipts.length) {
    throw new WorkspaceRevisionContentError('content_unavailable');
  }
  return {
    schemaVersion: 1,
    environmentId: expectedId,
    entries: entries.sort((left, right) => left.path < right.path ? -1 : 1),
    receipts,
  };
}

async function loadOverlayManifest(
  storageRoot: string,
  environmentId: WorkspaceRunEnvironmentId,
): Promise<OverlayManifest> {
  try {
    const value: unknown = JSON.parse(await readFile(join(
      environmentDirectory(storageRoot, environmentId), 'overlay', overlayManifestName,
    ), 'utf8'));
    return parseOverlayManifest(value, environmentId);
  } catch (error) {
    if (error instanceof WorkspaceRevisionContentError) throw error;
    throw new WorkspaceFileNotFoundError();
  }
}

function overlayRequestHash(command: WorkspaceSandboxOverlayCommand): string {
  return createHash('sha256').update(JSON.stringify(command.kind === 'delete'
    ? { kind: command.kind, path: command.path }
    : {
      kind: command.kind,
      path: command.path,
      mediaType: command.mediaType,
      sizeBytes: command.bytes.byteLength,
      sha256: createHash('sha256').update(command.bytes).digest('hex'),
    })).digest('hex');
}

async function persistOverlayManifest(
  storageRoot: string,
  environmentId: WorkspaceRunEnvironmentId,
  manifest: OverlayManifest,
): Promise<void> {
  const overlay = join(environmentDirectory(storageRoot, environmentId), 'overlay');
  const staging = join(overlay, `.manifest-${randomUUID()}`);
  try {
    await writeFile(staging, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
    await rename(staging, join(overlay, overlayManifestName));
  } finally {
    await rm(staging, { force: true });
  }
}

async function persistOverlayBlob(
  storageRoot: string,
  environmentId: WorkspaceRunEnvironmentId,
  sha256: string,
  bytes: Buffer,
): Promise<void> {
  const directory = join(environmentDirectory(storageRoot, environmentId), 'overlay', 'blobs');
  const destination = join(directory, sha256);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const existing = await readFile(destination);
    if (existing.byteLength !== bytes.byteLength
      || createHash('sha256').update(existing).digest('hex') !== sha256) {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (error instanceof WorkspaceRevisionContentError) throw error;
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
  }
  const staging = `${destination}.${randomUUID()}`;
  try {
    await writeFile(staging, bytes, { flag: 'wx', mode: 0o400 });
    try {
      await rename(staging, destination);
    } catch {
      const existing = await readFile(destination);
      if (existing.byteLength !== bytes.byteLength
        || createHash('sha256').update(existing).digest('hex') !== sha256) {
        throw new WorkspaceRevisionContentError('content_unavailable');
      }
    }
  } finally {
    await rm(staging, { force: true });
  }
}

async function readOverlayBlob(
  storageRoot: string,
  environmentId: WorkspaceRunEnvironmentId,
  entry: Extract<WorkspaceOverlayEntry, { readonly kind: 'write' }>,
): Promise<Buffer> {
  try {
    const path = join(environmentDirectory(storageRoot, environmentId),
      'overlay', 'blobs', entry.sha256);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    const bytes = await readFile(path);
    if (bytes.byteLength !== entry.sizeBytes
      || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    return bytes;
  } catch (error) {
    if (error instanceof WorkspaceRevisionContentError) throw error;
    throw new WorkspaceFileNotFoundError();
  }
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
      let existing: SandboxManifest | undefined;
      try {
        existing = await loadManifest(options.storageRoot, scope.environmentId);
      } catch (error) {
        if (!(error instanceof WorkspaceFileNotFoundError)) throw error;
      }
      if (existing) {
        if (!sameScope(existing, scope)) {
          throw new WorkspaceRevisionContentError('content_unavailable');
        }
        if (existing.overlayInitialized) {
          await loadOverlayManifest(options.storageRoot, scope.environmentId);
        } else {
          const legacyOverlay: OverlayManifest = {
            schemaVersion: 1,
            environmentId: scope.environmentId,
            entries: [],
            receipts: [],
          };
          try {
            await writeFile(join(destination, 'overlay', overlayManifestName),
              JSON.stringify(legacyOverlay), { flag: 'wx', mode: 0o600 });
          } catch {
            await loadOverlayManifest(options.storageRoot, scope.environmentId);
          }
        }
        return;
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
          source: scope.source,
          overlayInitialized: true,
          entries,
        };
        await writeFile(join(staging, manifestName), JSON.stringify(manifest), {
          flag: 'wx', mode: 0o400,
        });
        const overlayManifest: OverlayManifest = {
          schemaVersion: 1,
          environmentId: scope.environmentId,
          entries: [],
          receipts: [],
        };
        await writeFile(join(staging, 'overlay', overlayManifestName),
          JSON.stringify(overlayManifest), { flag: 'wx', mode: 0o600 });
        try {
          await rename(staging, destination);
        } catch {
          const existing = await loadManifest(options.storageRoot, scope.environmentId);
          if (!sameScope(existing, scope)) {
            throw new WorkspaceRevisionContentError('content_unavailable');
          }
          await loadOverlayManifest(options.storageRoot, scope.environmentId);
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

    async mutateOverlay(scope, command): Promise<WorkspaceOverlayCommandResult> {
      const { environmentId } = scope;
      assertIdentifier(command.commandId);
      const path = canonicalPath(command.path);
      const request: WorkspaceSandboxOverlayCommand = command.kind === 'delete'
        ? { commandId: command.commandId, kind: 'delete', path }
        : {
          commandId: command.commandId,
          kind: 'write',
          path,
          mediaType: command.mediaType,
          bytes: command.bytes,
        };
      const requestHash = overlayRequestHash(request);
      const overlay = await loadOverlayManifest(options.storageRoot, environmentId);
      const receipt = overlay.receipts.find(({ commandId }) => commandId === command.commandId);
      if (receipt) {
        if (receipt.requestHash !== requestHash) throw new WorkspaceIdempotencyConflictError();
        return { value: receipt.value, replayed: true };
      }
      if (overlay.receipts.length >= maximumOverlayReceipts) {
        throw new WorkspaceRevisionContentError('content_limit_exceeded');
      }
      const fixed = await loadManifest(options.storageRoot, environmentId);
      if (!sameScope(fixed, scope)) {
        throw new WorkspaceRevisionContentError('content_unavailable');
      }
      if (!await options.revisionContent.isPathVisible(scope, path)) {
        throw new WorkspaceFileNotFoundError();
      }
      const baseEntry = fixed.entries.find((entry) => entry.path === path);
      const entries = new Map(overlay.entries.map((entry) => [entry.path, entry]));
      let value: WorkspaceOverlayEntry | null;
      if (request.kind === 'write') {
        if ([...entries.values()].some((entry) => entry.path !== path
          && (entry.path.startsWith(`${path}/`) || path.startsWith(`${entry.path}/`)))) {
          throw new WorkspaceFileNotFoundError();
        }
        if (request.bytes.byteLength > maximumFileBytes
          || request.mediaType.length < 1 || request.mediaType.length > 100) {
          throw new WorkspaceRevisionContentError('content_limit_exceeded');
        }
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(request.bytes);
        } catch {
          throw new WorkspaceRevisionContentError('content_unavailable');
        }
        if (!baseEntry && await options.revisionContent.pathExists(scope, path)) {
          throw new WorkspaceFileNotFoundError();
        }
        const sha256 = createHash('sha256').update(request.bytes).digest('hex');
        await persistOverlayBlob(options.storageRoot, environmentId, sha256, request.bytes);
        value = {
          kind: 'write', path, mediaType: request.mediaType,
          sizeBytes: request.bytes.byteLength, sha256,
        };
        entries.set(path, value);
      } else {
        const current = entries.get(path);
        if (!baseEntry && current?.kind !== 'write') throw new WorkspaceFileNotFoundError();
        if (!baseEntry) {
          entries.delete(path);
          value = null;
        } else {
          value = { kind: 'delete', path };
          entries.set(path, value);
        }
      }
      if (entries.size > maximumOverlayEntries
        || [...entries.values()].reduce(
          (total, entry) => total + (entry.kind === 'write' ? entry.sizeBytes : 0), 0,
        ) > maximumOverlayBytes) {
        throw new WorkspaceRevisionContentError('content_limit_exceeded');
      }
      const next: OverlayManifest = {
        schemaVersion: 1,
        environmentId,
        entries: [...entries.values()].sort((left, right) => left.path < right.path ? -1 : 1),
        receipts: [...overlay.receipts, {
          commandId: command.commandId,
          requestHash,
          value,
        }],
      };
      await persistOverlayManifest(options.storageRoot, environmentId, next);
      return { value, replayed: false };
    },

    async listOverlay(environmentId) {
      const overlay = await loadOverlayManifest(options.storageRoot, environmentId);
      return { items: overlay.entries };
    },

    async snapshotOverlay(scope) {
      const { environmentId } = scope;
      const [fixed, overlay] = await Promise.all([
        loadManifest(options.storageRoot, environmentId),
        loadOverlayManifest(options.storageRoot, environmentId),
      ]);
      if (!sameScope(fixed, scope)) {
        throw new WorkspaceRevisionContentError('content_unavailable');
      }
      const baseEntries = new Map(fixed.entries.map((entry) => [entry.path, entry]));
      return {
        entries: await Promise.all(overlay.entries.map(async (entry) => {
          if (entry.kind === 'delete') return entry;
          const baseEntry = baseEntries.get(entry.path);
          return {
            ...entry,
            baseExists: baseEntry !== undefined,
            ...(baseEntry ? { baseSha256: baseEntry.sha256 } : {}),
            bytes: await readOverlayBlob(options.storageRoot, environmentId, entry),
          };
        })),
      };
    },
  };
}
