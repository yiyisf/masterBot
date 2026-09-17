import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { OrganizationId, PrincipalId, RequestIdentity } from '@cmaster/identity';
import type { Brand, Clock } from '@cmaster/kernel';
import { SystemClock } from '@cmaster/kernel';
import type { Pool, PoolClient } from 'pg';
import {
  WorkspaceFileNotFoundError,
  WorkspaceRevisionContentError,
  type WorkspaceFileEntry,
  type WorkspaceRevisionContentReader,
  type WorkspaceRevisionContentScope,
} from './revision-content.js';

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type WorkingRootId = Brand<string, 'WorkingRootId'>;
export type WorkspaceRevisionId = Brand<string, 'WorkspaceRevisionId'>;
export type WorkspaceCommandId = Brand<string, 'WorkspaceCommandId'>;
export type WorkspaceConnectorId = Brand<string, 'WorkspaceConnectorId'>;
export type WorkspaceRepositoryId = Brand<string, 'WorkspaceRepositoryId'>;
export type GitWorktreeId = Brand<string, 'GitWorktreeId'>;

export type WorkspaceOperationMode =
  | 'observe'
  | 'edit_with_confirmation'
  | 'trusted_automation';

export interface Workspace {
  readonly id: WorkspaceId;
  readonly organizationId: OrganizationId;
  readonly ownerPrincipalId: PrincipalId;
  readonly name: string;
  readonly source:
    | { readonly kind: 'empty' }
    | {
      readonly kind: 'git';
      readonly connectorId: WorkspaceConnectorId;
      readonly repositoryId: WorkspaceRepositoryId;
      readonly defaultBranch: string;
    };
  readonly operationMode: WorkspaceOperationMode;
  readonly lifecycleStatus: 'provisioning' | 'ready' | 'failed' | 'archived';
  readonly defaultWorkingRoot: {
    readonly id: WorkingRootId;
    readonly kind: 'default' | 'git_worktree';
    readonly currentRevisionId: WorkspaceRevisionId;
  } | null;
  readonly provisioningFailure?: {
    readonly code: string;
    readonly retryable: boolean;
  } | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class WorkspaceIdempotencyConflictError extends Error {}
export class WorkspaceNotFoundError extends Error {}
export class InvalidWorkspaceNameError extends Error {}
export class InvalidWorkspaceCursorError extends Error {}
export class InvalidWorkspacePageLimitError extends Error {}
export class InvalidGitBranchNameError extends Error {}
export class WorkspaceBranchConflictError extends Error {}
export class WorkspaceLifecycleConflictError extends Error {}
export class InvalidWorkspaceFilePathError extends Error {}
export class InvalidWorkspaceFileQueryError extends Error {}
export class WorkspaceFileLimitError extends Error {}
export class WorkspaceFileContentUnavailableError extends Error {}

export interface WorkspaceCommandResult<Value> {
  readonly value: Value;
  readonly replayed: boolean;
}

export interface WorkspacePage {
  readonly items: readonly Workspace[];
  readonly nextCursor?: string;
}

/**
 * Owns Principal-private Workspace lifecycle and stable default Working Root/Revision identity.
 * Provision and lifecycle Commands are idempotent within their operation namespace: an exact retry
 * returns the current authoritative Workspace and reuse for another normalized request throws
 * WorkspaceIdempotencyConflictError. Get/reconcile/lifecycle operations use trusted Organization and
 * Principal context; missing, scope-mismatched, and unauthorized resources throw the same
 * WorkspaceNotFoundError. List is bounded, latest-first, and uses an opaque stable cursor.
 */
export interface WorkspaceCatalog {
  provisionEmpty(
    identity: RequestIdentity,
    command: {
      readonly commandId: WorkspaceCommandId;
      readonly name: string;
      readonly operationMode: WorkspaceOperationMode;
    },
  ): Promise<WorkspaceCommandResult<Workspace>>;
  provisionGit(
    identity: RequestIdentity,
    command: {
      readonly commandId: WorkspaceCommandId;
      readonly name: string;
      readonly operationMode: WorkspaceOperationMode;
      readonly source: {
        readonly connectorId: WorkspaceConnectorId;
        readonly repositoryId: WorkspaceRepositoryId;
        readonly defaultBranch: string;
      };
    },
  ): Promise<WorkspaceCommandResult<Workspace>>;
  get(identity: RequestIdentity, workspaceId: WorkspaceId): Promise<Workspace>;
  getProvisionedByCommand(
    identity: RequestIdentity,
    commandId: WorkspaceCommandId,
  ): Promise<Workspace>;
  list(
    identity: RequestIdentity,
    query: { readonly cursor?: string; readonly limit: number },
  ): Promise<WorkspacePage>;
  transitionLifecycle(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    command: {
      readonly commandId: WorkspaceCommandId;
      readonly targetStatus: Workspace['lifecycleStatus'];
    },
  ): Promise<WorkspaceCommandResult<Workspace>>;
  getLifecycleByCommand(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    commandId: WorkspaceCommandId,
  ): Promise<Workspace>;
}

interface InMemoryWorkspaceCatalogOptions {
  readonly clock?: Clock;
  readonly generateId?: () => string;
}

interface WorkspaceReceipt {
  readonly requestHash: string;
  readonly workspaceId: WorkspaceId;
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeWorkspaceName(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 120) {
    throw new InvalidWorkspaceNameError();
  }
  return normalized;
}

function validatePageLimit(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new InvalidWorkspacePageLimitError();
  }
}

function normalizeGitBranchName(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 255
    || normalized.startsWith('-') || normalized.startsWith('/')
    || normalized.endsWith('/') || normalized.endsWith('.')
    || normalized.endsWith('.lock') || normalized.includes('..')
    || normalized.includes('@{') || normalized.includes('\\')
    || normalized.includes('[') || normalized.includes(']')
    || /[\s~^:?*\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new InvalidGitBranchNameError();
  }
  return normalized;
}

interface WorkspaceCursor {
  readonly updatedAt: string;
  readonly id: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function compareWorkspaceLatestFirst(left: Workspace, right: Workspace): number {
  const byTime = right.updatedAt.getTime() - left.updatedAt.getTime();
  return byTime === 0 ? right.id.localeCompare(left.id) : byTime;
}

function compareWorkspaceToCursor(workspace: Workspace, cursor: WorkspaceCursor): number {
  const cursorTime = Date.parse(cursor.updatedAt);
  if (workspace.updatedAt.getTime() < cursorTime) return 1;
  if (workspace.updatedAt.getTime() > cursorTime) return -1;
  return workspace.id < cursor.id ? 1 : workspace.id === cursor.id ? 0 : -1;
}

function encodeWorkspaceCursor(workspace: Workspace): string {
  return Buffer.from(JSON.stringify({
    updatedAt: workspace.updatedAt.toISOString(),
    id: workspace.id,
  }), 'utf8').toString('base64url');
}

function decodeWorkspaceCursor(value: string): WorkspaceCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object'
      || !('updatedAt' in parsed) || typeof parsed.updatedAt !== 'string'
      || !('id' in parsed) || typeof parsed.id !== 'string'
      || !uuidPattern.test(parsed.id)
      || Number.isNaN(Date.parse(parsed.updatedAt))
      || new Date(parsed.updatedAt).toISOString() !== parsed.updatedAt) {
      throw new InvalidWorkspaceCursorError();
    }
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch (error) {
    if (error instanceof InvalidWorkspaceCursorError) throw error;
    throw new InvalidWorkspaceCursorError();
  }
}

class InMemoryWorkspaceCatalog implements WorkspaceCatalog {
  private readonly workspaces = new Map<WorkspaceId, Workspace>();
  private readonly provisionReceipts = new Map<string, WorkspaceReceipt>();
  private readonly lifecycleReceipts = new Map<string, WorkspaceReceipt>();

  constructor(
    private readonly clock: Clock,
    private readonly generateId: () => string,
  ) {}

  async provisionGit(
    identity: RequestIdentity,
    command: {
      readonly commandId: WorkspaceCommandId;
      readonly name: string;
      readonly operationMode: WorkspaceOperationMode;
      readonly source: {
        readonly connectorId: WorkspaceConnectorId;
        readonly repositoryId: WorkspaceRepositoryId;
        readonly defaultBranch: string;
      };
    },
  ): Promise<WorkspaceCommandResult<Workspace>> {
    const name = normalizeWorkspaceName(command.name);
    const source = {
      ...command.source,
      defaultBranch: normalizeGitBranchName(command.source.defaultBranch),
    };
    const receiptKey = `${identity.organizationId}:${identity.principalId}:${command.commandId}`;
    const hash = requestHash({
      sourceKind: 'git', name, operationMode: command.operationMode, source,
    });
    const existing = this.provisionReceipts.get(receiptKey);
    if (existing) {
      if (existing.requestHash !== hash) throw new WorkspaceIdempotencyConflictError();
      return { value: await this.get(identity, existing.workspaceId), replayed: true };
    }

    const now = this.clock.now();
    const workspace: Workspace = {
      id: this.generateId() as WorkspaceId,
      organizationId: identity.organizationId,
      ownerPrincipalId: identity.principalId,
      name,
      source: { kind: 'git', ...source },
      operationMode: command.operationMode,
      lifecycleStatus: 'provisioning',
      defaultWorkingRoot: null,
      provisioningFailure: null,
      createdAt: now,
      updatedAt: now,
    };
    this.workspaces.set(workspace.id, workspace);
    this.provisionReceipts.set(receiptKey, { requestHash: hash, workspaceId: workspace.id });
    return { value: workspace, replayed: false };
  }

  async provisionEmpty(
    identity: RequestIdentity,
    command: {
      readonly commandId: WorkspaceCommandId;
      readonly name: string;
      readonly operationMode: WorkspaceOperationMode;
    },
  ): Promise<WorkspaceCommandResult<Workspace>> {
    const name = normalizeWorkspaceName(command.name);
    const receiptKey = `${identity.organizationId}:${identity.principalId}:${command.commandId}`;
    const hash = requestHash({ sourceKind: 'empty', name, operationMode: command.operationMode });
    const existing = this.provisionReceipts.get(receiptKey);
    if (existing) {
      if (existing.requestHash !== hash) throw new WorkspaceIdempotencyConflictError();
      return { value: await this.get(identity, existing.workspaceId), replayed: true };
    }

    const now = this.clock.now();
    const workspace: Workspace = {
      id: this.generateId() as WorkspaceId,
      organizationId: identity.organizationId,
      ownerPrincipalId: identity.principalId,
      name,
      source: { kind: 'empty' },
      operationMode: command.operationMode,
      lifecycleStatus: 'ready',
      defaultWorkingRoot: {
        id: this.generateId() as WorkingRootId,
        kind: 'default',
        currentRevisionId: this.generateId() as WorkspaceRevisionId,
      },
      createdAt: now,
      updatedAt: now,
    };
    this.workspaces.set(workspace.id, workspace);
    this.provisionReceipts.set(receiptKey, { requestHash: hash, workspaceId: workspace.id });
    return { value: workspace, replayed: false };
  }

  async get(identity: RequestIdentity, workspaceId: WorkspaceId): Promise<Workspace> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace
      || workspace.organizationId !== identity.organizationId
      || workspace.ownerPrincipalId !== identity.principalId) {
      throw new WorkspaceNotFoundError();
    }
    return workspace;
  }

  async getProvisionedByCommand(
    identity: RequestIdentity,
    commandId: WorkspaceCommandId,
  ): Promise<Workspace> {
    const receipt = this.provisionReceipts.get(
      `${identity.organizationId}:${identity.principalId}:${commandId}`,
    );
    if (!receipt) throw new WorkspaceNotFoundError();
    return this.get(identity, receipt.workspaceId);
  }

  async list(
    identity: RequestIdentity,
    query: { readonly cursor?: string; readonly limit: number },
  ): Promise<WorkspacePage> {
    validatePageLimit(query.limit);
    const cursor = query.cursor === undefined ? undefined : decodeWorkspaceCursor(query.cursor);
    const owned = [...this.workspaces.values()]
      .filter((workspace) => workspace.organizationId === identity.organizationId
        && workspace.ownerPrincipalId === identity.principalId)
      .sort(compareWorkspaceLatestFirst)
      .filter((workspace) => cursor === undefined
        || compareWorkspaceToCursor(workspace, cursor) > 0);
    const items = owned.slice(0, query.limit);
    if (owned.length <= query.limit) return { items };
    return { items, nextCursor: encodeWorkspaceCursor(items.at(-1)!) };
  }

  async transitionLifecycle(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    command: {
      readonly commandId: WorkspaceCommandId;
      readonly targetStatus: Workspace['lifecycleStatus'];
    },
  ): Promise<WorkspaceCommandResult<Workspace>> {
    const current = await this.get(identity, workspaceId);
    const receiptKey = `${identity.organizationId}:${identity.principalId}:${command.commandId}`;
    const hash = requestHash({ workspaceId, targetStatus: command.targetStatus });
    const existing = this.lifecycleReceipts.get(receiptKey);
    if (existing) {
      if (existing.requestHash !== hash) throw new WorkspaceIdempotencyConflictError();
      return { value: await this.get(identity, existing.workspaceId), replayed: true };
    }
    if (!['ready', 'archived'].includes(current.lifecycleStatus)
      || !['ready', 'archived'].includes(command.targetStatus)) {
      throw new WorkspaceLifecycleConflictError();
    }
    const workspace: Workspace = {
      ...current,
      lifecycleStatus: command.targetStatus,
      updatedAt: current.lifecycleStatus === command.targetStatus
        ? current.updatedAt
        : this.clock.now(),
    };
    this.workspaces.set(workspaceId, workspace);
    this.lifecycleReceipts.set(receiptKey, { requestHash: hash, workspaceId });
    return { value: workspace, replayed: false };
  }

  async getLifecycleByCommand(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    commandId: WorkspaceCommandId,
  ): Promise<Workspace> {
    await this.get(identity, workspaceId);
    const receipt = this.lifecycleReceipts.get(
      `${identity.organizationId}:${identity.principalId}:${commandId}`,
    );
    if (!receipt || receipt.workspaceId !== workspaceId) throw new WorkspaceNotFoundError();
    return this.get(identity, receipt.workspaceId);
  }
}

export function createInMemoryWorkspaceCatalog(
  options: InMemoryWorkspaceCatalogOptions = {},
): WorkspaceCatalog {
  return new InMemoryWorkspaceCatalog(
    options.clock ?? new SystemClock(),
    options.generateId ?? randomUUID,
  );
}

interface WorkspaceRow {
  readonly id: string;
  readonly organization_id: string;
  readonly owner_principal_id: string;
  readonly name: string;
  readonly source_kind: 'empty' | 'git';
  readonly operation_mode: WorkspaceOperationMode;
  readonly lifecycle_status: Workspace['lifecycleStatus'];
  readonly working_root_id: string | null;
  readonly current_revision_id: string | null;
  readonly connector_id: string | null;
  readonly repository_id: string | null;
  readonly default_branch: string | null;
  readonly failure_code: string | null;
  readonly failure_retryable: boolean | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface WorkspaceReceiptRow extends WorkspaceRow {
  readonly request_hash: string;
}

const emptyContentManifestHash = createHash('sha256').update('').digest('hex');

const workspaceColumns = `
  w.id, w.organization_id, w.owner_principal_id, w.name, w.source_kind,
  w.operation_mode, w.lifecycle_status, w.created_at, w.updated_at,
  r.id AS working_root_id, r.current_revision_id,
  binding.connector_id, binding.repository_id, binding.default_branch,
  operation.failure_code, operation.failure_retryable`;
const workspaceFrom = `
  FROM workspaces w
  LEFT JOIN workspace_roots r
    ON r.organization_id = w.organization_id
   AND r.workspace_id = w.id
   AND r.is_default
  LEFT JOIN workspace_repository_bindings binding
    ON binding.organization_id = w.organization_id
   AND binding.workspace_id = w.id
  LEFT JOIN workspace_operations operation
    ON operation.organization_id = w.organization_id
   AND operation.workspace_id = w.id
   AND operation.operation_type = 'provision_git'`;
const workspaceSelection = `SELECT ${workspaceColumns} ${workspaceFrom}`;
const workspaceReceiptSelection = `
  SELECT receipt.request_hash, ${workspaceColumns}
    ${workspaceFrom}`;

function mapWorkspace(row: WorkspaceRow): Workspace {
  const source: Workspace['source'] = row.source_kind === 'empty'
    ? { kind: 'empty' }
    : {
      kind: 'git',
      connectorId: row.connector_id as WorkspaceConnectorId,
      repositoryId: row.repository_id as WorkspaceRepositoryId,
      defaultBranch: row.default_branch!,
    };
  const defaultWorkingRoot = row.working_root_id === null || row.current_revision_id === null
    ? null
    : {
      id: row.working_root_id as WorkingRootId,
      kind: row.source_kind === 'empty' ? 'default' as const : 'git_worktree' as const,
      currentRevisionId: row.current_revision_id as WorkspaceRevisionId,
    };
  return {
    id: row.id as WorkspaceId,
    organizationId: row.organization_id as OrganizationId,
    ownerPrincipalId: row.owner_principal_id as PrincipalId,
    name: row.name,
    source,
    operationMode: row.operation_mode,
    lifecycleStatus: row.lifecycle_status,
    defaultWorkingRoot,
    ...(row.source_kind === 'git'
      ? {
        provisioningFailure: row.failure_code === null
          ? null
          : { code: row.failure_code, retryable: row.failure_retryable! },
      }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function selectWorkspaceForOwner(
  client: PoolClient,
  identity: RequestIdentity,
  id: WorkspaceId,
  lock = false,
): Promise<Workspace> {
  const result = await client.query<WorkspaceRow>(
    `${workspaceSelection}
      WHERE w.organization_id = $1
        AND w.owner_principal_id = $2
        AND w.id = $3
      ${lock ? 'FOR UPDATE OF w' : ''}`,
    [identity.organizationId, identity.principalId, id],
  );
  const row = result.rows[0];
  if (!row) throw new WorkspaceNotFoundError();
  return mapWorkspace(row);
}

export class PostgresWorkspaceCatalog implements WorkspaceCatalog {
  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock = new SystemClock(),
    private readonly generateId: () => string = randomUUID,
  ) {}

  async provisionGit(
    identity: RequestIdentity,
    command: {
      readonly commandId: WorkspaceCommandId;
      readonly name: string;
      readonly operationMode: WorkspaceOperationMode;
      readonly source: {
        readonly connectorId: WorkspaceConnectorId;
        readonly repositoryId: WorkspaceRepositoryId;
        readonly defaultBranch: string;
      };
    },
  ): Promise<WorkspaceCommandResult<Workspace>> {
    const name = normalizeWorkspaceName(command.name);
    const source = {
      ...command.source,
      defaultBranch: normalizeGitBranchName(command.source.defaultBranch),
    };
    const hash = requestHash({
      sourceKind: 'git', name, operationMode: command.operationMode, source,
    });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${identity.organizationId}:${identity.principalId}:provision_workspace:${command.commandId}`,
      ]);
      const receipt = await client.query<WorkspaceReceiptRow>(
        `${workspaceReceiptSelection}
          JOIN workspace_operation_receipts receipt
            ON receipt.organization_id = w.organization_id
           AND receipt.workspace_id = w.id
         WHERE receipt.organization_id = $1
           AND receipt.principal_id = $2
           AND receipt.operation_type = 'provision_workspace'
           AND receipt.command_id = $3
           AND w.owner_principal_id = $2`,
        [identity.organizationId, identity.principalId, command.commandId],
      );
      const existing = receipt.rows[0];
      if (existing) {
        if (existing.request_hash !== hash) throw new WorkspaceIdempotencyConflictError();
        await client.query('COMMIT');
        return { value: mapWorkspace(existing), replayed: true };
      }

      const workspaceId = this.generateId() as WorkspaceId;
      const operationId = this.generateId();
      const outboxId = this.generateId();
      const now = this.clock.now();
      await client.query(
        `INSERT INTO workspaces (
           id, organization_id, owner_principal_id, name, source_kind,
           operation_mode, lifecycle_status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'git', $5, 'provisioning', $6, $6)`,
        [workspaceId, identity.organizationId, identity.principalId,
          name, command.operationMode, now],
      );
      await client.query(
        `INSERT INTO workspace_repository_bindings (
           organization_id, workspace_id, connector_id, repository_id, default_branch, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [identity.organizationId, workspaceId, source.connectorId,
          source.repositoryId, source.defaultBranch, now],
      );
      await client.query(
        `INSERT INTO workspace_operations (
           id, organization_id, principal_id, workspace_id, operation_type,
           status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'provision_git', 'pending', $5, $5)`,
        [operationId, identity.organizationId, identity.principalId, workspaceId, now],
      );
      await client.query(
        `INSERT INTO workspace_outbox (
           id, organization_id, operation_id, event_type, available_at, created_at
         ) VALUES ($1, $2, $3, 'git_workspace_provision_requested', $4, $4)`,
        [outboxId, identity.organizationId, operationId, now],
      );
      await client.query(
        `INSERT INTO workspace_operation_receipts (
           organization_id, principal_id, operation_type, command_id, request_hash,
           workspace_id, operation_id, created_at
         ) VALUES ($1, $2, 'provision_workspace', $3, $4, $5, $6, $7)`,
        [identity.organizationId, identity.principalId, command.commandId,
          hash, workspaceId, operationId, now],
      );
      const workspace = await selectWorkspaceForOwner(client, identity, workspaceId);
      await client.query('COMMIT');
      return { value: workspace, replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async provisionEmpty(
    identity: RequestIdentity,
    command: {
      readonly commandId: WorkspaceCommandId;
      readonly name: string;
      readonly operationMode: WorkspaceOperationMode;
    },
  ): Promise<WorkspaceCommandResult<Workspace>> {
    const name = normalizeWorkspaceName(command.name);
    const hash = requestHash({ sourceKind: 'empty', name, operationMode: command.operationMode });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${identity.organizationId}:${identity.principalId}:provision_workspace:${command.commandId}`,
      ]);
      const receipt = await client.query<WorkspaceReceiptRow>(
        `${workspaceReceiptSelection}
          JOIN workspace_operation_receipts receipt
            ON receipt.organization_id = w.organization_id
           AND receipt.workspace_id = w.id
         WHERE receipt.organization_id = $1
           AND receipt.principal_id = $2
           AND receipt.operation_type = 'provision_workspace'
           AND receipt.command_id = $3
           AND w.owner_principal_id = $2`,
        [identity.organizationId, identity.principalId, command.commandId],
      );
      const existing = receipt.rows[0];
      if (existing) {
        if (existing.request_hash !== hash) throw new WorkspaceIdempotencyConflictError();
        await client.query('COMMIT');
        return { value: mapWorkspace(existing), replayed: true };
      }

      const workspaceId = this.generateId() as WorkspaceId;
      const workingRootId = this.generateId() as WorkingRootId;
      const revisionId = this.generateId() as WorkspaceRevisionId;
      const now = this.clock.now();
      await client.query(
        `INSERT INTO workspaces (
           id, organization_id, owner_principal_id, name, source_kind,
           operation_mode, lifecycle_status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'empty', $5, 'ready', $6, $6)`,
        [workspaceId, identity.organizationId, identity.principalId,
          name, command.operationMode, now],
      );
      await client.query(
        `INSERT INTO workspace_roots (
           id, organization_id, workspace_id, root_kind, is_default,
           current_revision_id, created_at
         ) VALUES ($1, $2, $3, 'default', true, $4, $5)`,
        [workingRootId, identity.organizationId, workspaceId, revisionId, now],
      );
      await client.query(
        `INSERT INTO workspace_revisions (
           id, organization_id, workspace_id, working_root_id,
           parent_revision_id, content_manifest_hash, created_at
         ) VALUES ($1, $2, $3, $4, NULL, $5, $6)`,
        [revisionId, identity.organizationId, workspaceId, workingRootId,
          emptyContentManifestHash, now],
      );
      await client.query(
        `INSERT INTO workspace_operation_receipts (
           organization_id, principal_id, operation_type, command_id, request_hash,
           workspace_id, created_at
         ) VALUES ($1, $2, 'provision_workspace', $3, $4, $5, $6)`,
        [identity.organizationId, identity.principalId, command.commandId,
          hash, workspaceId, now],
      );
      const workspace = await selectWorkspaceForOwner(client, identity, workspaceId);
      await client.query('COMMIT');
      return { value: workspace, replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(identity: RequestIdentity, id: WorkspaceId): Promise<Workspace> {
    const client = await this.pool.connect();
    try {
      return await selectWorkspaceForOwner(client, identity, id);
    } finally {
      client.release();
    }
  }

  async getProvisionedByCommand(
    identity: RequestIdentity,
    commandId: WorkspaceCommandId,
  ): Promise<Workspace> {
    const result = await this.pool.query<WorkspaceReceiptRow>(
      `${workspaceReceiptSelection}
        JOIN workspace_operation_receipts receipt
          ON receipt.organization_id = w.organization_id
         AND receipt.workspace_id = w.id
       WHERE receipt.organization_id = $1
         AND receipt.principal_id = $2
         AND receipt.operation_type = 'provision_workspace'
         AND receipt.command_id = $3
         AND w.owner_principal_id = $2`,
      [identity.organizationId, identity.principalId, commandId],
    );
    const row = result.rows[0];
    if (!row) throw new WorkspaceNotFoundError();
    return mapWorkspace(row);
  }

  async list(
    identity: RequestIdentity,
    query: { readonly cursor?: string; readonly limit: number },
  ): Promise<WorkspacePage> {
    validatePageLimit(query.limit);
    const cursor = query.cursor === undefined ? undefined : decodeWorkspaceCursor(query.cursor);
    const values = cursor === undefined
      ? [identity.organizationId, identity.principalId, query.limit + 1]
      : [identity.organizationId, identity.principalId, cursor.updatedAt, cursor.id, query.limit + 1];
    const result = await this.pool.query<WorkspaceRow>(
      `${workspaceSelection}
        WHERE w.organization_id = $1
          AND w.owner_principal_id = $2
          ${cursor === undefined ? '' : 'AND (w.updated_at, w.id) < ($3::timestamptz, $4::uuid)'}
        ORDER BY w.updated_at DESC, w.id DESC
        LIMIT $${cursor === undefined ? '3' : '5'}`,
      values,
    );
    const hasNext = result.rows.length > query.limit;
    const items = result.rows.slice(0, query.limit).map(mapWorkspace);
    return hasNext ? { items, nextCursor: encodeWorkspaceCursor(items.at(-1)!) } : { items };
  }

  async transitionLifecycle(
    identity: RequestIdentity,
    id: WorkspaceId,
    command: {
      readonly commandId: WorkspaceCommandId;
      readonly targetStatus: Workspace['lifecycleStatus'];
    },
  ): Promise<WorkspaceCommandResult<Workspace>> {
    const hash = requestHash({ workspaceId: id, targetStatus: command.targetStatus });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${identity.organizationId}:${identity.principalId}:transition_lifecycle:${command.commandId}`,
      ]);
      const current = await selectWorkspaceForOwner(client, identity, id, true);
      const receipt = await client.query<{ request_hash: string }>(
        `SELECT request_hash
           FROM workspace_operation_receipts
          WHERE organization_id = $1
            AND principal_id = $2
            AND operation_type = 'transition_lifecycle'
            AND command_id = $3`,
        [identity.organizationId, identity.principalId, command.commandId],
      );
      const existing = receipt.rows[0];
      if (existing) {
        if (existing.request_hash !== hash) throw new WorkspaceIdempotencyConflictError();
        await client.query('COMMIT');
        return { value: current, replayed: true };
      }
      if (!['ready', 'archived'].includes(current.lifecycleStatus)
        || !['ready', 'archived'].includes(command.targetStatus)) {
        throw new WorkspaceLifecycleConflictError();
      }
      const updatedAt = current.lifecycleStatus === command.targetStatus
        ? current.updatedAt
        : this.clock.now();
      if (current.lifecycleStatus !== command.targetStatus) {
        await client.query(
          `UPDATE workspaces SET lifecycle_status = $1, updated_at = $2
            WHERE organization_id = $3 AND owner_principal_id = $4 AND id = $5`,
          [command.targetStatus, updatedAt, identity.organizationId, identity.principalId, id],
        );
      }
      await client.query(
        `INSERT INTO workspace_operation_receipts (
           organization_id, principal_id, operation_type, command_id, request_hash,
           workspace_id, created_at
         ) VALUES ($1, $2, 'transition_lifecycle', $3, $4, $5, $6)`,
        [identity.organizationId, identity.principalId, command.commandId,
          hash, id, this.clock.now()],
      );
      const workspace: Workspace = {
        ...current,
        lifecycleStatus: command.targetStatus,
        updatedAt,
      };
      await client.query('COMMIT');
      return { value: workspace, replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getLifecycleByCommand(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    commandId: WorkspaceCommandId,
  ): Promise<Workspace> {
    const result = await this.pool.query<WorkspaceReceiptRow>(
      `${workspaceReceiptSelection}
        JOIN workspace_operation_receipts receipt
          ON receipt.organization_id = w.organization_id
         AND receipt.workspace_id = w.id
       WHERE receipt.organization_id = $1
         AND receipt.principal_id = $2
         AND receipt.operation_type = 'transition_lifecycle'
         AND receipt.command_id = $3
         AND receipt.workspace_id = $4
         AND w.owner_principal_id = $2`,
      [identity.organizationId, identity.principalId, commandId, workspaceId],
    );
    const row = result.rows[0];
    if (!row) throw new WorkspaceNotFoundError();
    return mapWorkspace(row);
  }
}

export interface GitWorktree {
  readonly id: GitWorktreeId;
  readonly workspaceId: WorkspaceId;
  readonly workingRootId: WorkingRootId;
  readonly branchName: string;
  readonly headCommit: string;
  readonly lifecycleStatus: 'ready' | 'archived';
  readonly isDefault: boolean;
  readonly currentRevisionId: WorkspaceRevisionId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GitWorktreePage {
  readonly items: readonly GitWorktree[];
  readonly nextCursor?: string;
}

export interface WorkspaceFileScope {
  readonly workspaceId: WorkspaceId;
  readonly workingRootId: WorkingRootId;
  readonly revisionId: WorkspaceRevisionId;
}

export interface WorkspaceFilePage {
  readonly items: readonly WorkspaceFileEntry[];
  readonly nextCursor?: string;
}

export interface WorkspaceFileContent extends WorkspaceFileEntry {
  readonly encoding: 'utf8';
  readonly content: string;
}

export interface WorkspaceFileSearchResult {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly preview: string;
}

export interface WorkspaceFileSearchPage {
  readonly items: readonly WorkspaceFileSearchResult[];
  readonly nextCursor?: string;
}

export interface WorktreeOperation {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly branchName: string;
  readonly status: 'pending' | 'running' | 'succeeded' | 'failed';
  readonly failure?: { readonly code: string; readonly retryable: boolean } | null;
}

export interface WorkspaceWorkingRoots {
  listWorktrees(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    query: { readonly cursor?: string; readonly limit: number },
  ): Promise<GitWorktreePage>;
  createWorktree(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    command: { readonly commandId: WorkspaceCommandId; readonly branchName: string },
  ): Promise<WorkspaceCommandResult<WorktreeOperation>>;
  archiveWorktree(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    worktreeId: GitWorktreeId,
    command: { readonly commandId: WorkspaceCommandId },
  ): Promise<WorkspaceCommandResult<GitWorktree>>;
  getWorktreeOperationByCommand(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    commandId: WorkspaceCommandId,
  ): Promise<WorktreeOperation>;
  getWorktreeLifecycleByCommand(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    worktreeId: GitWorktreeId,
    commandId: WorkspaceCommandId,
  ): Promise<GitWorktree>;
  listFiles(
    identity: RequestIdentity,
    scope: WorkspaceFileScope,
    query: { readonly cursor?: string; readonly limit: number },
  ): Promise<WorkspaceFilePage>;
  openFile(
    identity: RequestIdentity,
    request: WorkspaceFileScope & { readonly path: string },
  ): Promise<WorkspaceFileContent>;
  searchFiles(
    identity: RequestIdentity,
    scope: WorkspaceFileScope,
    query: { readonly query: string; readonly cursor?: string; readonly limit: number },
  ): Promise<WorkspaceFileSearchPage>;
}

interface WorktreeOperationRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly branch_name: string;
  readonly status: WorktreeOperation['status'];
  readonly failure_code: string | null;
  readonly failure_retryable: boolean | null;
}

function mapWorktreeOperation(row: WorktreeOperationRow): WorktreeOperation {
  return {
    id: row.id,
    workspaceId: row.workspace_id as WorkspaceId,
    branchName: row.branch_name,
    status: row.status,
    failure: row.failure_code === null
      ? null
      : { code: row.failure_code, retryable: row.failure_retryable! },
  };
}

interface GitWorktreeRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly working_root_id: string;
  readonly branch_name: string;
  readonly head_commit: string;
  readonly lifecycle_status: 'ready' | 'archived';
  readonly is_default: boolean;
  readonly current_revision_id: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface GitWorktreeCursor {
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly id: string;
}

function encodeGitWorktreeCursor(worktree: GitWorktree): string {
  return Buffer.from(JSON.stringify({
    isDefault: worktree.isDefault,
    createdAt: worktree.createdAt.toISOString(),
    id: worktree.id,
  }), 'utf8').toString('base64url');
}

function decodeGitWorktreeCursor(value: string): GitWorktreeCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object'
      || !('isDefault' in parsed) || typeof parsed.isDefault !== 'boolean'
      || !('createdAt' in parsed) || typeof parsed.createdAt !== 'string'
      || Number.isNaN(Date.parse(parsed.createdAt))
      || new Date(parsed.createdAt).toISOString() !== parsed.createdAt
      || !('id' in parsed) || typeof parsed.id !== 'string' || !uuidPattern.test(parsed.id)) {
      throw new InvalidWorkspaceCursorError();
    }
    return { isDefault: parsed.isDefault, createdAt: parsed.createdAt, id: parsed.id };
  } catch (error) {
    if (error instanceof InvalidWorkspaceCursorError) throw error;
    throw new InvalidWorkspaceCursorError();
  }
}

function mapGitWorktree(row: GitWorktreeRow): GitWorktree {
  return {
    id: row.id as GitWorktreeId,
    workspaceId: row.workspace_id as WorkspaceId,
    workingRootId: row.working_root_id as WorkingRootId,
    branchName: row.branch_name,
    headCommit: row.head_commit,
    lifecycleStatus: row.lifecycle_status,
    isDefault: row.is_default,
    currentRevisionId: row.current_revision_id as WorkspaceRevisionId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const gitWorktreeColumns = `
  worktree.id, worktree.workspace_id, worktree.working_root_id,
  worktree.branch_name, worktree.head_commit, worktree.lifecycle_status,
  root.is_default, root.current_revision_id, worktree.created_at, worktree.updated_at`;

async function selectWorktreeForOwner(
  client: PoolClient,
  identity: RequestIdentity,
  workspaceId: WorkspaceId,
  worktreeId: GitWorktreeId,
  lock = false,
): Promise<GitWorktree> {
  const result = await client.query<GitWorktreeRow>(
    `SELECT ${gitWorktreeColumns}
       FROM workspace_git_worktrees worktree
       JOIN workspace_roots root
         ON root.organization_id = worktree.organization_id
        AND root.id = worktree.working_root_id
       JOIN workspaces workspace
         ON workspace.organization_id = worktree.organization_id
        AND workspace.id = worktree.workspace_id
      WHERE worktree.organization_id = $1
        AND workspace.owner_principal_id = $2
        AND worktree.workspace_id = $3
        AND worktree.id = $4
      ${lock ? 'FOR UPDATE OF worktree' : ''}`,
    [identity.organizationId, identity.principalId, workspaceId, worktreeId],
  );
  const row = result.rows[0];
  if (!row) throw new WorkspaceNotFoundError();
  return mapGitWorktree(row);
}

interface WorkspaceFileRow {
  readonly path: string;
  readonly media_type: string;
  readonly size_bytes: number;
  readonly sha256: string;
}

interface WorkspaceRevisionScopeRow {
  readonly source_kind: 'empty' | 'git';
  readonly git_commit_sha: string | null;
  readonly file_index_status: 'pending' | 'ready';
}

function normalizeWorkspaceFilePath(value: string): string {
  if (value.length === 0 || value.length > 1024 || value !== value.normalize('NFC')
    || value.startsWith('/') || value.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(value)
    || value.split('/').some((segment) => segment.length === 0
      || segment === '.' || segment === '..')) {
    throw new InvalidWorkspaceFilePathError();
  }
  return value;
}

function validateFilePageLimit(value: number, maximum: number): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new WorkspaceFileLimitError();
  }
}

function encodeFileCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeFileListCursor(value: string): { readonly path: string } {
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new InvalidWorkspaceCursorError();
    const parsed: unknown = JSON.parse(decoded.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length !== 1
      || !('path' in parsed) || typeof parsed.path !== 'string') {
      throw new InvalidWorkspaceCursorError();
    }
    return { path: normalizeWorkspaceFilePath(parsed.path) };
  } catch (error) {
    if (error instanceof InvalidWorkspaceCursorError) throw error;
    throw new InvalidWorkspaceCursorError();
  }
}

interface WorkspaceSearchCursor {
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

function decodeFileSearchCursor(value: string): WorkspaceSearchCursor {
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
    return {
      path: normalizeWorkspaceFilePath(parsed.path),
      line: parsed.line as number,
      column: parsed.column as number,
    };
  } catch (error) {
    if (error instanceof InvalidWorkspaceCursorError) throw error;
    throw new InvalidWorkspaceCursorError();
  }
}

function mapWorkspaceFile(row: WorkspaceFileRow): WorkspaceFileEntry {
  return {
    path: row.path,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
  };
}

export class PostgresWorkspaceWorkingRoots implements WorkspaceWorkingRoots {
  private readonly clock: Clock;
  private readonly generateId: () => string;
  private readonly revisionContent: WorkspaceRevisionContentReader | undefined;

  constructor(
    private readonly pool: Pool,
    options: {
      readonly clock?: Clock;
      readonly generateId?: () => string;
      readonly revisionContent?: WorkspaceRevisionContentReader;
    } = {},
  ) {
    this.clock = options.clock ?? new SystemClock();
    this.generateId = options.generateId ?? randomUUID;
    this.revisionContent = options.revisionContent;
  }

  async listWorktrees(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    query: { readonly cursor?: string; readonly limit: number },
  ): Promise<GitWorktreePage> {
    validatePageLimit(query.limit);
    const cursor = query.cursor === undefined ? undefined : decodeGitWorktreeCursor(query.cursor);
    const client = await this.pool.connect();
    try {
      const workspace = await selectWorkspaceForOwner(client, identity, workspaceId);
      if (workspace.source.kind !== 'git') throw new WorkspaceNotFoundError();
      const values = cursor === undefined
        ? [identity.organizationId, workspaceId, query.limit + 1]
        : [identity.organizationId, workspaceId, cursor.isDefault,
          cursor.createdAt, cursor.id, query.limit + 1];
      const result = await client.query<GitWorktreeRow>(
        `SELECT ${gitWorktreeColumns}
           FROM workspace_git_worktrees worktree
           JOIN workspace_roots root
             ON root.organization_id = worktree.organization_id
            AND root.id = worktree.working_root_id
          WHERE worktree.organization_id = $1 AND worktree.workspace_id = $2
            ${cursor === undefined
              ? ''
              : 'AND (root.is_default, worktree.created_at, worktree.id) < ($3::boolean, $4::timestamptz, $5::uuid)'}
          ORDER BY root.is_default DESC, worktree.created_at DESC, worktree.id DESC
          LIMIT $${cursor === undefined ? '3' : '6'}`,
        values,
      );
      const hasNext = result.rows.length > query.limit;
      const items = result.rows.slice(0, query.limit).map(mapGitWorktree);
      return hasNext
        ? { items, nextCursor: encodeGitWorktreeCursor(items.at(-1)!) }
        : { items };
    } finally {
      client.release();
    }
  }

  async createWorktree(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    command: { readonly commandId: WorkspaceCommandId; readonly branchName: string },
  ): Promise<WorkspaceCommandResult<WorktreeOperation>> {
    const branchName = normalizeGitBranchName(command.branchName);
    const hash = requestHash({ workspaceId, branchName });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${identity.organizationId}:${identity.principalId}:create_worktree:${command.commandId}`,
      ]);
      const workspace = await selectWorkspaceForOwner(client, identity, workspaceId, true);
      if (workspace.source.kind !== 'git' || workspace.lifecycleStatus !== 'ready') {
        throw new WorkspaceNotFoundError();
      }
      const receipt = await client.query<WorktreeOperationRow & { request_hash: string }>(
        `SELECT receipt.request_hash, operation.id, operation.workspace_id,
                operation.branch_name, operation.status,
                operation.failure_code, operation.failure_retryable
           FROM workspace_operation_receipts receipt
           JOIN workspace_operations operation
             ON operation.organization_id = receipt.organization_id
            AND operation.id = receipt.operation_id
          WHERE receipt.organization_id = $1
            AND receipt.principal_id = $2
            AND receipt.operation_type = 'create_worktree'
            AND receipt.command_id = $3`,
        [identity.organizationId, identity.principalId, command.commandId],
      );
      const existing = receipt.rows[0];
      if (existing) {
        if (existing.request_hash !== hash) throw new WorkspaceIdempotencyConflictError();
        await client.query('COMMIT');
        return { value: mapWorktreeOperation(existing), replayed: true };
      }
      const branch = await client.query(
        `SELECT 1 FROM workspace_git_worktrees
          WHERE organization_id = $1 AND workspace_id = $2 AND branch_name = $3`,
        [identity.organizationId, workspaceId, branchName],
      );
      if (branch.rowCount !== 0) throw new WorkspaceBranchConflictError();

      const operationId = this.generateId();
      const outboxId = this.generateId();
      const now = this.clock.now();
      await client.query(
        `INSERT INTO workspace_operations (
           id, organization_id, principal_id, workspace_id, operation_type,
           branch_name, status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'create_worktree', $5, 'pending', $6, $6)`,
        [operationId, identity.organizationId, identity.principalId,
          workspaceId, branchName, now],
      );
      await client.query(
        `INSERT INTO workspace_outbox (
           id, organization_id, operation_id, event_type, available_at, created_at
         ) VALUES ($1, $2, $3, 'git_worktree_create_requested', $4, $4)`,
        [outboxId, identity.organizationId, operationId, now],
      );
      await client.query(
        `INSERT INTO workspace_operation_receipts (
           organization_id, principal_id, operation_type, command_id, request_hash,
           workspace_id, operation_id, created_at
         ) VALUES ($1, $2, 'create_worktree', $3, $4, $5, $6, $7)`,
        [identity.organizationId, identity.principalId, command.commandId,
          hash, workspaceId, operationId, now],
      );
      const operation: WorktreeOperation = {
        id: operationId,
        workspaceId,
        branchName,
        status: 'pending',
        failure: null,
      };
      await client.query('COMMIT');
      return { value: operation, replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') {
        throw new WorkspaceBranchConflictError();
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async archiveWorktree(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    worktreeId: GitWorktreeId,
    command: { readonly commandId: WorkspaceCommandId },
  ): Promise<WorkspaceCommandResult<GitWorktree>> {
    const hash = requestHash({ workspaceId, worktreeId, targetStatus: 'archived' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${identity.organizationId}:${identity.principalId}:archive_worktree:${command.commandId}`,
      ]);
      await selectWorkspaceForOwner(client, identity, workspaceId, true);
      const current = await selectWorktreeForOwner(
        client, identity, workspaceId, worktreeId, true,
      );
      const receipt = await client.query<{ request_hash: string }>(
        `SELECT request_hash FROM workspace_operation_receipts
          WHERE organization_id = $1 AND principal_id = $2
            AND operation_type = 'archive_worktree' AND command_id = $3`,
        [identity.organizationId, identity.principalId, command.commandId],
      );
      const existing = receipt.rows[0];
      if (existing) {
        if (existing.request_hash !== hash) throw new WorkspaceIdempotencyConflictError();
        await client.query('COMMIT');
        return { value: current, replayed: true };
      }
      if (current.isDefault) throw new WorkspaceBranchConflictError();
      const updatedAt = current.lifecycleStatus === 'archived'
        ? current.updatedAt
        : this.clock.now();
      if (current.lifecycleStatus !== 'archived') {
        await client.query(
          `UPDATE workspace_git_worktrees
              SET lifecycle_status = 'archived', updated_at = $1
            WHERE organization_id = $2 AND workspace_id = $3 AND id = $4`,
          [updatedAt, identity.organizationId, workspaceId, worktreeId],
        );
      }
      await client.query(
        `INSERT INTO workspace_operation_receipts (
           organization_id, principal_id, operation_type, command_id, request_hash,
           workspace_id, worktree_id, created_at
         ) VALUES ($1, $2, 'archive_worktree', $3, $4, $5, $6, $7)`,
        [identity.organizationId, identity.principalId, command.commandId,
          hash, workspaceId, worktreeId, this.clock.now()],
      );
      await client.query('COMMIT');
      return {
        value: { ...current, lifecycleStatus: 'archived', updatedAt },
        replayed: false,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getWorktreeOperationByCommand(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    commandId: WorkspaceCommandId,
  ): Promise<WorktreeOperation> {
    const result = await this.pool.query<WorktreeOperationRow>(
      `SELECT operation.id, operation.workspace_id, operation.branch_name,
              operation.status, operation.failure_code, operation.failure_retryable
         FROM workspace_operation_receipts receipt
         JOIN workspace_operations operation
           ON operation.organization_id = receipt.organization_id
          AND operation.id = receipt.operation_id
         JOIN workspaces workspace
           ON workspace.organization_id = receipt.organization_id
          AND workspace.id = receipt.workspace_id
        WHERE receipt.organization_id = $1 AND receipt.principal_id = $2
          AND workspace.owner_principal_id = $2
          AND receipt.operation_type = 'create_worktree'
          AND receipt.command_id = $3 AND receipt.workspace_id = $4`,
      [identity.organizationId, identity.principalId, commandId, workspaceId],
    );
    const row = result.rows[0];
    if (!row) throw new WorkspaceNotFoundError();
    return mapWorktreeOperation(row);
  }

  async getWorktreeLifecycleByCommand(
    identity: RequestIdentity,
    workspaceId: WorkspaceId,
    worktreeId: GitWorktreeId,
    commandId: WorkspaceCommandId,
  ): Promise<GitWorktree> {
    const receipt = await this.pool.query(
      `SELECT 1 FROM workspace_operation_receipts receipt
         JOIN workspaces workspace
           ON workspace.organization_id = receipt.organization_id
          AND workspace.id = receipt.workspace_id
        WHERE receipt.organization_id = $1 AND receipt.principal_id = $2
          AND workspace.owner_principal_id = $2
          AND receipt.operation_type = 'archive_worktree'
          AND receipt.command_id = $3 AND receipt.workspace_id = $4
          AND receipt.worktree_id = $5`,
      [identity.organizationId, identity.principalId, commandId, workspaceId, worktreeId],
    );
    if (receipt.rowCount !== 1) throw new WorkspaceNotFoundError();
    const client = await this.pool.connect();
    try {
      return await selectWorktreeForOwner(client, identity, workspaceId, worktreeId);
    } finally {
      client.release();
    }
  }

  async listFiles(
    identity: RequestIdentity,
    scope: WorkspaceFileScope,
    query: { readonly cursor?: string; readonly limit: number },
  ): Promise<WorkspaceFilePage> {
    validateFilePageLimit(query.limit, 100);
    const cursor = query.cursor === undefined ? undefined : decodeFileListCursor(query.cursor);
    await this.ensureRevisionIndexed(identity, scope);
    const result = await this.pool.query<WorkspaceFileRow>(
      `SELECT path, media_type, size_bytes, sha256
         FROM workspace_file_entries
        WHERE organization_id = $1 AND workspace_id = $2
          AND working_root_id = $3 AND revision_id = $4
          ${cursor ? 'AND path > $5' : ''}
        ORDER BY path
        LIMIT $${cursor ? '6' : '5'}`,
      cursor
        ? [identity.organizationId, scope.workspaceId, scope.workingRootId,
          scope.revisionId, cursor.path, query.limit + 1]
        : [identity.organizationId, scope.workspaceId, scope.workingRootId,
          scope.revisionId, query.limit + 1],
    );
    const hasNext = result.rows.length > query.limit;
    const items = result.rows.slice(0, query.limit).map(mapWorkspaceFile);
    return hasNext
      ? { items, nextCursor: encodeFileCursor({ path: items.at(-1)!.path }) }
      : { items };
  }

  async openFile(
    identity: RequestIdentity,
    request: WorkspaceFileScope & { readonly path: string },
  ): Promise<WorkspaceFileContent> {
    const path = normalizeWorkspaceFilePath(request.path);
    const scope = await this.ensureRevisionIndexed(identity, request);
    const metadata = await this.pool.query<WorkspaceFileRow>(
      `SELECT path, media_type, size_bytes, sha256
         FROM workspace_file_entries
        WHERE organization_id = $1 AND workspace_id = $2
          AND working_root_id = $3 AND revision_id = $4 AND path = $5`,
      [identity.organizationId, request.workspaceId, request.workingRootId,
        request.revisionId, path],
    );
    const row = metadata.rows[0];
    if (!row || !this.revisionContent) throw new WorkspaceNotFoundError();
    let bytes: Buffer;
    try {
      bytes = await this.revisionContent.open({ ...scope, path });
    } catch (error) {
      if (error instanceof WorkspaceFileNotFoundError) throw new WorkspaceNotFoundError();
      this.translateContentError(error);
    }
    if (bytes!.length !== row.size_bytes
      || createHash('sha256').update(bytes!).digest('hex') !== row.sha256) {
      throw new WorkspaceFileContentUnavailableError();
    }
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes!);
    } catch {
      throw new WorkspaceNotFoundError();
    }
    return { ...mapWorkspaceFile(row), encoding: 'utf8', content };
  }

  async searchFiles(
    identity: RequestIdentity,
    scope: WorkspaceFileScope,
    query: { readonly query: string; readonly cursor?: string; readonly limit: number },
  ): Promise<WorkspaceFileSearchPage> {
    validateFilePageLimit(query.limit, 50);
    if (query.query.length === 0 || query.query.length > 200
      || query.query !== query.query.normalize('NFC')
      || /[\u0000-\u001f\u007f]/u.test(query.query)) {
      throw new InvalidWorkspaceFileQueryError();
    }
    const cursor = query.cursor === undefined ? undefined : decodeFileSearchCursor(query.cursor);
    await this.ensureRevisionIndexed(identity, scope);
    const indexed = await this.pool.query<WorkspaceFileRow>(
      `SELECT path, media_type, size_bytes, sha256
         FROM workspace_file_entries
        WHERE organization_id = $1 AND workspace_id = $2
          AND working_root_id = $3 AND revision_id = $4
        ORDER BY path`,
      [identity.organizationId, scope.workspaceId, scope.workingRootId, scope.revisionId],
    );
    if (indexed.rows.length > 1_000
      || indexed.rows.reduce((total, row) => total + row.size_bytes, 0) > 8 * 1_048_576) {
      throw new WorkspaceFileLimitError();
    }
    const matches: WorkspaceFileSearchResult[] = [];
    for (const file of indexed.rows) {
      const opened = await this.openFile(identity, { ...scope, path: file.path });
      const lines = opened.content.split('\n');
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex]!;
        let from = 0;
        while (from <= line.length) {
          const found = line.indexOf(query.query, from);
          if (found < 0) break;
          const match = {
            path: file.path,
            line: lineIndex + 1,
            column: found + 1,
            preview: line.length <= 500 ? line : line.slice(Math.max(0, found - 200), found + 300),
          };
          const afterCursor = cursor === undefined
            || match.path > cursor.path
            || (match.path === cursor.path && (match.line > cursor.line
              || (match.line === cursor.line && match.column > cursor.column)));
          if (afterCursor) matches.push(match);
          if (matches.length > query.limit) break;
          from = found + Math.max(1, query.query.length);
        }
        if (matches.length > query.limit) break;
      }
      if (matches.length > query.limit) break;
    }
    const hasNext = matches.length > query.limit;
    const items = matches.slice(0, query.limit);
    const last = items.at(-1);
    return hasNext && last
      ? { items, nextCursor: encodeFileCursor({
        path: last.path, line: last.line, column: last.column,
      }) }
      : { items };
  }

  private async ensureRevisionIndexed(
    identity: RequestIdentity,
    scope: WorkspaceFileScope,
  ): Promise<WorkspaceRevisionContentScope> {
    const selected = await this.pool.query<WorkspaceRevisionScopeRow>(
      `SELECT workspace.source_kind, revision.git_commit_sha, revision.file_index_status
         FROM workspaces workspace
         JOIN workspace_roots root
           ON root.organization_id = workspace.organization_id
          AND root.workspace_id = workspace.id
         JOIN workspace_revisions revision
           ON revision.organization_id = root.organization_id
          AND revision.working_root_id = root.id
        WHERE workspace.organization_id = $1 AND workspace.owner_principal_id = $2
          AND workspace.id = $3 AND root.id = $4 AND revision.id = $5`,
      [identity.organizationId, identity.principalId, scope.workspaceId,
        scope.workingRootId, scope.revisionId],
    );
    const revision = selected.rows[0];
    if (!revision) throw new WorkspaceNotFoundError();
    const contentScope: WorkspaceRevisionContentScope = {
      organizationId: identity.organizationId,
      ...scope,
      source: revision.source_kind === 'empty'
        ? { kind: 'empty' }
        : { kind: 'git', commit: revision.git_commit_sha! },
    };
    if (revision.file_index_status === 'ready') return contentScope;
    if (!this.revisionContent) throw new WorkspaceFileContentUnavailableError();
    let entries: readonly WorkspaceFileEntry[];
    try {
      entries = await this.revisionContent.list(contentScope);
      const paths = new Set<string>();
      if (entries.length > 10_000) throw new WorkspaceFileLimitError();
      for (const entry of entries) {
        const path = normalizeWorkspaceFilePath(entry.path);
        if (path !== entry.path || paths.has(path)
          || entry.mediaType.length < 1 || entry.mediaType.length > 100
          || !Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 0
          || entry.sizeBytes > 1_048_576 || !/^[0-9a-f]{64}$/u.test(entry.sha256)) {
          throw new WorkspaceFileContentUnavailableError();
        }
        paths.add(path);
      }
    } catch (error) {
      if (error instanceof WorkspaceFileLimitError
        || error instanceof WorkspaceFileContentUnavailableError) throw error;
      this.translateContentError(error);
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{ file_index_status: 'pending' | 'ready' }>(
        `SELECT file_index_status FROM workspace_revisions
          WHERE organization_id = $1 AND working_root_id = $2 AND id = $3 FOR UPDATE`,
        [identity.organizationId, scope.workingRootId, scope.revisionId],
      );
      if (!locked.rows[0]) throw new WorkspaceNotFoundError();
      if (locked.rows[0].file_index_status === 'pending') {
        const now = this.clock.now();
        for (const entry of entries!) {
          await client.query(
            `INSERT INTO workspace_file_entries (
               organization_id, workspace_id, working_root_id, revision_id,
               path, media_type, size_bytes, sha256, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [identity.organizationId, scope.workspaceId, scope.workingRootId, scope.revisionId,
              entry.path, entry.mediaType, entry.sizeBytes, entry.sha256, now],
          );
        }
        await client.query(
          `UPDATE workspace_revisions SET file_index_status = 'ready'
            WHERE organization_id = $1 AND working_root_id = $2 AND id = $3`,
          [identity.organizationId, scope.workingRootId, scope.revisionId],
        );
      }
      await client.query('COMMIT');
      return contentScope;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private translateContentError(error: unknown): never {
    if (error instanceof WorkspaceRevisionContentError
      && error.code === 'content_limit_exceeded') throw new WorkspaceFileLimitError();
    throw new WorkspaceFileContentUnavailableError();
  }
}

export interface GitWorkspaceProvisioner {
  provision(request: {
    readonly operationId: string;
    readonly organizationId: OrganizationId;
    readonly principalId: PrincipalId;
    readonly workspaceId: WorkspaceId;
    readonly connectorId: WorkspaceConnectorId;
    readonly repositoryId: WorkspaceRepositoryId;
    readonly defaultBranch: string;
  }): Promise<{
    readonly headCommit: string;
    readonly contentManifestHash: string;
  }>;
  createWorktree(request: {
    readonly operationId: string;
    readonly organizationId: OrganizationId;
    readonly principalId: PrincipalId;
    readonly workspaceId: WorkspaceId;
    readonly connectorId: WorkspaceConnectorId;
    readonly repositoryId: WorkspaceRepositoryId;
    readonly branchName: string;
    readonly baseCommit: string;
  }): Promise<{
    readonly headCommit: string;
    readonly contentManifestHash: string;
  }>;
}

export class GitWorkspaceProvisioningError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

const safeGitFailureCodes = new Set([
  'credential_lease_expired',
  'credential_unavailable',
  'git_branch_conflict',
  'git_clone_failed',
  'git_provision_failed',
  'git_worktree_create_failed',
  'repository_source_not_found',
  'workspace_content_corrupt',
  'workspace_content_unavailable',
]);

function safeGitFailure(error: unknown, fallbackCode: string): GitWorkspaceProvisioningError {
  if (error instanceof GitWorkspaceProvisioningError && safeGitFailureCodes.has(error.code)) {
    return error;
  }
  return new GitWorkspaceProvisioningError(fallbackCode, true);
}

interface ProvisionOperationRow {
  readonly id: string;
  readonly organization_id: string;
  readonly principal_id: string;
  readonly workspace_id: string;
  readonly connector_id: string;
  readonly repository_id: string;
  readonly default_branch: string;
}

export class PostgresWorkspaceProvisioningWorker {
  private readonly clock: Clock;
  private readonly generateId: () => string;

  constructor(
    private readonly pool: Pool,
    private readonly provisioner: GitWorkspaceProvisioner,
    private readonly options: {
      readonly workerId: string;
      readonly leaseTtlMs: number;
      readonly clock?: Clock;
      readonly generateId?: () => string;
    },
  ) {
    this.clock = options.clock ?? new SystemClock();
    this.generateId = options.generateId ?? randomUUID;
  }

  async executeOne(): Promise<boolean> {
    const operation = await this.leaseNext();
    if (!operation) return false;
    let result: { readonly headCommit: string; readonly contentManifestHash: string };
    try {
      result = await this.provisioner.provision({
        operationId: operation.id,
        organizationId: operation.organization_id as OrganizationId,
        principalId: operation.principal_id as PrincipalId,
        workspaceId: operation.workspace_id as WorkspaceId,
        connectorId: operation.connector_id as WorkspaceConnectorId,
        repositoryId: operation.repository_id as WorkspaceRepositoryId,
        defaultBranch: operation.default_branch,
      });
    } catch (error) {
      await this.fail(operation, safeGitFailure(error, 'git_provision_failed'));
      return true;
    }
    await this.complete(operation, result);
    return true;
  }

  private async leaseNext(): Promise<ProvisionOperationRow | undefined> {
    const client = await this.pool.connect();
    const now = this.clock.now();
    const leaseExpiresAt = new Date(now.getTime() + this.options.leaseTtlMs);
    try {
      await client.query('BEGIN');
      const selected = await client.query<ProvisionOperationRow>(
        `SELECT operation.id, operation.organization_id, operation.principal_id,
                operation.workspace_id, binding.connector_id, binding.repository_id,
                binding.default_branch
           FROM workspace_operations operation
           JOIN workspace_repository_bindings binding
             ON binding.organization_id = operation.organization_id
            AND binding.workspace_id = operation.workspace_id
          WHERE operation.operation_type = 'provision_git'
            AND (operation.status = 'pending'
             OR (operation.status = 'running' AND operation.lease_expires_at < $1))
            AND EXISTS (
              SELECT 1 FROM workspace_outbox outbox
               WHERE outbox.organization_id = operation.organization_id
                 AND outbox.operation_id = operation.id
                 AND outbox.delivered_at IS NULL
            )
          ORDER BY operation.created_at, operation.id
          FOR UPDATE OF operation SKIP LOCKED
          LIMIT 1`,
        [now],
      );
      const operation = selected.rows[0];
      if (!operation) {
        await client.query('COMMIT');
        return undefined;
      }
      await client.query(
        `UPDATE workspace_operations
            SET status = 'running', lease_owner = $1, lease_expires_at = $2, updated_at = $3
          WHERE organization_id = $4 AND id = $5`,
        [this.options.workerId, leaseExpiresAt, now, operation.organization_id, operation.id],
      );
      await client.query('COMMIT');
      return operation;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async complete(
    operation: ProvisionOperationRow,
    result: { readonly headCommit: string; readonly contentManifestHash: string },
  ): Promise<void> {
    const client = await this.pool.connect();
    const now = this.clock.now();
    const workingRootId = this.generateId() as WorkingRootId;
    const revisionId = this.generateId() as WorkspaceRevisionId;
    const worktreeId = this.generateId() as GitWorktreeId;
    try {
      await client.query('BEGIN');
      const leased = await client.query(
        `SELECT 1 FROM workspace_operations
          WHERE organization_id = $1 AND id = $2 AND status = 'running'
            AND lease_owner = $3 AND lease_expires_at >= $4
          FOR UPDATE`,
        [operation.organization_id, operation.id, this.options.workerId, now],
      );
      if (leased.rowCount !== 1) {
        await client.query('ROLLBACK');
        return;
      }
      await client.query(
        `INSERT INTO workspace_roots (
           id, organization_id, workspace_id, root_kind, is_default,
           current_revision_id, created_at
         ) VALUES ($1, $2, $3, 'git_worktree', true, $4, $5)`,
        [workingRootId, operation.organization_id, operation.workspace_id, revisionId, now],
      );
      await client.query(
        `INSERT INTO workspace_revisions (
           id, organization_id, workspace_id, working_root_id, parent_revision_id,
           content_manifest_hash, git_commit_sha, created_at
         ) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)`,
        [revisionId, operation.organization_id, operation.workspace_id, workingRootId,
          result.contentManifestHash, result.headCommit, now],
      );
      await client.query(
        `INSERT INTO workspace_git_worktrees (
           id, organization_id, workspace_id, working_root_id, branch_name, head_commit,
           lifecycle_status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'ready', $7, $7)`,
        [worktreeId, operation.organization_id, operation.workspace_id, workingRootId,
          operation.default_branch, result.headCommit, now],
      );
      await client.query(
        `UPDATE workspaces SET lifecycle_status = 'ready', updated_at = $1
          WHERE organization_id = $2 AND id = $3`,
        [now, operation.organization_id, operation.workspace_id],
      );
      await client.query(
        `UPDATE workspace_operations
            SET status = 'succeeded', result_worktree_id = $1,
                lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
          WHERE organization_id = $3 AND id = $4`,
        [worktreeId, now, operation.organization_id, operation.id],
      );
      await client.query(
        `UPDATE workspace_outbox SET delivered_at = $1
          WHERE organization_id = $2 AND operation_id = $3 AND delivered_at IS NULL`,
        [now, operation.organization_id, operation.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async fail(
    operation: ProvisionOperationRow,
    failure: GitWorkspaceProvisioningError,
  ): Promise<void> {
    const client = await this.pool.connect();
    const now = this.clock.now();
    try {
      await client.query('BEGIN');
      const failed = await client.query(
        `UPDATE workspace_operations
            SET status = 'failed', failure_code = $1, failure_retryable = $2,
                lease_owner = NULL, lease_expires_at = NULL, updated_at = $3
          WHERE organization_id = $4 AND id = $5 AND status = 'running'
            AND lease_owner = $6 AND lease_expires_at >= $3`,
        [failure.code, failure.retryable, now, operation.organization_id,
          operation.id, this.options.workerId],
      );
      if (failed.rowCount === 1) {
        await client.query(
          `UPDATE workspaces SET lifecycle_status = 'failed', updated_at = $1
            WHERE organization_id = $2 AND id = $3`,
          [now, operation.organization_id, operation.workspace_id],
        );
        await client.query(
          `UPDATE workspace_outbox SET delivered_at = $1
            WHERE organization_id = $2 AND operation_id = $3 AND delivered_at IS NULL`,
          [now, operation.organization_id, operation.id],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

interface WorktreeExecutionRow extends ProvisionOperationRow {
  readonly branch_name: string;
  readonly base_commit: string;
}

export class PostgresWorkspaceWorktreeWorker {
  private readonly clock: Clock;
  private readonly generateId: () => string;

  constructor(
    private readonly pool: Pool,
    private readonly provisioner: GitWorkspaceProvisioner,
    private readonly options: {
      readonly workerId: string;
      readonly leaseTtlMs: number;
      readonly clock?: Clock;
      readonly generateId?: () => string;
    },
  ) {
    this.clock = options.clock ?? new SystemClock();
    this.generateId = options.generateId ?? randomUUID;
  }

  async executeOne(): Promise<boolean> {
    const operation = await this.leaseNext();
    if (!operation) return false;
    let result: { readonly headCommit: string; readonly contentManifestHash: string };
    try {
      result = await this.provisioner.createWorktree({
        operationId: operation.id,
        organizationId: operation.organization_id as OrganizationId,
        principalId: operation.principal_id as PrincipalId,
        workspaceId: operation.workspace_id as WorkspaceId,
        connectorId: operation.connector_id as WorkspaceConnectorId,
        repositoryId: operation.repository_id as WorkspaceRepositoryId,
        branchName: operation.branch_name,
        baseCommit: operation.base_commit,
      });
    } catch (error) {
      await this.fail(operation, safeGitFailure(error, 'git_worktree_create_failed'));
      return true;
    }
    await this.complete(operation, result);
    return true;
  }

  private async leaseNext(): Promise<WorktreeExecutionRow | undefined> {
    const client = await this.pool.connect();
    const now = this.clock.now();
    const leaseExpiresAt = new Date(now.getTime() + this.options.leaseTtlMs);
    try {
      await client.query('BEGIN');
      const selected = await client.query<WorktreeExecutionRow>(
        `SELECT operation.id, operation.organization_id, operation.principal_id,
                operation.workspace_id, operation.branch_name,
                binding.connector_id, binding.repository_id, binding.default_branch,
                base.head_commit AS base_commit
           FROM workspace_operations operation
           JOIN workspace_repository_bindings binding
             ON binding.organization_id = operation.organization_id
            AND binding.workspace_id = operation.workspace_id
           JOIN workspace_roots root
             ON root.organization_id = operation.organization_id
            AND root.workspace_id = operation.workspace_id
            AND root.is_default
           JOIN workspace_git_worktrees base
             ON base.organization_id = root.organization_id
            AND base.working_root_id = root.id
          WHERE operation.operation_type = 'create_worktree'
            AND (operation.status = 'pending'
             OR (operation.status = 'running' AND operation.lease_expires_at < $1))
            AND EXISTS (
              SELECT 1 FROM workspace_outbox outbox
               WHERE outbox.organization_id = operation.organization_id
                 AND outbox.operation_id = operation.id
                 AND outbox.delivered_at IS NULL
            )
          ORDER BY operation.created_at, operation.id
          FOR UPDATE OF operation SKIP LOCKED
          LIMIT 1`,
        [now],
      );
      const operation = selected.rows[0];
      if (!operation) {
        await client.query('COMMIT');
        return undefined;
      }
      await client.query(
        `UPDATE workspace_operations
            SET status = 'running', lease_owner = $1, lease_expires_at = $2, updated_at = $3
          WHERE organization_id = $4 AND id = $5`,
        [this.options.workerId, leaseExpiresAt, now, operation.organization_id, operation.id],
      );
      await client.query('COMMIT');
      return operation;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async complete(
    operation: WorktreeExecutionRow,
    result: { readonly headCommit: string; readonly contentManifestHash: string },
  ): Promise<void> {
    const client = await this.pool.connect();
    const now = this.clock.now();
    const workingRootId = this.generateId() as WorkingRootId;
    const revisionId = this.generateId() as WorkspaceRevisionId;
    const worktreeId = this.generateId() as GitWorktreeId;
    try {
      await client.query('BEGIN');
      const leased = await client.query(
        `SELECT 1 FROM workspace_operations
          WHERE organization_id = $1 AND id = $2 AND status = 'running'
            AND lease_owner = $3 AND lease_expires_at >= $4
          FOR UPDATE`,
        [operation.organization_id, operation.id, this.options.workerId, now],
      );
      if (leased.rowCount !== 1) {
        await client.query('ROLLBACK');
        return;
      }
      await client.query(
        `INSERT INTO workspace_roots (
           id, organization_id, workspace_id, root_kind, is_default,
           current_revision_id, created_at
         ) VALUES ($1, $2, $3, 'git_worktree', false, $4, $5)`,
        [workingRootId, operation.organization_id, operation.workspace_id, revisionId, now],
      );
      await client.query(
        `INSERT INTO workspace_revisions (
           id, organization_id, workspace_id, working_root_id, parent_revision_id,
           content_manifest_hash, git_commit_sha, created_at
         ) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)`,
        [revisionId, operation.organization_id, operation.workspace_id, workingRootId,
          result.contentManifestHash, result.headCommit, now],
      );
      await client.query(
        `INSERT INTO workspace_git_worktrees (
           id, organization_id, workspace_id, working_root_id, branch_name, head_commit,
           lifecycle_status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'ready', $7, $7)`,
        [worktreeId, operation.organization_id, operation.workspace_id, workingRootId,
          operation.branch_name, result.headCommit, now],
      );
      await client.query(
        `UPDATE workspace_operations
            SET status = 'succeeded', result_worktree_id = $1,
                lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
          WHERE organization_id = $3 AND id = $4`,
        [worktreeId, now, operation.organization_id, operation.id],
      );
      await client.query(
        `UPDATE workspace_outbox SET delivered_at = $1
          WHERE organization_id = $2 AND operation_id = $3 AND delivered_at IS NULL`,
        [now, operation.organization_id, operation.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async fail(
    operation: WorktreeExecutionRow,
    failure: GitWorkspaceProvisioningError,
  ): Promise<void> {
    const now = this.clock.now();
    await this.pool.query(
      `WITH failed AS (
         UPDATE workspace_operations
            SET status = 'failed', failure_code = $1, failure_retryable = $2,
                lease_owner = NULL, lease_expires_at = NULL, updated_at = $3
          WHERE organization_id = $4 AND id = $5 AND status = 'running'
            AND lease_owner = $6 AND lease_expires_at >= $3
          RETURNING organization_id, id
       )
       UPDATE workspace_outbox outbox SET delivered_at = $3
        FROM failed
       WHERE outbox.organization_id = failed.organization_id
         AND outbox.operation_id = failed.id
         AND outbox.delivered_at IS NULL`,
      [failure.code, failure.retryable, now, operation.organization_id,
        operation.id, this.options.workerId],
    );
  }
}

interface ConfiguredGitRepository {
  readonly organizationId: OrganizationId;
  readonly connectorId: WorkspaceConnectorId;
  readonly repositoryId: WorkspaceRepositoryId;
  readonly remoteUrl: string;
  readonly credentialRef?: string;
}

export interface WorkspaceGitCredentialBroker {
  issue(request: {
    readonly organizationId: OrganizationId;
    readonly principalId: PrincipalId;
    readonly connectorId: WorkspaceConnectorId;
    readonly repositoryId: WorkspaceRepositoryId;
    readonly credentialRef: string;
  }): Promise<{
    readonly id: string;
    readonly secret: string;
    readonly username?: string;
    readonly expiresAt: Date;
  }>;
  revoke(leaseId: string): Promise<void>;
}

const executeFile = promisify(execFile);

function trustedRepositoryKey(
  organizationId: OrganizationId,
  connectorId: WorkspaceConnectorId,
  repositoryId: WorkspaceRepositoryId,
): string {
  return `${organizationId}:${connectorId}:${repositoryId}`;
}

async function readProvisionReceipt(
  path: string,
): Promise<{ readonly headCommit: string; readonly contentManifestHash: string } | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object'
      || !('headCommit' in parsed) || typeof parsed.headCommit !== 'string'
      || !/^[0-9a-f]{40,64}$/u.test(parsed.headCommit)
      || !('contentManifestHash' in parsed) || typeof parsed.contentManifestHash !== 'string'
      || !/^[0-9a-f]{64}$/u.test(parsed.contentManifestHash)) {
      throw new GitWorkspaceProvisioningError('workspace_content_corrupt', false);
    }
    return {
      headCommit: parsed.headCommit,
      contentManifestHash: parsed.contentManifestHash,
    };
  } catch (error) {
    if (error instanceof GitWorkspaceProvisioningError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new GitWorkspaceProvisioningError('workspace_content_unavailable', true);
  }
}

export function createConfiguredGitWorkspaceProvisioner(options: {
  readonly storageRoot: string;
  readonly repositories: readonly ConfiguredGitRepository[];
  readonly credentialBroker?: WorkspaceGitCredentialBroker;
}): GitWorkspaceProvisioner {
  const repositories = new Map(options.repositories.map((repository) => [
    trustedRepositoryKey(repository.organizationId, repository.connectorId, repository.repositoryId),
    repository,
  ]));
  return {
    async provision(request) {
      const repository = repositories.get(trustedRepositoryKey(
        request.organizationId, request.connectorId, request.repositoryId,
      ));
      if (!repository) {
        throw new GitWorkspaceProvisioningError('repository_source_not_found', false);
      }
      const workspaceRoot = join(options.storageRoot, request.organizationId, request.workspaceId);
      const operationRoot = join(workspaceRoot, 'operations');
      const receiptPath = join(operationRoot, `${request.operationId}.json`);
      const existing = await readProvisionReceipt(receiptPath);
      if (existing) return existing;

      await mkdir(operationRoot, { recursive: true });
      const repositoryPath = join(workspaceRoot, 'repository.git');
      const lease = repository.credentialRef
        ? await options.credentialBroker?.issue({
          organizationId: request.organizationId,
          principalId: request.principalId,
          connectorId: request.connectorId,
          repositoryId: request.repositoryId,
          credentialRef: repository.credentialRef,
        })
        : undefined;
      if (repository.credentialRef && !lease) {
        throw new GitWorkspaceProvisioningError('credential_unavailable', true);
      }
      if (lease && lease.expiresAt.getTime() <= Date.now()) {
        await options.credentialBroker!.revoke(lease.id);
        throw new GitWorkspaceProvisioningError('credential_lease_expired', true);
      }
      const gitEnvironment: NodeJS.ProcessEnv = {
        PATH: process.env.PATH ?? '',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      };
      if (lease) {
        const askPassPath = join(workspaceRoot, 'git-askpass');
        await writeFile(askPassPath,
          '#!/bin/sh\ncase "$1" in *Username*) printf %s "$CMASTER_GIT_USERNAME" ;; *) printf %s "$CMASTER_GIT_SECRET" ;; esac\n',
          { encoding: 'utf8', mode: 0o700 });
        gitEnvironment.GIT_ASKPASS = askPassPath;
        gitEnvironment.CMASTER_GIT_USERNAME = lease.username ?? 'git';
        gitEnvironment.CMASTER_GIT_SECRET = lease.secret;
      }
      try {
        await executeFile('git', ['check-ref-format', '--branch', request.defaultBranch], {
          env: gitEnvironment,
        });
        let headCommit: string | undefined;
        try {
          const { stdout } = await executeFile(
            'git', ['--git-dir', repositoryPath, 'rev-parse', `refs/heads/${request.defaultBranch}`],
            { env: gitEnvironment },
          );
          headCommit = stdout.trim();
        } catch {
          // The operation owns this UUID-derived location. Remove an interrupted clone before retry.
          await rm(repositoryPath, { recursive: true, force: true });
          await executeFile('git', [
            '-c', 'core.hooksPath=/dev/null',
            '-c', 'protocol.file.allow=always',
            'clone', '--bare', '--no-tags', '--branch', request.defaultBranch,
            repository.remoteUrl, repositoryPath,
          ], {
            env: gitEnvironment,
          });
          const { stdout } = await executeFile(
            'git', ['--git-dir', repositoryPath, 'rev-parse', `refs/heads/${request.defaultBranch}`],
            { env: gitEnvironment },
          );
          headCommit = stdout.trim();
        }
        const worktreeRoot = join(workspaceRoot, 'worktrees', request.operationId);
        let worktreeMatches = false;
        try {
          const { stdout } = await executeFile(
            'git', ['-C', worktreeRoot, 'rev-parse', 'HEAD'], { env: gitEnvironment },
          );
          worktreeMatches = stdout.trim() === headCommit;
        } catch {
          // Missing or interrupted materialization is repaired below.
        }
        if (!worktreeMatches) {
          await rm(worktreeRoot, { recursive: true, force: true });
          await mkdir(join(workspaceRoot, 'worktrees'), { recursive: true });
          await executeFile('git', ['--git-dir', repositoryPath, 'worktree', 'prune'], {
            env: gitEnvironment,
          });
          await executeFile('git', [
            '-c', 'core.hooksPath=/dev/null', '--git-dir', repositoryPath,
            'worktree', 'add', worktreeRoot, request.defaultBranch,
          ], { env: gitEnvironment });
        }
        const { stdout: treeOutput } = await executeFile(
          'git', ['--git-dir', repositoryPath, 'rev-parse', `${headCommit}^{tree}`],
          { env: gitEnvironment },
        );
        const result = {
          headCommit,
          contentManifestHash: createHash('sha256')
            .update(`git-tree:${treeOutput.trim()}`)
            .digest('hex'),
        };
        const temporaryReceipt = `${receiptPath}.${randomUUID()}.tmp`;
        await writeFile(temporaryReceipt, JSON.stringify(result), { encoding: 'utf8', mode: 0o600 });
        await rename(temporaryReceipt, receiptPath);
        return result;
      } catch (error) {
        if (error instanceof GitWorkspaceProvisioningError) throw error;
        throw new GitWorkspaceProvisioningError('git_clone_failed', true);
      } finally {
        if (lease) await options.credentialBroker!.revoke(lease.id);
      }
    },
    async createWorktree(request) {
      const repository = repositories.get(trustedRepositoryKey(
        request.organizationId, request.connectorId, request.repositoryId,
      ));
      if (!repository) {
        throw new GitWorkspaceProvisioningError('repository_source_not_found', false);
      }
      const workspaceRoot = join(options.storageRoot, request.organizationId, request.workspaceId);
      const operationRoot = join(workspaceRoot, 'operations');
      const receiptPath = join(operationRoot, `${request.operationId}.json`);
      const existing = await readProvisionReceipt(receiptPath);
      if (existing) return existing;

      const repositoryPath = join(workspaceRoot, 'repository.git');
      const worktreeRoot = join(workspaceRoot, 'worktrees', request.operationId);
      const gitEnvironment: NodeJS.ProcessEnv = {
        PATH: process.env.PATH ?? '',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      };
      try {
        await mkdir(operationRoot, { recursive: true });
        await executeFile('git', ['check-ref-format', '--branch', request.branchName], {
          env: gitEnvironment,
        });
        await executeFile('git', [
          '--git-dir', repositoryPath, 'cat-file', '-e', `${request.baseCommit}^{commit}`,
        ], { env: gitEnvironment });
        let branchExists = false;
        try {
          const { stdout } = await executeFile('git', [
            '--git-dir', repositoryPath, 'rev-parse', `refs/heads/${request.branchName}`,
          ], { env: gitEnvironment });
          if (stdout.trim() !== request.baseCommit) {
            throw new GitWorkspaceProvisioningError('git_branch_conflict', false);
          }
          branchExists = true;
        } catch (error) {
          if (error instanceof GitWorkspaceProvisioningError) throw error;
        }
        if (branchExists) {
          try {
            const { stdout } = await executeFile('git', [
              '-C', worktreeRoot, 'rev-parse', 'HEAD',
            ], { env: gitEnvironment });
            if (stdout.trim() !== request.baseCommit) {
              throw new GitWorkspaceProvisioningError('git_branch_conflict', false);
            }
          } catch (error) {
            if (error instanceof GitWorkspaceProvisioningError) throw error;
            throw new GitWorkspaceProvisioningError('git_branch_conflict', false);
          }
        } else {
          await mkdir(join(workspaceRoot, 'worktrees'), { recursive: true });
          await executeFile('git', [
            '-c', 'core.hooksPath=/dev/null',
            '--git-dir', repositoryPath,
            'worktree', 'add', '-b', request.branchName, worktreeRoot, request.baseCommit,
          ], { env: gitEnvironment });
        }
        const { stdout: treeOutput } = await executeFile('git', [
          '--git-dir', repositoryPath, 'rev-parse', `${request.baseCommit}^{tree}`,
        ], { env: gitEnvironment });
        const result = {
          headCommit: request.baseCommit,
          contentManifestHash: createHash('sha256')
            .update(`git-tree:${treeOutput.trim()}`)
            .digest('hex'),
        };
        const temporaryReceipt = `${receiptPath}.${randomUUID()}.tmp`;
        await writeFile(temporaryReceipt, JSON.stringify(result), { encoding: 'utf8', mode: 0o600 });
        await rename(temporaryReceipt, receiptPath);
        return result;
      } catch (error) {
        if (error instanceof GitWorkspaceProvisioningError) throw error;
        throw new GitWorkspaceProvisioningError('git_worktree_create_failed', true);
      }
    },
  };
}

export function workspaceId(value: string): WorkspaceId {
  return value as WorkspaceId;
}

export function workspaceCommandId(value: string): WorkspaceCommandId {
  return value as WorkspaceCommandId;
}

export function workspaceConnectorId(value: string): WorkspaceConnectorId {
  return value as WorkspaceConnectorId;
}

export function workspaceRepositoryId(value: string): WorkspaceRepositoryId {
  return value as WorkspaceRepositoryId;
}

export function gitWorktreeId(value: string): GitWorktreeId {
  return value as GitWorktreeId;
}

export function workingRootId(value: string): WorkingRootId {
  return value as WorkingRootId;
}

export function workspaceRevisionId(value: string): WorkspaceRevisionId {
  return value as WorkspaceRevisionId;
}

export {
  createConfiguredWorkspaceRevisionContentReader,
  WorkspaceFileNotFoundError,
  WorkspaceRevisionContentError,
  type WorkspaceFileEntry,
  type WorkspaceRevisionContentReader,
  type WorkspaceRevisionContentScope,
} from './revision-content.js';
