import { describe, expect, it } from 'vitest';
import {
  createFilesystemWorkspaceRequestSchema,
  filesystemWorkspacePageSchema,
  filesystemWorkspaceSchema,
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

  it('represents a bounded private Workspace page with an opaque cursor', () => {
    expect(filesystemWorkspacePageSchema.parse({
      items: [workspace],
      nextCursor: 'opaque-cursor',
    })).toEqual({ items: [workspace], nextCursor: 'opaque-cursor' });
  });
});
