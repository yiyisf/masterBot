import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { organizationId, principalId } from '@cmaster/identity';
import { agentRevisionId } from '@cmaster/agents';
import type { InvocationId, RunId } from '@cmaster/execution';
import type {
  CredentialLease,
  CredentialLeaseId,
  ToolCallId,
  ToolProviderRequest,
} from '@cmaster/tools';
import {
  WorkspaceChangeConflictError,
  workspaceInvocationId,
  type WorkspaceChanges,
  type WorkspaceRunEnvironments,
} from '@cmaster/workspaces';
import {
  APPLY_WORKSPACE_CHANGES_CAPABILITY_ID,
  DELETE_WORKSPACE_FILE_CAPABILITY_ID,
  OPEN_WORKSPACE_FILE_CAPABILITY_ID,
  PROPOSE_WORKSPACE_CHANGES_CAPABILITY_ID,
  WRITE_WORKSPACE_FILE_CAPABILITY_ID,
  WorkspaceChangeApplyToolProvider,
  WorkspaceFileToolProvider,
  WorkspaceFileToolProvenanceObserver,
  workspaceFileToolCatalog,
} from './workspace-file-tools.js';

function request(
  input: unknown,
  capabilityId = OPEN_WORKSPACE_FILE_CAPABILITY_ID,
): ToolProviderRequest {
  const organization = organizationId(randomUUID());
  const principal = principalId(randomUUID());
  return {
    toolCallId: randomUUID() as ToolCallId,
    revision: (() => {
      const provisioned = workspaceFileToolCatalog(
        organization, agentRevisionId(randomUUID()),
      ).revisions
        .find((candidate) => candidate.capabilityId === capabilityId)!;
      return { ...provisioned, revisionId: provisioned.id };
    })(),
    runId: randomUUID(),
    invocationId: randomUUID(),
    input,
    idempotencyKey: randomUUID(),
    credentialLease: {
      id: randomUUID() as CredentialLeaseId,
      organizationId: organization, principalId: principal,
      toolCallId: randomUUID() as ToolCallId, invocationId: randomUUID(),
      allowedOperations: [], expiresAt: new Date(Date.now() + 60_000), values: {},
    } satisfies CredentialLease,
    signal: new AbortController().signal,
  };
}

describe('Workspace file Tool Provider', () => {
  it('opens only through the Invocation-bound environment and records exact provenance', async () => {
    const environments = {
      get: vi.fn(async () => ({
        id: randomUUID(), invocationId: workspaceInvocationId(randomUUID()),
        workspaceId: randomUUID(), workingRootId: randomUUID(), revisionId: randomUUID(),
        status: 'prepared', preparedAt: new Date(),
      })),
      openFile: vi.fn(async () => ({
        path: 'src/app.ts', mediaType: 'text/plain; charset=utf-8',
        sizeBytes: Buffer.byteLength('export const ok = 1;'),
        sha256: createHash('sha256').update('export const ok = 1;').digest('hex'),
        encoding: 'utf8' as const, content: 'export const ok = 1;',
      })),
    } as unknown as WorkspaceRunEnvironments;
    const recordOpenedFile = vi.fn(async () => {});
    const provider = new WorkspaceFileToolProvider(environments);
    const toolRequest = request({ path: 'src/app.ts' });

    const result = await provider.execute(toolRequest);
    await new WorkspaceFileToolProvenanceObserver(
      environments, { recordOpenedFile },
    ).observe(
      {
        organizationId: toolRequest.credentialLease.organizationId,
        principalId: toolRequest.credentialLease.principalId,
        principalType: 'employee',
        displayName: 'Workspace Employee',
      },
      {
        organizationId: toolRequest.credentialLease.organizationId,
        runId: toolRequest.runId as RunId,
        invocationId: toolRequest.invocationId as InvocationId,
        agentRevisionId: agentRevisionId(randomUUID()),
        prompt: 'read file',
      },
      toolRequest.revision,
      { ...result, toolCallId: toolRequest.toolCallId },
    );

    expect(environments.openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: toolRequest.credentialLease.organizationId,
        principalId: toolRequest.credentialLease.principalId,
      }),
      workspaceInvocationId(toolRequest.invocationId),
      'src/app.ts',
    );
    expect(recordOpenedFile).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: toolRequest.credentialLease.organizationId,
      invocationId: workspaceInvocationId(toolRequest.invocationId),
      workspaceId: expect.any(String),
      workingRootId: expect.any(String),
      revisionId: expect.any(String),
      path: 'src/app.ts',
      sha256: createHash('sha256').update('export const ok = 1;').digest('hex'),
    }));
    expect(result).toMatchObject({
      kind: 'success',
      value: { path: 'src/app.ts', content: 'export const ok = 1;' },
      safeSummary: {
        details: { path: 'src/app.ts', bytes: String(Buffer.byteLength('export const ok = 1;')) },
      },
    });
    expect(JSON.stringify(result.safeSummary)).not.toContain('export const');
  });

  it('uses the Tool Call identity for private writes, deletes, and immutable proposals', async () => {
    const writeFile = vi.fn(async (
      _identity: unknown, _invocationId: unknown, _command: unknown,
    ) => ({
      value: {
        kind: 'write' as const, path: 'src/app.ts',
        mediaType: 'text/plain; charset=utf-8', sizeBytes: 10, sha256: 'a'.repeat(64),
      },
      replayed: false,
    }));
    const deleteFile = vi.fn(async (
      _identity: unknown, _invocationId: unknown, _command: unknown,
    ) => ({
      value: { kind: 'delete' as const, path: 'old.txt' }, replayed: false,
    }));
    const proposeChanges = vi.fn(async (
      _identity: unknown, _invocationId: unknown, _command: unknown,
    ) => ({
      value: {
        id: randomUUID(), workspaceId: randomUUID(), workingRootId: randomUUID(),
        baseRevisionId: randomUUID(), status: 'proposed' as const,
        entries: [{ kind: 'delete' as const, path: 'old.txt' }],
      },
      replayed: false,
    }));
    const environments = {
      writeFile, deleteFile, proposeChanges,
    } as unknown as WorkspaceRunEnvironments;
    const provider = new WorkspaceFileToolProvider(environments);
    const writeRequest = request(
      { path: 'src/app.ts', content: 'const x=1;' },
      WRITE_WORKSPACE_FILE_CAPABILITY_ID,
    );
    const deleteRequest = request(
      { path: 'old.txt' }, DELETE_WORKSPACE_FILE_CAPABILITY_ID,
    );
    const proposeRequest = request({}, PROPOSE_WORKSPACE_CHANGES_CAPABILITY_ID);

    await expect(provider.execute(writeRequest)).resolves.toMatchObject({
      kind: 'success', value: { kind: 'write', path: 'src/app.ts', changed: true },
    });
    await expect(provider.execute(deleteRequest)).resolves.toMatchObject({
      kind: 'success', value: { kind: 'delete', path: 'old.txt', changed: true },
    });
    await expect(provider.execute(proposeRequest)).resolves.toMatchObject({
      kind: 'success', value: { status: 'proposed', entries: [{ kind: 'delete' }] },
    });
    expect(writeFile.mock.calls[0]?.[2]).toMatchObject({
      commandId: writeRequest.toolCallId, path: 'src/app.ts', content: 'const x=1;',
    });
    expect(deleteFile.mock.calls[0]?.[2]).toMatchObject({
      commandId: deleteRequest.toolCallId, path: 'old.txt',
    });
    expect(proposeChanges.mock.calls[0]?.[2]).toEqual({
      commandId: proposeRequest.toolCallId,
    });
    const catalog = workspaceFileToolCatalog(
      writeRequest.credentialLease.organizationId, agentRevisionId(randomUUID()),
    );
    expect(catalog.revisions.map(({ capabilityId }) => capabilityId)).toEqual([
      'cmaster.workspace.list_files:v1',
      'cmaster.workspace.search_files:v1',
      OPEN_WORKSPACE_FILE_CAPABILITY_ID,
      WRITE_WORKSPACE_FILE_CAPABILITY_ID,
      DELETE_WORKSPACE_FILE_CAPABILITY_ID,
      PROPOSE_WORKSPACE_CHANGES_CAPABILITY_ID,
      APPLY_WORKSPACE_CHANGES_CAPABILITY_ID,
    ]);
  });

  it('applies one exact Change Set with the stable Tool Call identity', async () => {
    const getApplyAuthority = vi.fn(async () => ({
      changeSetId: randomUUID(),
      invocationId: workspaceInvocationId(randomUUID()),
      currentOperationMode: 'edit_with_confirmation' as const,
      maximumOperationMode: 'trusted_automation' as const,
    }));
    const apply = vi.fn(async (
      _identity: unknown, _command: unknown,
    ) => ({
      value: {
        id: randomUUID(), workspaceId: randomUUID(), workingRootId: randomUUID(),
        baseRevisionId: randomUUID(), status: 'applied' as const,
        resultingRevisionId: randomUUID(),
        entries: [{ kind: 'modify' as const, path: 'README.md' }],
      },
      replayed: false,
    }));
    const provider = new WorkspaceChangeApplyToolProvider(
      { apply, getApplyAuthority } as unknown as WorkspaceChanges,
    );
    const toolRequest = request(
      { changeSetId: randomUUID() }, APPLY_WORKSPACE_CHANGES_CAPABILITY_ID,
    );

    await expect(provider.resolvePolicyResource!({
      identity: {
        organizationId: toolRequest.credentialLease.organizationId,
        principalId: toolRequest.credentialLease.principalId,
        principalType: 'employee',
        displayName: 'Workspace Employee',
      },
      revision: toolRequest.revision,
      runId: toolRequest.runId,
      invocationId: toolRequest.invocationId,
      input: toolRequest.input,
    })).resolves.toEqual({
      kind: 'workspace_change_apply',
      currentOperationMode: 'edit_with_confirmation',
      maximumOperationMode: 'trusted_automation',
    });
    await expect(provider.execute(toolRequest)).resolves.toMatchObject({
      kind: 'success',
      value: {
        status: 'applied',
        resultingRevisionId: expect.any(String),
        entries: [{ kind: 'modify', path: 'README.md' }],
      },
      safeSummary: { title: 'Workspace changes applied' },
    });
    expect(apply.mock.calls[0]?.[1]).toEqual({
      commandId: toolRequest.toolCallId,
      changeSetId: toolRequest.input && (toolRequest.input as { changeSetId: string }).changeSetId,
    });
  });

  it('returns the authoritative conflicted Change Set without a generic Provider failure', async () => {
    const changeSetId = randomUUID();
    const apply = vi.fn(async () => {
      throw new WorkspaceChangeConflictError();
    });
    const get = vi.fn(async () => ({
      id: changeSetId,
      workspaceId: randomUUID(),
      workingRootId: randomUUID(),
      baseRevisionId: randomUUID(),
      invocationId: workspaceInvocationId(randomUUID()),
      status: 'conflicted' as const,
      entries: [{ kind: 'delete' as const, path: 'README.md' }],
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const provider = new WorkspaceChangeApplyToolProvider(
      { apply, get } as unknown as WorkspaceChanges,
    );

    await expect(provider.execute(request(
      { changeSetId }, APPLY_WORKSPACE_CHANGES_CAPABILITY_ID,
    ))).resolves.toMatchObject({
      kind: 'success',
      value: { changeSetId, status: 'conflicted' },
      safeSummary: { details: { status: 'conflicted' } },
    });
  });

  it('rejects an open result that cannot fit the governed Tool payload boundary', async () => {
    const content = 'x'.repeat(8 * 1024 + 1);
    const environments = {
      openFile: vi.fn(async () => ({
        path: 'large.txt', mediaType: 'text/plain; charset=utf-8',
        sizeBytes: Buffer.byteLength(content),
        sha256: createHash('sha256').update(content).digest('hex'),
        encoding: 'utf8' as const, content,
      })),
    } as unknown as WorkspaceRunEnvironments;
    const provider = new WorkspaceFileToolProvider(environments);

    await expect(provider.execute(request({ path: 'large.txt' })))
      .rejects.toThrow('governed Tool output limit');
  });
});
