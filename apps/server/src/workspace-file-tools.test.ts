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
  workspaceInvocationId,
  type WorkspaceRunEnvironments,
} from '@cmaster/workspaces';
import {
  OPEN_WORKSPACE_FILE_CAPABILITY_ID,
  WorkspaceFileToolProvider,
  WorkspaceFileToolProvenanceObserver,
  workspaceFileToolCatalog,
} from './workspace-file-tools.js';

function request(input: unknown): ToolProviderRequest {
  const organization = organizationId(randomUUID());
  const principal = principalId(randomUUID());
  return {
    toolCallId: randomUUID() as ToolCallId,
    revision: (() => {
      const provisioned = workspaceFileToolCatalog(
        organization, agentRevisionId(randomUUID()),
      ).revisions
        .find((candidate) => candidate.capabilityId === OPEN_WORKSPACE_FILE_CAPABILITY_ID)!;
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
