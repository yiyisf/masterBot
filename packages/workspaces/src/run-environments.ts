import { createHash, randomUUID } from 'node:crypto';
import type { RequestIdentity } from '@cmaster/identity';
import type { Brand, Clock } from '@cmaster/kernel';
import { SystemClock } from '@cmaster/kernel';
import type { Pool } from 'pg';
import type {
  WorkspaceFileContent,
  WorkspaceFilePage,
  WorkspaceFileSearchPage,
} from './index.js';
import {
  InvalidWorkspaceCursorError,
  InvalidWorkspaceFileQueryError,
  InvalidWorkspacePageLimitError,
  WorkspaceFileContentUnavailableError,
  WorkspaceNotFoundError,
  type WorkingRootId,
  type WorkspaceId,
  type WorkspaceRevisionId,
} from './workspace-types.js';
import {
  WorkspaceFileNotFoundError,
  type WorkspaceFileEntry,
  type WorkspaceRevisionContentScope,
} from './revision-content.js';

export type WorkspaceRunEnvironmentId = Brand<string, 'WorkspaceRunEnvironmentId'>;
export type WorkspaceInvocationId = Brand<string, 'WorkspaceInvocationId'>;

export function workspaceInvocationId(value: string): WorkspaceInvocationId {
  return value as WorkspaceInvocationId;
}

export interface WorkspaceRunEnvironment {
  readonly id: WorkspaceRunEnvironmentId;
  readonly invocationId: WorkspaceInvocationId;
  readonly workspaceId: WorkspaceId;
  readonly workingRootId: WorkingRootId;
  readonly revisionId: WorkspaceRevisionId;
  readonly status: 'preparing' | 'prepared' | 'released';
  readonly preparedAt?: Date;
  readonly releasedAt?: Date;
}

export interface PrepareWorkspaceRunEnvironment {
  readonly invocationId: WorkspaceInvocationId;
  readonly workspaceId: WorkspaceId;
  readonly workingRootId: WorkingRootId;
  readonly revisionId: WorkspaceRevisionId;
}

export interface WorkspaceSandboxScope extends WorkspaceRevisionContentScope {
  readonly environmentId: WorkspaceRunEnvironmentId;
  readonly invocationId: WorkspaceInvocationId;
}

/** Internal durable-content Adapter. Implementations are idempotent by environmentId. */
export interface WorkspaceSandboxAdapter {
  prepare(scope: WorkspaceSandboxScope): Promise<void>;
  release(scope: { readonly environmentId: WorkspaceRunEnvironmentId }): Promise<void>;
  list(environmentId: WorkspaceRunEnvironmentId): Promise<readonly WorkspaceFileEntry[]>;
  open(environmentId: WorkspaceRunEnvironmentId, path: string): Promise<Buffer>;
}

/**
 * Owns the opaque, Principal-private binding from one Invocation to one immutable
 * Workspace Revision. Storage and host paths never cross this package-root seam.
 */
export interface WorkspaceRunEnvironments {
  prepare(
    identity: RequestIdentity,
    request: PrepareWorkspaceRunEnvironment,
  ): Promise<WorkspaceRunEnvironment>;
  get(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
  ): Promise<WorkspaceRunEnvironment>;
  listFiles(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
    query: { readonly cursor?: string; readonly limit: number },
  ): Promise<WorkspaceFilePage>;
  openFile(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
    path: string,
  ): Promise<WorkspaceFileContent>;
  searchFiles(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
    query: { readonly query: string; readonly cursor?: string; readonly limit: number },
  ): Promise<WorkspaceFileSearchPage>;
  release(identity: RequestIdentity, invocationId: WorkspaceInvocationId): Promise<void>;
}

export class WorkspaceRunEnvironmentUnavailableError extends Error {}

interface RunEnvironmentRow {
  readonly id: string;
  readonly owner_principal_id: string;
  readonly invocation_id: string;
  readonly workspace_id: string;
  readonly working_root_id: string;
  readonly revision_id: string;
  readonly status: WorkspaceRunEnvironment['status'];
  readonly prepared_at: Date | null;
  readonly released_at: Date | null;
}

interface RevisionScopeRow {
  readonly source_kind: 'empty' | 'git';
  readonly git_commit_sha: string | null;
}

function mapEnvironment(row: RunEnvironmentRow): WorkspaceRunEnvironment {
  return {
    id: row.id as WorkspaceRunEnvironmentId,
    invocationId: row.invocation_id as WorkspaceInvocationId,
    workspaceId: row.workspace_id as WorkspaceId,
    workingRootId: row.working_root_id as WorkingRootId,
    revisionId: row.revision_id as WorkspaceRevisionId,
    status: row.status,
    ...(row.prepared_at ? { preparedAt: row.prepared_at } : {}),
    ...(row.released_at ? { releasedAt: row.released_at } : {}),
  };
}

function decodeCursor(value: string): string {
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new InvalidWorkspaceCursorError();
    const parsed: unknown = JSON.parse(decoded.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length !== 1
      || !('path' in parsed) || typeof parsed.path !== 'string') {
      throw new InvalidWorkspaceCursorError();
    }
    return parsed.path;
  } catch (error) {
    if (error instanceof InvalidWorkspaceCursorError) throw error;
    throw new InvalidWorkspaceCursorError();
  }
}

function encodeCursor(path: string): string {
  return Buffer.from(JSON.stringify({ path }), 'utf8').toString('base64url');
}

interface SearchCursor {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

function decodeSearchCursor(value: string): SearchCursor {
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new InvalidWorkspaceCursorError();
    const parsed: unknown = JSON.parse(decoded.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length !== 3
      || !('path' in parsed) || typeof parsed.path !== 'string'
      || !('line' in parsed) || typeof parsed.line !== 'number'
      || !Number.isInteger(parsed.line) || parsed.line < 1
      || !('column' in parsed) || typeof parsed.column !== 'number'
      || !Number.isInteger(parsed.column) || parsed.column < 1) {
      throw new InvalidWorkspaceCursorError();
    }
    return { path: parsed.path, line: parsed.line as number, column: parsed.column as number };
  } catch (error) {
    if (error instanceof InvalidWorkspaceCursorError) throw error;
    throw new InvalidWorkspaceCursorError();
  }
}

function matchPosition(content: string, offset: number): { readonly line: number; readonly column: number } {
  const before = content.slice(0, offset);
  const lineStart = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length,
    column: offset - lineStart,
  };
}

function contentSource(row: RevisionScopeRow): WorkspaceRevisionContentScope['source'] {
  return row.source_kind === 'empty'
    ? { kind: 'empty' }
    : { kind: 'git', commit: row.git_commit_sha! };
}

export class PostgresWorkspaceRunEnvironments implements WorkspaceRunEnvironments {
  private readonly clock: Clock;
  private readonly generateId: () => string;
  private readonly sandbox: WorkspaceSandboxAdapter;

  constructor(
    private readonly pool: Pool,
    options: {
      readonly clock?: Clock;
      readonly generateId?: () => string;
      readonly sandbox: WorkspaceSandboxAdapter;
    },
  ) {
    this.clock = options.clock ?? new SystemClock();
    this.generateId = options.generateId ?? randomUUID;
    this.sandbox = options.sandbox;
  }

  async prepare(
    identity: RequestIdentity,
    request: PrepareWorkspaceRunEnvironment,
  ): Promise<WorkspaceRunEnvironment> {
    const client = await this.pool.connect();
    const lockKey = `workspace-environment:${identity.organizationId}:${request.invocationId}`;
    let transactionStarted = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
      await client.query('BEGIN');
      transactionStarted = true;
      const scope = await client.query<RevisionScopeRow>(
        `SELECT w.source_kind, v.git_commit_sha
         FROM workspaces w
         JOIN workspace_roots r
           ON r.organization_id = w.organization_id AND r.workspace_id = w.id
         JOIN workspace_revisions v
           ON v.organization_id = r.organization_id AND v.working_root_id = r.id
         WHERE w.organization_id = $1 AND w.owner_principal_id = $2
           AND w.id = $3 AND r.id = $4 AND v.id = $5
           AND w.lifecycle_status = 'ready'
         FOR SHARE OF w, r, v`,
        [identity.organizationId, identity.principalId, request.workspaceId,
          request.workingRootId, request.revisionId],
      );
      const revision = scope.rows[0];
      if (!revision) throw new WorkspaceNotFoundError();

      const existing = await client.query<RunEnvironmentRow>(
        `SELECT id, owner_principal_id, invocation_id, workspace_id, working_root_id,
                revision_id, status, prepared_at, released_at
         FROM workspace_run_environments
         WHERE organization_id = $1 AND invocation_id = $2
         FOR UPDATE`,
        [identity.organizationId, request.invocationId],
      );
      let row = existing.rows[0];
      if (row) {
        if (row.owner_principal_id !== identity.principalId
          || row.workspace_id !== request.workspaceId
          || row.working_root_id !== request.workingRootId
          || row.revision_id !== request.revisionId
          || row.status === 'released') {
          throw new WorkspaceNotFoundError();
        }
      } else {
        const id = this.generateId() as WorkspaceRunEnvironmentId;
        const inserted = await client.query<RunEnvironmentRow>(
          `INSERT INTO workspace_run_environments (
             id, organization_id, invocation_id, owner_principal_id,
             workspace_id, working_root_id, revision_id, status, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'preparing', $8)
           RETURNING id, owner_principal_id, invocation_id, workspace_id, working_root_id,
                     revision_id, status, prepared_at, released_at`,
          [id, identity.organizationId, request.invocationId, identity.principalId,
            request.workspaceId, request.workingRootId, request.revisionId, this.clock.now()],
        );
        row = inserted.rows[0];
        if (!row) throw new Error('Workspace Run Environment was not persisted');
      }
      await client.query('COMMIT');
      transactionStarted = false;
      if (row.status === 'prepared') return mapEnvironment(row);

      try {
        await this.sandbox.prepare({
          environmentId: row.id as WorkspaceRunEnvironmentId,
          invocationId: request.invocationId,
          organizationId: identity.organizationId,
          workspaceId: request.workspaceId,
          workingRootId: request.workingRootId,
          revisionId: request.revisionId,
          source: contentSource(revision),
        });
      } catch {
        throw new WorkspaceRunEnvironmentUnavailableError();
      }
      const prepared = await client.query<RunEnvironmentRow>(
        `UPDATE workspace_run_environments SET status = 'prepared', prepared_at = $4
         WHERE organization_id = $1 AND owner_principal_id = $2
           AND invocation_id = $3 AND status = 'preparing'
         RETURNING id, owner_principal_id, invocation_id, workspace_id, working_root_id,
                   revision_id, status, prepared_at, released_at`,
        [identity.organizationId, identity.principalId, request.invocationId, this.clock.now()],
      );
      const preparedRow = prepared.rows[0];
      if (!preparedRow) throw new WorkspaceRunEnvironmentUnavailableError();
      return mapEnvironment(preparedRow);
    } catch (error) {
      if (transactionStarted) await client.query('ROLLBACK');
      throw error;
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
      } finally {
        client.release();
      }
    }
  }

  async get(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
  ): Promise<WorkspaceRunEnvironment> {
    const result = await this.pool.query<RunEnvironmentRow>(
      `SELECT id, owner_principal_id, invocation_id, workspace_id, working_root_id,
              revision_id, status, prepared_at, released_at
       FROM workspace_run_environments
       WHERE organization_id = $1 AND owner_principal_id = $2 AND invocation_id = $3`,
      [identity.organizationId, identity.principalId, invocationId],
    );
    const row = result.rows[0];
    if (!row) throw new WorkspaceNotFoundError();
    return mapEnvironment(row);
  }

  async listFiles(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
    query: { readonly cursor?: string; readonly limit: number },
  ): Promise<WorkspaceFilePage> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
      throw new InvalidWorkspacePageLimitError();
    }
    const environment = await this.preparedEnvironment(identity, invocationId);
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    let entries: readonly WorkspaceFileEntry[];
    try {
      entries = await this.sandbox.list(environment.id);
    } catch {
      throw new WorkspaceRunEnvironmentUnavailableError();
    }
    const visible = entries.filter((entry) => after === undefined || entry.path > after)
      .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const items = visible.slice(0, query.limit);
    return visible.length > query.limit && items.length > 0
      ? { items, nextCursor: encodeCursor(items.at(-1)!.path) }
      : { items };
  }

  async openFile(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
    path: string,
  ): Promise<WorkspaceFileContent> {
    const environment = await this.preparedEnvironment(identity, invocationId);
    let entries: readonly WorkspaceFileEntry[];
    try {
      entries = await this.sandbox.list(environment.id);
    } catch {
      throw new WorkspaceRunEnvironmentUnavailableError();
    }
    const entry = entries.find((candidate) => candidate.path === path);
    if (!entry) throw new WorkspaceNotFoundError();
    return this.openEnvironmentFile(environment, entry);
  }

  async searchFiles(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
    query: { readonly query: string; readonly cursor?: string; readonly limit: number },
  ): Promise<WorkspaceFileSearchPage> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50) {
      throw new InvalidWorkspacePageLimitError();
    }
    if (query.query.length < 1 || query.query.length > 200
      || /[\u0000-\u001f\u007f]/u.test(query.query)) {
      throw new InvalidWorkspaceFileQueryError();
    }
    const environment = await this.preparedEnvironment(identity, invocationId);
    const cursor = query.cursor ? decodeSearchCursor(query.cursor) : undefined;
    let entries: readonly WorkspaceFileEntry[];
    try {
      entries = await this.sandbox.list(environment.id);
    } catch {
      throw new WorkspaceRunEnvironmentUnavailableError();
    }
    const matches: Array<{
      path: string; line: number; column: number; preview: string;
    }> = [];
    let searchedBytes = 0;
    for (const entry of [...entries].sort((left, right) => (
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    ))
      .slice(0, 1_000)) {
      searchedBytes += entry.sizeBytes;
      if (searchedBytes > 8 * 1_048_576) break;
      const file = await this.openEnvironmentFile(environment, entry);
      let from = 0;
      while (matches.length <= query.limit) {
        const found = file.content.indexOf(query.query, from);
        if (found < 0) break;
        const position = matchPosition(file.content, found);
        const afterCursor = !cursor || entry.path > cursor.path
          || (entry.path === cursor.path && (position.line > cursor.line
            || (position.line === cursor.line && position.column > cursor.column)));
        if (afterCursor) {
          const line = file.content.split('\n')[position.line - 1] ?? '';
          matches.push({
            path: entry.path,
            line: position.line,
            column: position.column,
            preview: line.slice(0, 500),
          });
        }
        from = found + Math.max(1, query.query.length);
      }
      if (matches.length > query.limit) break;
    }
    const items = matches.slice(0, query.limit);
    const last = items.at(-1);
    return matches.length > query.limit && last
      ? {
        items,
        nextCursor: Buffer.from(JSON.stringify({
          path: last.path, line: last.line, column: last.column,
        }), 'utf8').toString('base64url'),
      }
      : { items };
  }

  async release(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
  ): Promise<void> {
    const client = await this.pool.connect();
    const lockKey = `workspace-environment:${identity.organizationId}:${invocationId}`;
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
      const environment = await this.get(identity, invocationId);
      if (environment.status === 'released') return;
      try {
        await this.sandbox.release({ environmentId: environment.id });
      } catch {
        throw new WorkspaceRunEnvironmentUnavailableError();
      }
      await client.query(
        `UPDATE workspace_run_environments
         SET status = 'released', released_at = $4
         WHERE organization_id = $1 AND owner_principal_id = $2 AND invocation_id = $3`,
        [identity.organizationId, identity.principalId, invocationId, this.clock.now()],
      );
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
      } finally {
        client.release();
      }
    }
  }

  private async openEnvironmentFile(
    environment: WorkspaceRunEnvironment,
    entry: WorkspaceFileEntry,
  ): Promise<WorkspaceFileContent> {
    try {
      const bytes = await this.sandbox.open(environment.id, entry.path);
      if (bytes.byteLength !== entry.sizeBytes
        || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
        throw new WorkspaceFileContentUnavailableError();
      }
      return {
        ...entry,
        encoding: 'utf8',
        content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      };
    } catch (error) {
      if (error instanceof WorkspaceFileNotFoundError) throw new WorkspaceNotFoundError();
      if (error instanceof WorkspaceFileContentUnavailableError) throw error;
      throw new WorkspaceFileContentUnavailableError();
    }
  }

  private async preparedEnvironment(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
  ): Promise<WorkspaceRunEnvironment> {
    const environment = await this.get(identity, invocationId);
    if (environment.status !== 'prepared') {
      throw new WorkspaceRunEnvironmentUnavailableError();
    }
    return environment;
  }
}
