import { createHash, randomUUID } from 'node:crypto';
import type { RequestIdentity } from '@cmaster/identity';
import type { Brand, Clock } from '@cmaster/kernel';
import { SystemClock } from '@cmaster/kernel';
import type { Pool, PoolClient } from 'pg';
import {
  InvalidWorkspaceCursorError,
  InvalidWorkspacePageLimitError,
  WorkspaceIdempotencyConflictError,
  WorkspaceNotFoundError,
  type WorkingRootId,
  type WorkspaceId,
  type WorkspaceRevisionId,
} from './workspace-types.js';
import type { WorkspaceInvocationId } from './run-environments.js';
import {
  WorkspaceRevisionContentError,
  type WorkspaceFileEntry,
  type WorkspaceRevisionContentReader,
  type WorkspaceRevisionContentScope,
} from './revision-content.js';
import type {
  WorkspaceChangeContentEntry,
  WorkspaceChangeContentStore,
} from './change-content-store.js';
import type {
  WorkspaceRevisionSnapshotChange,
  WorkspaceRevisionSnapshotEntry,
  WorkspaceRevisionSnapshotStore,
} from './revision-snapshot-store.js';
import type {
  WorkspaceGitSnapshotAdapter,
  WorkspaceGitSnapshotChange,
} from './git-snapshot-adapter.js';

export type WorkspaceChangeSetId = Brand<string, 'WorkspaceChangeSetId'>;
export type WorkspaceChangeCommandId = Brand<string, 'WorkspaceChangeCommandId'>;

export function workspaceChangeCommandId(value: string): WorkspaceChangeCommandId {
  return value as WorkspaceChangeCommandId;
}

export interface WorkspaceChangeEntry {
  readonly kind: 'add' | 'modify' | 'delete';
  readonly path: string;
  readonly mediaType?: string;
  readonly sizeBytes?: number;
  readonly sha256?: string;
}

export interface WorkspaceChangeSet {
  readonly id: WorkspaceChangeSetId;
  readonly workspaceId: WorkspaceId;
  readonly workingRootId: WorkingRootId;
  readonly baseRevisionId: WorkspaceRevisionId;
  readonly invocationId: WorkspaceInvocationId;
  readonly status: 'preparing' | 'proposed' | 'applying' | 'applied' | 'conflicted';
  readonly entries: readonly WorkspaceChangeEntry[];
  readonly resultingRevisionId?: WorkspaceRevisionId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type WorkspaceChangeInput =
  | {
    readonly kind: 'add' | 'modify';
    readonly path: string;
    readonly mediaType: string;
    readonly content: Uint8Array;
  }
  | { readonly kind: 'delete'; readonly path: string };

export interface ProposeWorkspaceChangeSet {
  readonly commandId: WorkspaceChangeCommandId;
  readonly invocationId: WorkspaceInvocationId;
  readonly workspaceId: WorkspaceId;
  readonly workingRootId: WorkingRootId;
  readonly baseRevisionId: WorkspaceRevisionId;
  readonly entries: readonly WorkspaceChangeInput[];
}

export interface ApplyWorkspaceChangeSet {
  readonly commandId: WorkspaceChangeCommandId;
  readonly changeSetId: WorkspaceChangeSetId;
}

export interface WorkspaceChangeCommandResult {
  readonly value: WorkspaceChangeSet;
  readonly replayed: boolean;
}

export interface WorkspaceChangeSetPage {
  readonly items: readonly WorkspaceChangeSet[];
  readonly nextCursor?: string;
}

export interface WorkspaceChanges {
  propose(
    identity: RequestIdentity,
    command: ProposeWorkspaceChangeSet,
  ): Promise<WorkspaceChangeCommandResult>;
  apply(
    identity: RequestIdentity,
    command: ApplyWorkspaceChangeSet,
  ): Promise<WorkspaceChangeCommandResult>;
  list(identity: RequestIdentity, scope: {
    readonly workspaceId: WorkspaceId;
    readonly workingRootId: WorkingRootId;
  }, page?: { readonly limit?: number; readonly cursor?: string }): Promise<WorkspaceChangeSetPage>;
  get(identity: RequestIdentity, changeSetId: WorkspaceChangeSetId): Promise<WorkspaceChangeSet>;
}

export class InvalidWorkspaceChangeSetError extends Error {}
export class WorkspaceChangeSetUnavailableError extends Error {}
export class WorkspaceChangeConflictError extends Error {}
export class WorkspaceOperationModeDeniedError extends Error {}

interface ChangeSetRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly working_root_id: string;
  readonly base_revision_id: string;
  readonly invocation_id: string;
  readonly status: WorkspaceChangeSet['status'];
  readonly resulting_revision_id: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface ChangeEntryRow {
  readonly change_kind: WorkspaceChangeEntry['kind'];
  readonly path: string;
  readonly media_type: string | null;
  readonly size_bytes: number | null;
  readonly sha256: string | null;
}

interface ChangeReceiptRow {
  readonly request_hash: string;
  readonly change_set_id: string;
}

interface ScopeRow {
  readonly content_kind: 'empty' | 'git_commit' | 'git_snapshot' | 'snapshot';
  readonly git_commit_sha: string | null;
  readonly operation_mode?: 'observe' | 'edit_with_confirmation' | 'trusted_automation';
  readonly maximum_operation_mode?: 'observe' | 'edit_with_confirmation' | 'trusted_automation';
}

interface ApplyScopeRow extends ScopeRow {
  readonly current_revision_id: string;
  readonly workspace_lifecycle_status: 'provisioning' | 'ready' | 'failed' | 'archived';
  readonly worktree_archived: boolean;
}

interface ApplyingChangeSetRow {
  readonly workspace_id: string;
  readonly working_root_id: string;
  readonly base_revision_id: string;
  readonly operation_mode: 'observe' | 'edit_with_confirmation' | 'trusted_automation';
  readonly maximum_operation_mode: 'observe' | 'edit_with_confirmation' | 'trusted_automation';
  readonly workspace_lifecycle_status: 'provisioning' | 'ready' | 'failed' | 'archived';
  readonly worktree_archived: boolean;
  readonly status: WorkspaceChangeSet['status'];
  readonly resulting_revision_id: string | null;
}

interface NormalizedChange {
  readonly metadata: WorkspaceChangeEntry;
  readonly content?: WorkspaceChangeContentEntry;
}

const maximumEntries = 100;
const maximumTotalBytes = 8 * 1_048_576;

interface ChangeSetCursor {
  readonly createdAt: string;
  readonly id: string;
}

function encodeCursor(value: ChangeSetCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(value: string): ChangeSetCursor {
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new InvalidWorkspaceCursorError();
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length !== 2
      || !('createdAt' in parsed) || typeof parsed.createdAt !== 'string'
      || Number.isNaN(Date.parse(parsed.createdAt))
      || !('id' in parsed) || typeof parsed.id !== 'string') {
      throw new InvalidWorkspaceCursorError();
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch (error) {
    if (error instanceof InvalidWorkspaceCursorError) throw error;
    throw new InvalidWorkspaceCursorError();
  }
}

function canonicalPath(value: string): string {
  if (value.length < 1 || value.length > 1024 || value.startsWith('/')
    || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)
    || value !== value.normalize('NFC')
    || value.split('/').some((segment) => segment === '' || segment === '.'
      || segment === '..' || segment === '.git')) {
    throw new InvalidWorkspaceChangeSetError();
  }
  return value;
}

function inferredMediaType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'text/markdown; charset=utf-8';
  }
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

function normalizeChanges(entries: readonly WorkspaceChangeInput[]): readonly NormalizedChange[] {
  if (entries.length < 1 || entries.length > maximumEntries) {
    throw new InvalidWorkspaceChangeSetError();
  }
  let totalBytes = 0;
  const paths = new Set<string>();
  const normalized = entries.map((entry): NormalizedChange => {
    const path = canonicalPath(entry.path);
    if (paths.has(path)) throw new InvalidWorkspaceChangeSetError();
    paths.add(path);
    if (entry.kind === 'delete') return { metadata: { kind: 'delete', path } };
    if (!(entry.content instanceof Uint8Array) || entry.content.byteLength > 1_048_576
      || entry.mediaType !== inferredMediaType(path)) {
      throw new InvalidWorkspaceChangeSetError();
    }
    const bytes = Buffer.from(entry.content);
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new InvalidWorkspaceChangeSetError();
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > maximumTotalBytes) throw new InvalidWorkspaceChangeSetError();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const metadata: WorkspaceChangeEntry = {
      kind: entry.kind,
      path,
      mediaType: entry.mediaType,
      sizeBytes: bytes.byteLength,
      sha256,
    };
    return {
      metadata,
      content: { ...metadata, bytes } as WorkspaceChangeContentEntry,
    };
  });
  return normalized.sort((left, right) => (
    left.metadata.path < right.metadata.path ? -1 : left.metadata.path > right.metadata.path ? 1 : 0
  ));
}

function commandHash(command: ProposeWorkspaceChangeSet, changes: readonly NormalizedChange[]): string {
  return createHash('sha256').update(JSON.stringify({
    invocationId: command.invocationId,
    workspaceId: command.workspaceId,
    workingRootId: command.workingRootId,
    baseRevisionId: command.baseRevisionId,
    entries: changes.map((change) => change.metadata),
  })).digest('hex');
}

function applyCommandHash(command: ApplyWorkspaceChangeSet): string {
  return createHash('sha256').update(JSON.stringify({
    changeSetId: command.changeSetId,
  })).digest('hex');
}

function sameFile(
  left: WorkspaceFileEntry | undefined,
  right: WorkspaceFileEntry | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && left.sha256 === right.sha256
      && left.sizeBytes === right.sizeBytes && left.mediaType === right.mediaType;
}

function manifestHash(entries: readonly WorkspaceRevisionSnapshotEntry[]): string {
  return createHash('sha256').update(JSON.stringify(entries.map(({ bytes: _, ...entry }) => entry)))
    .digest('hex');
}

function resultMatchesChanges(
  entries: readonly WorkspaceFileEntry[],
  changes: readonly WorkspaceChangeEntry[],
): boolean {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  return changes.every((change) => {
    const file = byPath.get(change.path);
    return change.kind === 'delete' ? !file : file?.sha256 === change.sha256;
  });
}

function revisionScope(
  identity: RequestIdentity,
  workspaceId: WorkspaceId,
  workingRootId: WorkingRootId,
  revisionId: WorkspaceRevisionId,
  row: ScopeRow,
): WorkspaceRevisionContentScope {
  return {
    organizationId: identity.organizationId,
    workspaceId,
    workingRootId,
    revisionId,
    source: row.content_kind === 'empty'
      ? { kind: 'empty' }
      : row.content_kind === 'snapshot'
        ? { kind: 'snapshot' }
        : { kind: 'git', commit: row.git_commit_sha! },
  };
}

function contentScope(
  identity: RequestIdentity,
  command: ProposeWorkspaceChangeSet,
  row: ScopeRow,
): WorkspaceRevisionContentScope {
  return revisionScope(identity, command.workspaceId, command.workingRootId,
    command.baseRevisionId, row);
}

function assertEntrySemantics(
  changes: readonly NormalizedChange[],
  baseEntries: readonly WorkspaceFileEntry[],
  occupiedPaths: ReadonlySet<string>,
): void {
  const byPath = new Map(baseEntries.map((entry) => [entry.path, entry]));
  for (const change of changes) {
    const exists = byPath.has(change.metadata.path);
    if ((change.metadata.kind === 'add' && (exists || occupiedPaths.has(change.metadata.path)))
      || (change.metadata.kind !== 'add' && !exists)) {
      throw new InvalidWorkspaceChangeSetError();
    }
  }
}

async function loadChangeSet(
  client: Pool | PoolClient,
  identity: RequestIdentity,
  changeSetId: WorkspaceChangeSetId,
): Promise<WorkspaceChangeSet | undefined> {
  const selected = await client.query<ChangeSetRow>(
    `SELECT cs.id, cs.workspace_id, cs.working_root_id, cs.base_revision_id,
            cs.invocation_id, cs.status, cs.resulting_revision_id, cs.created_at, cs.updated_at
     FROM workspace_change_sets cs
     JOIN workspaces w
       ON w.organization_id = cs.organization_id AND w.id = cs.workspace_id
     WHERE cs.organization_id = $1 AND cs.owner_principal_id = $2
       AND w.owner_principal_id = $2 AND cs.id = $3`,
    [identity.organizationId, identity.principalId, changeSetId],
  );
  const row = selected.rows[0];
  if (!row) return undefined;
  const entries = await client.query<ChangeEntryRow>(
    `SELECT change_kind, path, media_type, size_bytes, sha256
     FROM workspace_change_entries
     WHERE organization_id = $1 AND change_set_id = $2
     ORDER BY path ASC`,
    [identity.organizationId, row.id],
  );
  return {
    id: row.id as WorkspaceChangeSetId,
    workspaceId: row.workspace_id as WorkspaceId,
    workingRootId: row.working_root_id as WorkingRootId,
    baseRevisionId: row.base_revision_id as WorkspaceRevisionId,
    invocationId: row.invocation_id as WorkspaceInvocationId,
    status: row.status,
    entries: entries.rows.map((entry) => ({
      kind: entry.change_kind,
      path: entry.path,
      ...(entry.media_type ? { mediaType: entry.media_type } : {}),
      ...(entry.size_bytes !== null ? { sizeBytes: entry.size_bytes } : {}),
      ...(entry.sha256 ? { sha256: entry.sha256 } : {}),
    })),
    ...(row.resulting_revision_id
      ? { resultingRevisionId: row.resulting_revision_id as WorkspaceRevisionId }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresWorkspaceChanges implements WorkspaceChanges {
  private readonly clock: Clock;
  private readonly generateId: () => string;

  constructor(
    private readonly pool: Pool,
    private readonly options: {
      readonly contentStore: WorkspaceChangeContentStore;
      readonly revisionContent: WorkspaceRevisionContentReader;
      readonly snapshotStore: WorkspaceRevisionSnapshotStore;
      readonly gitSnapshot?: WorkspaceGitSnapshotAdapter;
      readonly clock?: Clock;
      readonly generateId?: () => string;
    },
  ) {
    this.clock = options.clock ?? new SystemClock();
    this.generateId = options.generateId ?? randomUUID;
  }

  async propose(
    identity: RequestIdentity,
    command: ProposeWorkspaceChangeSet,
  ): Promise<WorkspaceChangeCommandResult> {
    const changes = normalizeChanges(command.entries);
    const hash = commandHash(command, changes);
    const client = await this.pool.connect();
    const lockKey = `workspace-change-propose:${identity.organizationId}:${identity.principalId}:${command.commandId}`;
    let transactionStarted = false;
    let changeSetId: WorkspaceChangeSetId;
    let replayed = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
      await client.query('BEGIN');
      transactionStarted = true;
      const receipt = await client.query<ChangeReceiptRow>(
        `SELECT request_hash, change_set_id FROM workspace_change_receipts
         WHERE organization_id = $1 AND principal_id = $2
           AND operation_type = 'propose_change_set' AND command_id = $3
         FOR UPDATE`,
        [identity.organizationId, identity.principalId, command.commandId],
      );
      const existingReceipt = receipt.rows[0];
      if (existingReceipt) {
        if (existingReceipt.request_hash !== hash) {
          throw new WorkspaceIdempotencyConflictError();
        }
        changeSetId = existingReceipt.change_set_id as WorkspaceChangeSetId;
        replayed = true;
      } else {
        const scope = await client.query<ScopeRow>(
          `SELECT v.content_kind, v.git_commit_sha, w.operation_mode,
                  env.maximum_operation_mode
           FROM workspaces w
           JOIN workspace_roots r
             ON r.organization_id = w.organization_id AND r.workspace_id = w.id
           JOIN workspace_revisions v
             ON v.organization_id = r.organization_id AND v.working_root_id = r.id
           JOIN workspace_run_environments env
             ON env.organization_id = w.organization_id
            AND env.owner_principal_id = w.owner_principal_id
            AND env.workspace_id = w.id AND env.working_root_id = r.id
            AND env.revision_id = v.id AND env.invocation_id = $6
            AND env.status = 'prepared'
           WHERE w.organization_id = $1 AND w.owner_principal_id = $2
             AND w.id = $3 AND r.id = $4 AND v.id = $5
             AND w.lifecycle_status = 'ready'
             AND NOT EXISTS (
               SELECT 1 FROM workspace_git_worktrees wt
               WHERE wt.organization_id = r.organization_id
                 AND wt.working_root_id = r.id AND wt.lifecycle_status = 'archived'
             )
           FOR SHARE OF w, r, v, env`,
          [identity.organizationId, identity.principalId, command.workspaceId,
            command.workingRootId, command.baseRevisionId, command.invocationId],
        );
        const scopeRow = scope.rows[0];
        if (!scopeRow) throw new WorkspaceNotFoundError();
        if (scopeRow.operation_mode === 'observe'
          || scopeRow.maximum_operation_mode === 'observe') {
          throw new WorkspaceOperationModeDeniedError();
        }
        const baseScope = contentScope(identity, command, scopeRow);
        const baseEntries = await this.options.revisionContent.list(baseScope);
        const [visibility, occupation] = await Promise.all([
          Promise.all(changes.map((change) => (
            this.options.revisionContent.isPathVisible(baseScope, change.metadata.path)
          ))),
          Promise.all(changes.map((change) => (
            this.options.revisionContent.pathExists(baseScope, change.metadata.path)
          ))),
        ]);
        if (visibility.some((visible) => !visible)) {
          throw new InvalidWorkspaceChangeSetError();
        }
        const occupiedPaths = new Set(changes.flatMap((change, index) => (
          occupation[index] ? [change.metadata.path] : []
        )));
        assertEntrySemantics(changes, baseEntries, occupiedPaths);
        changeSetId = this.generateId() as WorkspaceChangeSetId;
        const now = this.clock.now();
        await client.query(
          `INSERT INTO workspace_change_sets (
             id, organization_id, owner_principal_id, workspace_id, working_root_id,
             base_revision_id, invocation_id, status, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'preparing', $8, $8)`,
          [changeSetId, identity.organizationId, identity.principalId, command.workspaceId,
            command.workingRootId, command.baseRevisionId, command.invocationId, now],
        );
        for (const change of changes) {
          await client.query(
            `INSERT INTO workspace_change_entries (
               change_set_id, organization_id, path, change_kind, media_type, size_bytes, sha256
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [changeSetId, identity.organizationId, change.metadata.path, change.metadata.kind,
              change.metadata.mediaType ?? null, change.metadata.sizeBytes ?? null,
              change.metadata.sha256 ?? null],
          );
        }
        await client.query(
          `INSERT INTO workspace_change_receipts (
             organization_id, principal_id, operation_type, command_id,
             request_hash, change_set_id, created_at
           ) VALUES ($1, $2, 'propose_change_set', $3, $4, $5, $6)`,
          [identity.organizationId, identity.principalId, command.commandId,
            hash, changeSetId, now],
        );
      }
      await client.query('COMMIT');
      transactionStarted = false;
      let value = await loadChangeSet(client, identity, changeSetId);
      if (!value) throw new WorkspaceNotFoundError();
      if (value.status === 'preparing') {
        try {
          await this.options.contentStore.put(
            { organizationId: identity.organizationId, changeSetId },
            changes.flatMap((change) => change.content ? [change.content] : []),
          );
        } catch (error) {
          if (error instanceof WorkspaceRevisionContentError) {
            throw new WorkspaceChangeSetUnavailableError();
          }
          throw error;
        }
        await client.query(
          `UPDATE workspace_change_sets SET status = 'proposed', updated_at = $4
           WHERE organization_id = $1 AND owner_principal_id = $2 AND id = $3
             AND status = 'preparing'`,
          [identity.organizationId, identity.principalId, changeSetId, this.clock.now()],
        );
        value = await loadChangeSet(client, identity, changeSetId);
        if (!value) throw new WorkspaceNotFoundError();
      }
      return { value, replayed };
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

  async apply(
    identity: RequestIdentity,
    command: ApplyWorkspaceChangeSet,
  ): Promise<WorkspaceChangeCommandResult> {
    let value = await loadChangeSet(this.pool, identity, command.changeSetId);
    if (!value) throw new WorkspaceNotFoundError();
    const hash = applyCommandHash(command);
    const client = await this.pool.connect();
    const lockKey = `workspace-change-apply:${identity.organizationId}:${value.workingRootId}`;
    let transactionStarted = false;
    let replayed = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
      await client.query('BEGIN');
      transactionStarted = true;
      const receipt = await client.query<ChangeReceiptRow>(
        `SELECT request_hash, change_set_id FROM workspace_change_receipts
         WHERE organization_id = $1 AND principal_id = $2
           AND operation_type = 'apply_change_set' AND command_id = $3
         FOR UPDATE`,
        [identity.organizationId, identity.principalId, command.commandId],
      );
      const existingReceipt = receipt.rows[0];
      if (existingReceipt) {
        if (existingReceipt.request_hash !== hash
          || existingReceipt.change_set_id !== command.changeSetId) {
          throw new WorkspaceIdempotencyConflictError();
        }
        replayed = true;
      }
      const selected = await client.query<ApplyingChangeSetRow>(
        `SELECT cs.workspace_id, cs.working_root_id, cs.base_revision_id,
                w.operation_mode, env.maximum_operation_mode,
                w.lifecycle_status AS workspace_lifecycle_status,
                EXISTS (
                  SELECT 1 FROM workspace_git_worktrees wt
                  WHERE wt.organization_id = r.organization_id
                    AND wt.working_root_id = r.id AND wt.lifecycle_status = 'archived'
                ) AS worktree_archived,
                cs.status, cs.resulting_revision_id
         FROM workspace_change_sets cs
         JOIN workspaces w
           ON w.organization_id = cs.organization_id AND w.id = cs.workspace_id
         JOIN workspace_roots r
           ON r.organization_id = cs.organization_id AND r.id = cs.working_root_id
         JOIN workspace_run_environments env
           ON env.organization_id = cs.organization_id
          AND env.owner_principal_id = cs.owner_principal_id
          AND env.invocation_id = cs.invocation_id
         WHERE cs.organization_id = $1 AND cs.owner_principal_id = $2 AND cs.id = $3
         FOR UPDATE OF cs, w, r`,
        [identity.organizationId, identity.principalId, command.changeSetId],
      );
      const changeSet = selected.rows[0];
      if (!changeSet) throw new WorkspaceNotFoundError();
      if (changeSet.operation_mode === 'observe'
        || changeSet.maximum_operation_mode === 'observe') {
        throw new WorkspaceOperationModeDeniedError();
      }
      if (changeSet.workspace_lifecycle_status !== 'ready'
        || changeSet.worktree_archived) {
        throw new WorkspaceChangeSetUnavailableError();
      }
      if (changeSet.status === 'preparing') throw new WorkspaceChangeSetUnavailableError();
      if (changeSet.status === 'conflicted') throw new WorkspaceChangeConflictError();
      let resultingRevisionId = changeSet.resulting_revision_id as WorkspaceRevisionId | null;
      if (changeSet.status === 'proposed') {
        resultingRevisionId = this.generateId() as WorkspaceRevisionId;
        await client.query(
          `UPDATE workspace_change_sets
           SET status = 'applying', resulting_revision_id = $4, updated_at = $5
           WHERE organization_id = $1 AND owner_principal_id = $2 AND id = $3`,
          [identity.organizationId, identity.principalId, command.changeSetId,
            resultingRevisionId, this.clock.now()],
        );
      }
      if (!resultingRevisionId) throw new WorkspaceChangeSetUnavailableError();
      if (!existingReceipt) {
        await client.query(
          `INSERT INTO workspace_change_receipts (
             organization_id, principal_id, operation_type, command_id,
             request_hash, change_set_id, resulting_revision_id, created_at
           ) VALUES ($1, $2, 'apply_change_set', $3, $4, $5, $6, $7)`,
          [identity.organizationId, identity.principalId, command.commandId, hash,
            command.changeSetId, resultingRevisionId, this.clock.now()],
        );
      }
      await client.query('COMMIT');
      transactionStarted = false;
      value = await loadChangeSet(client, identity, command.changeSetId);
      if (!value) throw new WorkspaceNotFoundError();
      if (value.status === 'applied') return { value, replayed };

      const scopeRows = await client.query<ApplyScopeRow>(
        `SELECT r.current_revision_id, v.content_kind, v.git_commit_sha, w.operation_mode,
                w.lifecycle_status AS workspace_lifecycle_status,
                EXISTS (
                  SELECT 1 FROM workspace_git_worktrees wt
                  WHERE wt.organization_id = r.organization_id
                    AND wt.working_root_id = r.id AND wt.lifecycle_status = 'archived'
                ) AS worktree_archived
         FROM workspace_roots r
         JOIN workspaces w
           ON w.organization_id = r.organization_id AND w.id = r.workspace_id
         JOIN workspace_revisions v
           ON v.organization_id = r.organization_id
          AND v.working_root_id = r.id AND v.id = r.current_revision_id
         WHERE r.organization_id = $1 AND r.workspace_id = $2 AND r.id = $3
           AND w.owner_principal_id = $4`,
        [identity.organizationId, value.workspaceId, value.workingRootId,
          identity.principalId],
      );
      const currentRow = scopeRows.rows[0];
      if (!currentRow) throw new WorkspaceNotFoundError();
      if (currentRow.operation_mode === 'observe') {
        throw new WorkspaceOperationModeDeniedError();
      }
      if (currentRow.workspace_lifecycle_status !== 'ready' || currentRow.worktree_archived) {
        throw new WorkspaceChangeSetUnavailableError();
      }
      const baseRows = currentRow.current_revision_id === value.baseRevisionId
        ? { rows: [currentRow] }
        : await client.query<ScopeRow>(
          `SELECT content_kind, git_commit_sha FROM workspace_revisions
           WHERE organization_id = $1 AND workspace_id = $2
             AND working_root_id = $3 AND id = $4`,
          [identity.organizationId, value.workspaceId, value.workingRootId,
            value.baseRevisionId],
        );
      const baseRow = baseRows.rows[0];
      if (!baseRow) throw new WorkspaceNotFoundError();
      const currentRevisionId = currentRow.current_revision_id as WorkspaceRevisionId;
      const baseFiles = await this.options.revisionContent.list(revisionScope(
        identity, value.workspaceId, value.workingRootId, value.baseRevisionId, baseRow,
      ));
      const currentScope = revisionScope(
        identity, value.workspaceId, value.workingRootId, currentRevisionId, currentRow,
      );
      const currentFiles = await this.options.revisionContent.list(currentScope);
      const baseByPath = new Map(baseFiles.map((entry) => [entry.path, entry]));
      const currentByPath = new Map(currentFiles.map((entry) => [entry.path, entry]));
      for (const change of value.entries) {
        if (!sameFile(baseByPath.get(change.path), currentByPath.get(change.path))) {
          await client.query(
            `UPDATE workspace_change_sets
             SET status = 'conflicted', resulting_revision_id = NULL, updated_at = $4
             WHERE organization_id = $1 AND owner_principal_id = $2 AND id = $3
               AND status = 'applying'`,
            [identity.organizationId, identity.principalId, value.id, this.clock.now()],
          );
          throw new WorkspaceChangeConflictError();
        }
      }
      const materializedChanges: WorkspaceGitSnapshotChange[] = [];
      for (const change of value.entries) {
        if (change.kind === 'delete') {
          materializedChanges.push({ kind: 'delete', path: change.path });
          continue;
        }
        const bytes = await this.options.contentStore.open(
          { organizationId: identity.organizationId, changeSetId: value.id }, change.path,
        );
        if (bytes.byteLength !== change.sizeBytes
          || createHash('sha256').update(bytes).digest('hex') !== change.sha256) {
          throw new WorkspaceChangeSetUnavailableError();
        }
        materializedChanges.push({ kind: change.kind, path: change.path, bytes });
      }
      let resultEntries: readonly WorkspaceRevisionSnapshotEntry[] = [];
      let resultContentKind: 'snapshot' | 'git_snapshot';
      let resultGitCommit: string | null = null;
      let resultManifestHash: string;
      let resultVisibleValid = true;
      if (currentRow.content_kind === 'git_commit'
        || currentRow.content_kind === 'git_snapshot') {
        if (!this.options.gitSnapshot || !currentRow.git_commit_sha) {
          throw new WorkspaceChangeSetUnavailableError();
        }
        const result = await this.options.gitSnapshot.apply({
          organizationId: identity.organizationId,
          workspaceId: value.workspaceId,
          currentCommit: currentRow.git_commit_sha,
          resultingRevisionId,
          changes: materializedChanges,
        });
        resultContentKind = 'git_snapshot';
        resultGitCommit = result.commit;
        resultManifestHash = result.contentManifestHash;
        const verified = await this.options.revisionContent.list({
          organizationId: identity.organizationId,
          workspaceId: value.workspaceId,
          workingRootId: value.workingRootId,
          revisionId: resultingRevisionId,
          source: { kind: 'git', commit: result.commit },
        });
        resultVisibleValid = resultMatchesChanges(verified, value.entries);
      } else {
        const appliedEntries = value.entries;
        const snapshotChanges: WorkspaceRevisionSnapshotChange[] = materializedChanges.map(
          (change) => {
            if (change.kind === 'delete') return change;
            const metadata = appliedEntries.find((entry) => entry.path === change.path)!;
            return {
              kind: change.kind,
              entry: {
                path: change.path,
                mediaType: metadata.mediaType!,
                sizeBytes: metadata.sizeBytes!,
                sha256: metadata.sha256!,
                bytes: change.bytes,
              },
            };
          },
        );
        const resultScope = {
          organizationId: identity.organizationId,
          workspaceId: value.workspaceId,
          workingRootId: value.workingRootId,
          revisionId: resultingRevisionId,
        };
        if (currentRow.content_kind === 'snapshot') {
          resultEntries = await this.options.snapshotStore.apply(
            {
              organizationId: identity.organizationId,
              workspaceId: value.workspaceId,
              workingRootId: value.workingRootId,
              revisionId: currentRevisionId,
            },
            resultScope,
            snapshotChanges,
          );
        } else {
          resultEntries = snapshotChanges.flatMap((change) => (
            change.kind === 'delete' ? [] : [change.entry]
          )).sort((left, right) => (
            left.path < right.path ? -1 : left.path > right.path ? 1 : 0
          ));
          await this.options.snapshotStore.put(resultScope, resultEntries);
        }
        resultContentKind = 'snapshot';
        resultManifestHash = manifestHash(resultEntries);
        const verified = await this.options.revisionContent.list({
          ...resultScope,
          source: { kind: 'snapshot' },
        });
        resultVisibleValid = resultMatchesChanges(verified, value.entries);
      }
      if (!resultVisibleValid) {
        await client.query(
          `UPDATE workspace_change_sets
           SET status = 'conflicted', resulting_revision_id = NULL, updated_at = $4
           WHERE organization_id = $1 AND owner_principal_id = $2 AND id = $3
             AND status = 'applying'`,
          [identity.organizationId, identity.principalId, value.id, this.clock.now()],
        );
        throw new InvalidWorkspaceChangeSetError();
      }

      await client.query('BEGIN');
      transactionStarted = true;
      const lockedRoot = await client.query<{
        readonly current_revision_id: string;
        readonly lifecycle_status: string;
        readonly operation_mode: string;
      }>(
        `SELECT r.current_revision_id, w.lifecycle_status, w.operation_mode
         FROM workspace_roots r
         JOIN workspaces w
           ON w.organization_id = r.organization_id AND w.id = r.workspace_id
         WHERE r.organization_id = $1 AND r.workspace_id = $2 AND r.id = $3
         FOR UPDATE OF r, w`,
        [identity.organizationId, value.workspaceId, value.workingRootId],
      );
      const lockedWorktree = await client.query<{ readonly lifecycle_status: string }>(
        `SELECT lifecycle_status FROM workspace_git_worktrees
         WHERE organization_id = $1 AND workspace_id = $2 AND working_root_id = $3
         FOR UPDATE`,
        [identity.organizationId, value.workspaceId, value.workingRootId],
      );
      const finalRoot = lockedRoot.rows[0];
      if (!finalRoot) throw new WorkspaceChangeSetUnavailableError();
      if (finalRoot.operation_mode === 'observe') {
        throw new WorkspaceOperationModeDeniedError();
      }
      if (finalRoot.current_revision_id !== currentRevisionId
        || finalRoot.lifecycle_status !== 'ready'
        || lockedWorktree.rows[0]?.lifecycle_status === 'archived') {
        throw new WorkspaceChangeSetUnavailableError();
      }
      const now = this.clock.now();
      await client.query(
        `INSERT INTO workspace_revisions (
           id, organization_id, workspace_id, working_root_id, parent_revision_id,
           content_manifest_hash, git_commit_sha, content_kind, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [resultingRevisionId, identity.organizationId, value.workspaceId,
          value.workingRootId, currentRevisionId, resultManifestHash,
          resultGitCommit, resultContentKind, now],
      );
      await client.query(
        `UPDATE workspace_roots SET current_revision_id = $4
         WHERE organization_id = $1 AND workspace_id = $2 AND id = $3`,
        [identity.organizationId, value.workspaceId, value.workingRootId, resultingRevisionId],
      );
      await client.query(
        `UPDATE workspace_change_sets
         SET status = 'applied', updated_at = $4
         WHERE organization_id = $1 AND owner_principal_id = $2 AND id = $3
           AND status = 'applying'`,
        [identity.organizationId, identity.principalId, value.id, now],
      );
      await client.query('COMMIT');
      transactionStarted = false;
      value = await loadChangeSet(client, identity, command.changeSetId);
      if (!value) throw new WorkspaceNotFoundError();
      return { value, replayed };
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

  async list(
    identity: RequestIdentity,
    scope: { readonly workspaceId: WorkspaceId; readonly workingRootId: WorkingRootId },
    page: { readonly limit?: number; readonly cursor?: string } = {},
  ): Promise<WorkspaceChangeSetPage> {
    const limit = page.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new InvalidWorkspacePageLimitError();
    }
    const cursor = page.cursor ? decodeCursor(page.cursor) : undefined;
    const authorized = await this.pool.query(
      `SELECT 1 FROM workspaces w
       JOIN workspace_roots r
         ON r.organization_id = w.organization_id AND r.workspace_id = w.id
       WHERE w.organization_id = $1 AND w.owner_principal_id = $2
         AND w.id = $3 AND r.id = $4`,
      [identity.organizationId, identity.principalId, scope.workspaceId, scope.workingRootId],
    );
    if (authorized.rowCount !== 1) throw new WorkspaceNotFoundError();
    const selected = await this.pool.query<{ readonly id: string; readonly created_at: Date }>(
      `SELECT id, created_at FROM workspace_change_sets
       WHERE organization_id = $1 AND owner_principal_id = $2
         AND workspace_id = $3 AND working_root_id = $4
         AND ($5::timestamptz IS NULL OR (created_at, id) < ($5::timestamptz, $6::uuid))
       ORDER BY created_at DESC, id DESC
       LIMIT $7`,
      [identity.organizationId, identity.principalId, scope.workspaceId, scope.workingRootId,
        cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
    );
    const pageRows = selected.rows.slice(0, limit);
    const items = await Promise.all(pageRows.map(async (row) => {
      const item = await loadChangeSet(this.pool, identity, row.id as WorkspaceChangeSetId);
      if (!item) throw new WorkspaceNotFoundError();
      return item;
    }));
    const last = pageRows.at(-1);
    return selected.rows.length > limit && last
      ? { items, nextCursor: encodeCursor({
        createdAt: last.created_at.toISOString(), id: last.id,
      }) }
      : { items };
  }

  async get(
    identity: RequestIdentity,
    changeSetId: WorkspaceChangeSetId,
  ): Promise<WorkspaceChangeSet> {
    const value = await loadChangeSet(this.pool, identity, changeSetId);
    if (!value) throw new WorkspaceNotFoundError();
    return value;
  }
}
