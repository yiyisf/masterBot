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
  WorkspaceOperationModeDeniedError,
  type WorkspaceChangeCommandId,
  type WorkspaceChangeCommandResult,
  type WorkspaceChangeInput,
  type WorkspaceChanges,
} from './change-sets.js';
import {
  InvalidWorkspaceCursorError,
  InvalidWorkspaceFileQueryError,
  InvalidWorkspacePageLimitError,
  WorkspaceFileContentUnavailableError,
  WorkspaceIdempotencyConflictError,
  WorkspaceNotFoundError,
  type WorkingRootId,
  type WorkspaceId,
  type WorkspaceOperationMode,
  type WorkspaceRevisionId,
} from './workspace-types.js';
import {
  WorkspaceFileNotFoundError,
  type WorkspaceFileEntry,
  type WorkspaceRevisionContentScope,
} from './revision-content.js';

export type WorkspaceRunEnvironmentId = Brand<string, 'WorkspaceRunEnvironmentId'>;
export type WorkspaceInvocationId = Brand<string, 'WorkspaceInvocationId'>;
export type WorkspaceOverlayCommandId = Brand<string, 'WorkspaceOverlayCommandId'>;

export function workspaceOverlayCommandId(value: string): WorkspaceOverlayCommandId {
  return value as WorkspaceOverlayCommandId;
}

export function workspaceInvocationId(value: string): WorkspaceInvocationId {
  return value as WorkspaceInvocationId;
}

export interface WorkspaceRunEnvironment {
  readonly id: WorkspaceRunEnvironmentId;
  readonly invocationId: WorkspaceInvocationId;
  readonly workspaceId: WorkspaceId;
  readonly workingRootId: WorkingRootId;
  readonly revisionId: WorkspaceRevisionId;
  readonly maximumOperationMode: WorkspaceOperationMode;
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

export type WorkspaceOverlayEntry =
  | {
    readonly kind: 'write';
    readonly path: string;
    readonly mediaType: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  }
  | { readonly kind: 'delete'; readonly path: string };

export interface WorkspaceOverlayPage {
  readonly items: readonly WorkspaceOverlayEntry[];
}

export interface WorkspaceOverlayCommandResult {
  readonly value: WorkspaceOverlayEntry | null;
  readonly replayed: boolean;
}

export type WorkspaceSandboxOverlayCommand =
  | {
    readonly commandId: WorkspaceOverlayCommandId;
    readonly kind: 'write';
    readonly path: string;
    readonly mediaType: string;
    readonly bytes: Buffer;
  }
  | {
    readonly commandId: WorkspaceOverlayCommandId;
    readonly kind: 'delete';
    readonly path: string;
  };

export interface WorkspaceSandboxOverlaySnapshot {
  readonly entries: readonly (WorkspaceOverlayEntry & {
    readonly bytes?: Buffer;
    readonly baseExists?: boolean;
    readonly baseSha256?: string;
  })[];
}

/**
 * Internal durable-content Adapter. Preparation is idempotent by environmentId;
 * overlay mutation is serialized by the Module and idempotent by commandId.
 */
export interface WorkspaceSandboxAdapter {
  prepare(scope: WorkspaceSandboxScope): Promise<void>;
  release(scope: { readonly environmentId: WorkspaceRunEnvironmentId }): Promise<void>;
  list(environmentId: WorkspaceRunEnvironmentId): Promise<readonly WorkspaceFileEntry[]>;
  open(environmentId: WorkspaceRunEnvironmentId, path: string): Promise<Buffer>;
  mutateOverlay(
    scope: WorkspaceSandboxScope,
    command: WorkspaceSandboxOverlayCommand,
  ): Promise<WorkspaceOverlayCommandResult>;
  listOverlay(environmentId: WorkspaceRunEnvironmentId): Promise<WorkspaceOverlayPage>;
  snapshotOverlay(scope: WorkspaceSandboxScope): Promise<WorkspaceSandboxOverlaySnapshot>;
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
  writeFile(identity: RequestIdentity, invocationId: WorkspaceInvocationId, command: {
    readonly commandId: WorkspaceOverlayCommandId;
    readonly path: string;
    readonly content: string;
  }): Promise<WorkspaceOverlayCommandResult>;
  deleteFile(identity: RequestIdentity, invocationId: WorkspaceInvocationId, command: {
    readonly commandId: WorkspaceOverlayCommandId;
    readonly path: string;
  }): Promise<WorkspaceOverlayCommandResult>;
  listOverlay(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
  ): Promise<WorkspaceOverlayPage>;
  proposeChanges(identity: RequestIdentity, invocationId: WorkspaceInvocationId, command: {
    readonly commandId: WorkspaceChangeCommandId;
  }): Promise<WorkspaceChangeCommandResult>;
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
  readonly maximum_operation_mode: WorkspaceOperationMode;
  readonly status: WorkspaceRunEnvironment['status'];
  readonly prepared_at: Date | null;
  readonly released_at: Date | null;
}

interface RevisionScopeRow {
  readonly content_kind: 'empty' | 'git_commit' | 'git_snapshot' | 'snapshot';
  readonly git_commit_sha: string | null;
  readonly operation_mode: WorkspaceOperationMode;
}

function mapEnvironment(row: RunEnvironmentRow): WorkspaceRunEnvironment {
  return {
    id: row.id as WorkspaceRunEnvironmentId,
    invocationId: row.invocation_id as WorkspaceInvocationId,
    workspaceId: row.workspace_id as WorkspaceId,
    workingRootId: row.working_root_id as WorkingRootId,
    revisionId: row.revision_id as WorkspaceRevisionId,
    maximumOperationMode: row.maximum_operation_mode,
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

function overlayMediaType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'text/markdown; charset=utf-8';
  }
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'text/plain; charset=utf-8';
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
  return row.content_kind === 'empty'
    ? { kind: 'empty' }
    : row.content_kind === 'snapshot'
      ? { kind: 'snapshot' }
      : { kind: 'git', commit: row.git_commit_sha! };
}

export class PostgresWorkspaceRunEnvironments implements WorkspaceRunEnvironments {
  private readonly clock: Clock;
  private readonly generateId: () => string;
  private readonly sandbox: WorkspaceSandboxAdapter;
  private readonly changes: WorkspaceChanges | undefined;

  constructor(
    private readonly pool: Pool,
    options: {
      readonly clock?: Clock;
      readonly generateId?: () => string;
      readonly sandbox: WorkspaceSandboxAdapter;
      readonly changes?: WorkspaceChanges;
    },
  ) {
    this.clock = options.clock ?? new SystemClock();
    this.generateId = options.generateId ?? randomUUID;
    this.sandbox = options.sandbox;
    this.changes = options.changes;
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
        `SELECT v.content_kind, v.git_commit_sha, w.operation_mode
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
                revision_id, maximum_operation_mode, status, prepared_at, released_at
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
             workspace_id, working_root_id, revision_id, maximum_operation_mode,
             status, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'preparing', $9)
           RETURNING id, owner_principal_id, invocation_id, workspace_id, working_root_id,
                     revision_id, maximum_operation_mode, status, prepared_at, released_at`,
          [id, identity.organizationId, request.invocationId, identity.principalId,
            request.workspaceId, request.workingRootId, request.revisionId,
            revision.operation_mode, this.clock.now()],
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
                   revision_id, maximum_operation_mode, status, prepared_at, released_at`,
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
              revision_id, maximum_operation_mode, status, prepared_at, released_at
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

  async writeFile(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
    command: {
      readonly commandId: WorkspaceOverlayCommandId;
      readonly path: string;
      readonly content: string;
    },
  ): Promise<WorkspaceOverlayCommandResult> {
    const bytes = Buffer.from(command.content, 'utf8');
    if (bytes.byteLength > 1_048_576
      || new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== command.content) {
      throw new WorkspaceFileContentUnavailableError();
    }
    return this.mutateOverlay(identity, invocationId, {
      commandId: command.commandId,
      kind: 'write',
      path: command.path,
      mediaType: overlayMediaType(command.path),
      bytes,
    });
  }

  async deleteFile(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
    command: { readonly commandId: WorkspaceOverlayCommandId; readonly path: string },
  ): Promise<WorkspaceOverlayCommandResult> {
    return this.mutateOverlay(identity, invocationId, {
      commandId: command.commandId,
      kind: 'delete',
      path: command.path,
    });
  }

  async listOverlay(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
  ): Promise<WorkspaceOverlayPage> {
    const environment = await this.preparedEnvironment(identity, invocationId);
    try {
      return await this.sandbox.listOverlay(environment.id);
    } catch {
      throw new WorkspaceRunEnvironmentUnavailableError();
    }
  }

  async proposeChanges(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
    command: { readonly commandId: WorkspaceChangeCommandId },
  ): Promise<WorkspaceChangeCommandResult> {
    const environment = await this.mutableEnvironment(identity, invocationId);
    if (!this.changes) throw new WorkspaceRunEnvironmentUnavailableError();
    const client = await this.pool.connect();
    const lockKey = `workspace-environment:${identity.organizationId}:${invocationId}`;
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
      await this.mutableEnvironment(identity, invocationId);
      const scope = await this.sandboxScope(identity, environment);
      let snapshot: WorkspaceSandboxOverlaySnapshot;
      try {
        snapshot = await this.sandbox.snapshotOverlay(scope);
      } catch {
        throw new WorkspaceRunEnvironmentUnavailableError();
      }
      return await this.changes.propose(identity, {
        commandId: command.commandId,
        invocationId,
        workspaceId: environment.workspaceId,
        workingRootId: environment.workingRootId,
        baseRevisionId: environment.revisionId,
        entries: snapshot.entries.flatMap<WorkspaceChangeInput>((entry) => entry.kind === 'delete'
          ? [{ kind: 'delete' as const, path: entry.path }]
          : entry.baseSha256 === entry.sha256
            ? []
            : [{
              kind: entry.baseExists ? 'modify' as const : 'add' as const,
              path: entry.path,
              mediaType: entry.mediaType,
              content: entry.bytes!,
            }]),
      });
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
      } finally {
        client.release();
      }
    }
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

  private async mutateOverlay(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
    command: WorkspaceSandboxOverlayCommand,
  ): Promise<WorkspaceOverlayCommandResult> {
    const environment = await this.mutableEnvironment(identity, invocationId);
    const client = await this.pool.connect();
    const lockKey = `workspace-environment:${identity.organizationId}:${invocationId}`;
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
      await this.mutableEnvironment(identity, invocationId);
      const scope = await this.sandboxScope(identity, environment);
      return await this.sandbox.mutateOverlay(scope, command);
    } catch (error) {
      if (error instanceof WorkspaceOperationModeDeniedError
        || error instanceof WorkspaceIdempotencyConflictError) throw error;
      if (error instanceof WorkspaceFileNotFoundError) throw new WorkspaceNotFoundError();
      throw new WorkspaceRunEnvironmentUnavailableError();
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
      } finally {
        client.release();
      }
    }
  }

  private async sandboxScope(
    identity: RequestIdentity,
    environment: WorkspaceRunEnvironment,
  ): Promise<WorkspaceSandboxScope> {
    const result = await this.pool.query<RevisionScopeRow>(
      `SELECT v.content_kind, v.git_commit_sha, w.operation_mode
       FROM workspaces w
       JOIN workspace_roots r
         ON r.organization_id = w.organization_id AND r.workspace_id = w.id
       JOIN workspace_revisions v
         ON v.organization_id = r.organization_id AND v.working_root_id = r.id
       WHERE w.organization_id = $1 AND w.owner_principal_id = $2
         AND w.id = $3 AND r.id = $4 AND v.id = $5`,
      [identity.organizationId, identity.principalId, environment.workspaceId,
        environment.workingRootId, environment.revisionId],
    );
    const row = result.rows[0];
    if (!row) throw new WorkspaceNotFoundError();
    return {
      environmentId: environment.id,
      invocationId: environment.invocationId,
      organizationId: identity.organizationId,
      workspaceId: environment.workspaceId,
      workingRootId: environment.workingRootId,
      revisionId: environment.revisionId,
      source: contentSource(row),
    };
  }

  private async mutableEnvironment(
    identity: RequestIdentity,
    invocationId: WorkspaceInvocationId,
  ): Promise<WorkspaceRunEnvironment> {
    const environment = await this.preparedEnvironment(identity, invocationId);
    if (environment.maximumOperationMode === 'observe') {
      throw new WorkspaceOperationModeDeniedError();
    }
    const current = await this.pool.query<{
      readonly operation_mode: WorkspaceOperationMode;
      readonly lifecycle_status: string;
      readonly worktree_archived: boolean;
    }>(
      `SELECT w.operation_mode, w.lifecycle_status,
              EXISTS (
                SELECT 1 FROM workspace_git_worktrees wt
                WHERE wt.organization_id = r.organization_id
                  AND wt.working_root_id = r.id AND wt.lifecycle_status = 'archived'
              ) AS worktree_archived
       FROM workspaces w
       JOIN workspace_roots r
         ON r.organization_id = w.organization_id AND r.workspace_id = w.id
       WHERE w.organization_id = $1 AND w.owner_principal_id = $2
         AND w.id = $3 AND r.id = $4`,
      [identity.organizationId, identity.principalId,
        environment.workspaceId, environment.workingRootId],
    );
    const row = current.rows[0];
    if (!row) throw new WorkspaceNotFoundError();
    if (row.operation_mode === 'observe') throw new WorkspaceOperationModeDeniedError();
    if (row.lifecycle_status !== 'ready' || row.worktree_archived) {
      throw new WorkspaceRunEnvironmentUnavailableError();
    }
    return environment;
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
