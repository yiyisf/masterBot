import { describe, expect, it } from 'vitest';
import {
  createFilesystemWorkspaceRequestSchema,
  createGitWorktreeRequestSchema,
  filesystemWorkspacePageSchema,
  filesystemWorkspaceSchema,
  gitWorktreePageSchema,
  worktreeOperationSchema,
} from './filesystem-workspaces.js';

const workspace = {
  id: '00000000-0000-4000-8000-000000000101',
  name: 'Quarterly planning',
  source: { kind: 'empty' as const },
  operationMode: 'edit_with_confirmation' as const,
  lifecycleStatus: 'ready' as const,
  defaultWorkingRoot: {
    id: '00000000-0000-4000-8000-000000000102',
    kind: 'default' as const,
    currentRevisionId: '00000000-0000-4000-8000-000000000103',
  },
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
};

describe('Filesystem Workspace contracts', () => {
  it('represents a ready empty Workspace with its stable default Working Root and Revision', () => {
    expect(filesystemWorkspaceSchema.parse(workspace)).toEqual(workspace);
    expect(createFilesystemWorkspaceRequestSchema.parse({ name: ' Quarterly planning ' }))
      .toEqual({ name: 'Quarterly planning', operationMode: 'edit_with_confirmation' });
  });

  it('accepts only trusted Git references and represents asynchronous provisioning safely', () => {
    const request = {
      name: ' Trusted repository ',
      operationMode: 'observe',
      source: {
        kind: 'git',
        connectorId: '00000000-0000-4000-8000-000000000201',
        repositoryId: '00000000-0000-4000-8000-000000000202',
        defaultBranch: 'main',
      },
    };
    expect(createFilesystemWorkspaceRequestSchema.parse(request)).toEqual({
      ...request,
      name: 'Trusted repository',
    });
    expect(createFilesystemWorkspaceRequestSchema.safeParse({
      ...request,
      source: { ...request.source, serverPath: '/srv/private/repository' },
    }).success).toBe(false);
    expect(filesystemWorkspaceSchema.parse({
      ...workspace,
      source: request.source,
      lifecycleStatus: 'provisioning',
      defaultWorkingRoot: null,
      provisioningFailure: null,
    })).toMatchObject({
      source: request.source,
      lifecycleStatus: 'provisioning',
      defaultWorkingRoot: null,
      provisioningFailure: null,
    });
  });

  it('represents bounded Worktree Commands and private Worktree pages', () => {
    expect(createGitWorktreeRequestSchema.parse({ branchName: ' feature/private ' }))
      .toEqual({ branchName: 'feature/private' });
    expect(worktreeOperationSchema.parse({
      id: '00000000-0000-4000-8000-000000000301',
      workspaceId: workspace.id,
      branchName: 'feature/private',
      status: 'pending',
      failure: null,
    })).toMatchObject({ branchName: 'feature/private', status: 'pending' });
    expect(gitWorktreePageSchema.parse({
      items: [{
        id: '00000000-0000-4000-8000-000000000302',
        workspaceId: workspace.id,
        workingRootId: '00000000-0000-4000-8000-000000000303',
        branchName: 'main',
        headCommit: '1111111111111111111111111111111111111111',
        lifecycleStatus: 'ready',
        isDefault: true,
        currentRevisionId: '00000000-0000-4000-8000-000000000304',
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      }],
      nextCursor: null,
    })).toMatchObject({ items: [{ branchName: 'main', isDefault: true }] });
  });

  it('represents a bounded private Workspace page with an opaque cursor', () => {
    expect(filesystemWorkspacePageSchema.parse({
      items: [workspace],
      nextCursor: 'opaque-cursor',
    })).toEqual({ items: [workspace], nextCursor: 'opaque-cursor' });
  });
});
