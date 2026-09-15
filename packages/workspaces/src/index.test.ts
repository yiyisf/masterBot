import { describe, expect, it } from 'vitest';
import { organizationId, principalId, type RequestIdentity } from '@cmaster/identity';
import { FixedClock } from '@cmaster/kernel';
import {
  createInMemoryWorkspaceCatalog,
  InvalidWorkspaceCursorError,
  InvalidWorkspaceNameError,
  InvalidWorkspacePageLimitError,
  WorkspaceIdempotencyConflictError,
  WorkspaceNotFoundError,
  workspaceCommandId,
} from './index.js';

const identity: RequestIdentity = {
  organizationId: organizationId('00000000-0000-4000-8000-000000000001'),
  principalId: principalId('00000000-0000-4000-8000-000000000002'),
  principalType: 'employee',
  displayName: 'Employee One',
};

function sequentialIds(): () => string {
  const ids = [
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000103',
  ];
  return () => ids.shift() ?? '00000000-0000-4000-8000-999999999999';
}

describe('WorkspaceCatalog', () => {
  it('provisions one ready empty Workspace with a stable default Working Root and Revision', async () => {
    const catalog = createInMemoryWorkspaceCatalog({
      clock: new FixedClock(new Date('2026-09-15T00:00:00.000Z')),
      generateId: sequentialIds(),
    });

    const result = await catalog.provisionEmpty(identity, {
      commandId: workspaceCommandId('00000000-0000-4000-8000-000000000104'),
      name: 'Quarterly planning',
      operationMode: 'edit_with_confirmation',
    });

    expect(result).toEqual({
      replayed: false,
      value: {
        id: '00000000-0000-4000-8000-000000000101',
        organizationId: identity.organizationId,
        ownerPrincipalId: identity.principalId,
        name: 'Quarterly planning',
        source: { kind: 'empty' },
        operationMode: 'edit_with_confirmation',
        lifecycleStatus: 'ready',
        defaultWorkingRoot: {
          id: '00000000-0000-4000-8000-000000000102',
          kind: 'default',
          currentRevisionId: '00000000-0000-4000-8000-000000000103',
        },
        createdAt: new Date('2026-09-15T00:00:00.000Z'),
        updatedAt: new Date('2026-09-15T00:00:00.000Z'),
      },
    });
  });

  it('replays the same provision Command without creating another Workspace', async () => {
    const catalog = createInMemoryWorkspaceCatalog({
      clock: new FixedClock(new Date('2026-09-15T00:00:00.000Z')),
      generateId: sequentialIds(),
    });
    const command = {
      commandId: workspaceCommandId('00000000-0000-4000-8000-000000000104'),
      name: 'Quarterly planning',
      operationMode: 'edit_with_confirmation' as const,
    };

    const created = await catalog.provisionEmpty(identity, command);
    const replayed = await catalog.provisionEmpty(identity, command);

    expect(replayed).toEqual({ value: created.value, replayed: true });
  });

  it('rejects reuse of a provision Command identity with a different request', async () => {
    const catalog = createInMemoryWorkspaceCatalog();
    const commandId = workspaceCommandId('00000000-0000-4000-8000-000000000104');
    await catalog.provisionEmpty(identity, {
      commandId,
      name: 'Quarterly planning',
      operationMode: 'edit_with_confirmation',
    });

    await expect(catalog.provisionEmpty(identity, {
      commandId,
      name: 'Different workspace',
      operationMode: 'edit_with_confirmation',
    })).rejects.toBeInstanceOf(WorkspaceIdempotencyConflictError);
  });

  it('returns a provisioned Workspace to its owner', async () => {
    const catalog = createInMemoryWorkspaceCatalog();
    const created = await catalog.provisionEmpty(identity, {
      commandId: workspaceCommandId('00000000-0000-4000-8000-000000000104'),
      name: 'Quarterly planning',
      operationMode: 'observe',
    });

    await expect(catalog.get(identity, created.value.id)).resolves.toEqual(created.value);
  });

  it('makes another Principal and an unknown Workspace indistinguishable', async () => {
    const catalog = createInMemoryWorkspaceCatalog();
    const created = await catalog.provisionEmpty(identity, {
      commandId: workspaceCommandId('00000000-0000-4000-8000-000000000104'),
      name: 'Quarterly planning',
      operationMode: 'observe',
    });
    const otherIdentity: RequestIdentity = {
      ...identity,
      principalId: principalId('00000000-0000-4000-8000-000000000099'),
    };

    await expect(catalog.get(otherIdentity, created.value.id))
      .rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(catalog.get(
      identity,
      '00000000-0000-4000-8000-000000000098' as typeof created.value.id,
    )).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('pages owner Workspaces in stable latest-first order', async () => {
    const ids = [
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000103',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000202',
      '00000000-0000-4000-8000-000000000203',
    ];
    const catalog = createInMemoryWorkspaceCatalog({
      clock: new FixedClock(new Date('2026-09-15T00:00:00.000Z')),
      generateId: () => ids.shift()!,
    });
    const first = await catalog.provisionEmpty(identity, {
      commandId: workspaceCommandId('00000000-0000-4000-8000-000000000301'),
      name: 'First',
      operationMode: 'observe',
    });
    const second = await catalog.provisionEmpty(identity, {
      commandId: workspaceCommandId('00000000-0000-4000-8000-000000000302'),
      name: 'Second',
      operationMode: 'observe',
    });

    const latest = await catalog.list(identity, { limit: 1 });
    expect(latest.items).toEqual([second.value]);
    expect(latest.nextCursor).toBeTypeOf('string');
    if (!latest.nextCursor) throw new Error('Expected another Workspace page');
    await expect(catalog.list(identity, { limit: 1, cursor: latest.nextCursor }))
      .resolves.toEqual({ items: [first.value] });
  });

  it('archives a ready Workspace through an idempotent lifecycle Command', async () => {
    const catalog = createInMemoryWorkspaceCatalog();
    const created = await catalog.provisionEmpty(identity, {
      commandId: workspaceCommandId('00000000-0000-4000-8000-000000000104'),
      name: 'Quarterly planning',
      operationMode: 'observe',
    });
    const command = {
      commandId: workspaceCommandId('00000000-0000-4000-8000-000000000105'),
      targetStatus: 'archived' as const,
    };

    const archived = await catalog.transitionLifecycle(identity, created.value.id, command);
    const replayed = await catalog.transitionLifecycle(identity, created.value.id, command);

    expect(archived.value.lifecycleStatus).toBe('archived');
    expect(replayed).toEqual({ value: archived.value, replayed: true });
  });

  it('rejects an empty Workspace name at the Module boundary', async () => {
    const catalog = createInMemoryWorkspaceCatalog();

    await expect(catalog.provisionEmpty(identity, {
      commandId: workspaceCommandId('00000000-0000-4000-8000-000000000104'),
      name: '   ',
      operationMode: 'observe',
    })).rejects.toBeInstanceOf(InvalidWorkspaceNameError);
  });

  it('reconciles a provision Command only for its owner', async () => {
    const catalog = createInMemoryWorkspaceCatalog();
    const commandId = workspaceCommandId('00000000-0000-4000-8000-000000000104');
    const created = await catalog.provisionEmpty(identity, {
      commandId,
      name: 'Quarterly planning',
      operationMode: 'observe',
    });

    await expect(catalog.getProvisionedByCommand(identity, commandId))
      .resolves.toEqual(created.value);
    await expect(catalog.getProvisionedByCommand({
      ...identity,
      principalId: principalId('00000000-0000-4000-8000-000000000099'),
    }, commandId)).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it('reconciles an accepted lifecycle Command to the current authoritative Workspace', async () => {
    const catalog = createInMemoryWorkspaceCatalog();
    const created = await catalog.provisionEmpty(identity, {
      commandId: workspaceCommandId('00000000-0000-4000-8000-000000000104'),
      name: 'Quarterly planning',
      operationMode: 'observe',
    });
    const archiveCommandId = workspaceCommandId('00000000-0000-4000-8000-000000000105');
    await catalog.transitionLifecycle(identity, created.value.id, {
      commandId: archiveCommandId,
      targetStatus: 'archived',
    });
    await catalog.transitionLifecycle(identity, created.value.id, {
      commandId: workspaceCommandId('00000000-0000-4000-8000-000000000106'),
      targetStatus: 'ready',
    });

    await expect(catalog.getLifecycleByCommand(
      identity,
      created.value.id,
      archiveCommandId,
    )).resolves.toMatchObject({ id: created.value.id, lifecycleStatus: 'ready' });
    await expect(catalog.transitionLifecycle(identity, created.value.id, {
      commandId: archiveCommandId,
      targetStatus: 'archived',
    })).resolves.toMatchObject({
      replayed: true,
      value: { id: created.value.id, lifecycleStatus: 'ready' },
    });
  });

  it('rejects structurally invalid or non-canonical opaque list cursors', async () => {
    const catalog = createInMemoryWorkspaceCatalog();
    const invalidId = Buffer.from(JSON.stringify({
      updatedAt: '2026-09-15T00:00:00.000Z',
      id: 'not-a-workspace-id',
    }), 'utf8').toString('base64url');
    const nonCanonicalDate = Buffer.from(JSON.stringify({
      updatedAt: '2026-09-15 00:00:00Z',
      id: '00000000-0000-4000-8000-000000000101',
    }), 'utf8').toString('base64url');

    await expect(catalog.list(identity, { limit: 20, cursor: invalidId }))
      .rejects.toBeInstanceOf(InvalidWorkspaceCursorError);
    await expect(catalog.list(identity, { limit: 20, cursor: nonCanonicalDate }))
      .rejects.toBeInstanceOf(InvalidWorkspaceCursorError);
  });

  it('enforces bounded pagination at the Module boundary', async () => {
    const catalog = createInMemoryWorkspaceCatalog();

    await expect(catalog.list(identity, { limit: 0 }))
      .rejects.toBeInstanceOf(InvalidWorkspacePageLimitError);
    await expect(catalog.list(identity, { limit: 51 }))
      .rejects.toBeInstanceOf(InvalidWorkspacePageLimitError);
  });

  it('rejects reuse of a lifecycle Command identity for another Workspace', async () => {
    const catalog = createInMemoryWorkspaceCatalog();
    const first = await catalog.provisionEmpty(identity, {
      commandId: workspaceCommandId('00000000-0000-4000-8000-000000000104'),
      name: 'First',
      operationMode: 'observe',
    });
    const second = await catalog.provisionEmpty(identity, {
      commandId: workspaceCommandId('00000000-0000-4000-8000-000000000105'),
      name: 'Second',
      operationMode: 'observe',
    });
    const commandId = workspaceCommandId('00000000-0000-4000-8000-000000000106');
    await catalog.transitionLifecycle(identity, first.value.id, {
      commandId,
      targetStatus: 'archived',
    });

    await expect(catalog.transitionLifecycle(identity, second.value.id, {
      commandId,
      targetStatus: 'archived',
    })).rejects.toBeInstanceOf(WorkspaceIdempotencyConflictError);
  });
});
