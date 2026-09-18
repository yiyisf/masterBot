import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ignore, { type Ignore } from 'ignore';
import type { OrganizationId } from '@cmaster/identity';
import type {
  WorkingRootId,
  WorkspaceId,
  WorkspaceRevisionId,
} from './workspace-types.js';

const executeFile = promisify(execFile);
const gitCommitPattern = /^[0-9a-f]{40,64}$/u;
const maximumReadableFileBytes = 1_048_576;
const maximumIndexedFiles = 10_000;
const maximumIndexedBytes = 64 * 1_048_576;

export interface WorkspaceFileEntry {
  readonly path: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface WorkspaceRevisionContentScope {
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly workingRootId: WorkingRootId;
  readonly revisionId: WorkspaceRevisionId;
  readonly source: { readonly kind: 'empty' } | {
    readonly kind: 'git';
    readonly commit: string;
  };
}

export interface WorkspaceRevisionContentReader {
  list(scope: WorkspaceRevisionContentScope): Promise<readonly WorkspaceFileEntry[]>;
  open(scope: WorkspaceRevisionContentScope & { readonly path: string }): Promise<Buffer>;
}

export class WorkspaceFileNotFoundError extends Error {}

export class WorkspaceRevisionContentError extends Error {
  constructor(readonly code: 'content_unavailable' | 'content_limit_exceeded') {
    super(code);
  }
}

interface GitTreeEntry {
  readonly mode: string;
  readonly path: string;
  readonly sizeBytes: number;
}

interface ScopedIgnore {
  readonly directory: string;
  readonly matcher: Ignore;
}

function canonicalRelativePath(value: string): boolean {
  return value.length > 0 && value.length <= 1024
    && value === value.normalize('NFC')
    && !value.startsWith('/')
    && !value.includes('\\')
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && value.split('/').every((segment) => segment.length > 0
      && segment !== '.' && segment !== '..');
}

function mediaType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'application/yaml';
  return 'text/plain';
}

function parseTree(output: string): GitTreeEntry[] {
  const entries: GitTreeEntry[] = [];
  for (const record of output.split('\0')) {
    if (record.length === 0) continue;
    const separator = record.indexOf('\t');
    if (separator < 0) throw new WorkspaceRevisionContentError('content_unavailable');
    const metadata = record.slice(0, separator).split(/\s+/u);
    const path = record.slice(separator + 1);
    const [mode, type, , size] = metadata;
    if (!mode || type !== 'blob' || !size || !canonicalRelativePath(path)) continue;
    const sizeBytes = Number(size);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    // Symbolic links use 120000 and Gitlinks use 160000; neither is readable Workspace content.
    if (mode !== '100644' && mode !== '100755') continue;
    entries.push({ mode, path, sizeBytes });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function relativeTo(directory: string, path: string): string | undefined {
  if (directory.length === 0) return path;
  const prefix = `${directory}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}

function isIgnored(path: string, rules: readonly ScopedIgnore[]): boolean {
  return rules.some(({ directory, matcher }) => {
    const relative = relativeTo(directory, path);
    return relative !== undefined && matcher.ignores(relative);
  });
}

async function readGitBlob(
  repositoryPath: string,
  commit: string,
  path: string,
  maximumBytes = maximumReadableFileBytes,
): Promise<Buffer> {
  try {
    const { stdout } = await executeFile('git', [
      '--git-dir', repositoryPath, 'cat-file', 'blob', `${commit}:${path}`,
    ], { encoding: 'buffer', maxBuffer: maximumBytes + 1 });
    if (stdout.length > maximumBytes) {
      throw new WorkspaceRevisionContentError('content_limit_exceeded');
    }
    return stdout;
  } catch (error) {
    if (error instanceof WorkspaceRevisionContentError) throw error;
    throw new WorkspaceFileNotFoundError();
  }
}

async function buildIgnoreRules(
  repositoryPath: string,
  commit: string,
  tree: readonly GitTreeEntry[],
): Promise<ScopedIgnore[]> {
  const candidates = tree.filter(({ path }) => (
    path === '.cmasterignore' || path.endsWith('/.gitignore') || path === '.gitignore'
  ));
  const rules: ScopedIgnore[] = [];
  for (const candidate of candidates) {
    if (candidate.sizeBytes > 65_536) {
      throw new WorkspaceRevisionContentError('content_limit_exceeded');
    }
    let contents: string;
    try {
      contents = new TextDecoder('utf-8', { fatal: true }).decode(
        await readGitBlob(repositoryPath, commit, candidate.path, 65_536),
      );
    } catch (error) {
      if (error instanceof WorkspaceRevisionContentError) throw error;
      throw new WorkspaceRevisionContentError('content_unavailable');
    }
    const directory = candidate.path.includes('/')
      ? candidate.path.slice(0, candidate.path.lastIndexOf('/'))
      : '';
    // .cmasterignore is intentionally root-scoped; nested files do not create a second policy layer.
    if (candidate.path.endsWith('.cmasterignore') && candidate.path !== '.cmasterignore') continue;
    rules.push({ directory, matcher: ignore().add(contents) });
  }
  return rules;
}

export function createConfiguredWorkspaceRevisionContentReader(options: {
  readonly storageRoot: string;
}): WorkspaceRevisionContentReader {
  const metadataCache = new Map<string, readonly WorkspaceFileEntry[]>();
  return {
    async list(scope) {
      if (scope.source.kind === 'empty') return [];
      const cacheKey = `${scope.organizationId}:${scope.workspaceId}:${scope.source.commit}`;
      const cached = metadataCache.get(cacheKey);
      if (cached) return cached;
      if (!gitCommitPattern.test(scope.source.commit)) {
        throw new WorkspaceRevisionContentError('content_unavailable');
      }
      const repositoryPath = join(
        options.storageRoot, scope.organizationId, scope.workspaceId, 'repository.git',
      );
      let tree: GitTreeEntry[];
      try {
        const { stdout } = await executeFile('git', [
          '--git-dir', repositoryPath, 'ls-tree', '-r', '-z', '-l', scope.source.commit,
        ], { encoding: 'utf8', maxBuffer: 16 * 1_048_576 });
        tree = parseTree(stdout);
      } catch (error) {
        if (error instanceof WorkspaceRevisionContentError) throw error;
        throw new WorkspaceRevisionContentError('content_unavailable');
      }
      if (tree.length > maximumIndexedFiles) {
        throw new WorkspaceRevisionContentError('content_limit_exceeded');
      }
      const rules = await buildIgnoreRules(repositoryPath, scope.source.commit, tree);
      const visible = tree.filter(({ path }) => !isIgnored(path, rules));
      let indexedBytes = 0;
      const entries: WorkspaceFileEntry[] = [];
      for (const file of visible) {
        if (file.sizeBytes > maximumReadableFileBytes) continue;
        indexedBytes += file.sizeBytes;
        if (indexedBytes > maximumIndexedBytes) {
          throw new WorkspaceRevisionContentError('content_limit_exceeded');
        }
        const content = await readGitBlob(repositoryPath, scope.source.commit, file.path);
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(content);
        } catch {
          continue;
        }
        entries.push({
          path: file.path,
          mediaType: mediaType(file.path),
          sizeBytes: content.length,
          sha256: createHash('sha256').update(content).digest('hex'),
        });
      }
      if (metadataCache.size >= 100) {
        const oldest = metadataCache.keys().next().value as string | undefined;
        if (oldest) metadataCache.delete(oldest);
      }
      metadataCache.set(cacheKey, entries);
      return entries;
    },

    async open(request) {
      if (!canonicalRelativePath(request.path)) throw new WorkspaceFileNotFoundError();
      const entry = (await this.list(request)).find((candidate) => candidate.path === request.path);
      if (!entry || request.source.kind === 'empty') throw new WorkspaceFileNotFoundError();
      const repositoryPath = join(
        options.storageRoot, request.organizationId, request.workspaceId, 'repository.git',
      );
      const content = await readGitBlob(
        repositoryPath, request.source.commit, request.path, maximumReadableFileBytes,
      );
      if (createHash('sha256').update(content).digest('hex') !== entry.sha256) {
        throw new WorkspaceRevisionContentError('content_unavailable');
      }
      return content;
    },
  };
}
