import { createHash, randomUUID } from 'node:crypto';
import type { OrganizationId, PrincipalId, RequestIdentity } from '@cmaster/identity';
import type { Brand, Clock } from '@cmaster/kernel';
import { SystemClock } from '@cmaster/kernel';
import type { Pool, PoolClient } from 'pg';

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type WorkingRootId = Brand<string, 'WorkingRootId'>;
export type WorkspaceRevisionId = Brand<string, 'WorkspaceRevisionId'>;
export type WorkspaceCommandId = Brand<string, 'WorkspaceCommandId'>;

export type WorkspaceOperationMode =
  | 'observe'
  | 'edit_with_confirmation'
  | 'trusted_automation';

export interface Workspace {
  readonly id: WorkspaceId;
  readonly organizationId: OrganizationId;
  readonly ownerPrincipalId: PrincipalId;
  readonly name: string;
  readonly source: { readonly kind: 'empty' };
  readonly operationMode: WorkspaceOperationMode;
  readonly lifecycleStatus: 'ready' | 'archived';
  readonly defaultWorkingRoot: {
    readonly id: WorkingRootId;
    readonly kind: 'default';
    readonly currentRevisionId: WorkspaceRevisionId;
  };
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class WorkspaceIdempotencyConflictError extends Error {}
export class WorkspaceNotFoundError extends Error {}
export class InvalidWorkspaceNameError extends Error {}
export class InvalidWorkspaceCursorError extends Error {}
export class InvalidWorkspacePageLimitError extends Error {}

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
    const hash = requestHash({ name, operationMode: command.operationMode });
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
  readonly source_kind: 'empty';
  readonly operation_mode: WorkspaceOperationMode;
  readonly lifecycle_status: Workspace['lifecycleStatus'];
  readonly working_root_id: string;
  readonly current_revision_id: string;
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
  r.id AS working_root_id, r.current_revision_id`;
const workspaceFrom = `
  FROM workspaces w
  JOIN workspace_roots r
    ON r.organization_id = w.organization_id
   AND r.workspace_id = w.id
   AND r.root_kind = 'default'`;
const workspaceSelection = `SELECT ${workspaceColumns} ${workspaceFrom}`;
const workspaceReceiptSelection = `
  SELECT receipt.request_hash, ${workspaceColumns}
    ${workspaceFrom}`;

function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id as WorkspaceId,
    organizationId: row.organization_id as OrganizationId,
    ownerPrincipalId: row.owner_principal_id as PrincipalId,
    name: row.name,
    source: { kind: row.source_kind },
    operationMode: row.operation_mode,
    lifecycleStatus: row.lifecycle_status,
    defaultWorkingRoot: {
      id: row.working_root_id as WorkingRootId,
      kind: 'default',
      currentRevisionId: row.current_revision_id as WorkspaceRevisionId,
    },
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

  async provisionEmpty(
    identity: RequestIdentity,
    command: {
      readonly commandId: WorkspaceCommandId;
      readonly name: string;
      readonly operationMode: WorkspaceOperationMode;
    },
  ): Promise<WorkspaceCommandResult<Workspace>> {
    const name = normalizeWorkspaceName(command.name);
    const hash = requestHash({ name, operationMode: command.operationMode });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${identity.organizationId}:${identity.principalId}:provision_empty:${command.commandId}`,
      ]);
      const receipt = await client.query<WorkspaceReceiptRow>(
        `${workspaceReceiptSelection}
          JOIN workspace_operation_receipts receipt
            ON receipt.organization_id = w.organization_id
           AND receipt.workspace_id = w.id
         WHERE receipt.organization_id = $1
           AND receipt.principal_id = $2
           AND receipt.operation_type = 'provision_empty'
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
           id, organization_id, workspace_id, root_kind, current_revision_id, created_at
         ) VALUES ($1, $2, $3, 'default', $4, $5)`,
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
         ) VALUES ($1, $2, 'provision_empty', $3, $4, $5, $6)`,
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
         AND receipt.operation_type = 'provision_empty'
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

export function workspaceId(value: string): WorkspaceId {
  return value as WorkspaceId;
}

export function workspaceCommandId(value: string): WorkspaceCommandId {
  return value as WorkspaceCommandId;
}
