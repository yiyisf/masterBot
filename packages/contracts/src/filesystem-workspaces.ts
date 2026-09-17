import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '#internal/conversations';

export const workspaceOperationModeSchema = z.enum([
  'observe',
  'edit_with_confirmation',
  'trusted_automation',
]);

export const filesystemWorkspaceLifecycleStatusSchema = z.enum([
  'provisioning',
  'ready',
  'failed',
  'archived',
]);

const gitWorkspaceSourceSchema = z.object({
  kind: z.literal('git'),
  connectorId: uuidSchema,
  repositoryId: uuidSchema,
  defaultBranch: z.string().trim().min(1).max(255),
}).strict();

export const createFilesystemWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  operationMode: workspaceOperationModeSchema.default('edit_with_confirmation'),
  source: z.union([z.object({ kind: z.literal('empty') }).strict(), gitWorkspaceSourceSchema])
    .optional(),
}).strict();

export const filesystemWorkspaceSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(120),
  source: z.union([z.object({ kind: z.literal('empty') }).strict(), gitWorkspaceSourceSchema]),
  operationMode: workspaceOperationModeSchema,
  lifecycleStatus: filesystemWorkspaceLifecycleStatusSchema,
  defaultWorkingRoot: z.object({
    id: uuidSchema,
    kind: z.enum(['default', 'git_worktree']),
    currentRevisionId: uuidSchema,
  }).nullable(),
  provisioningFailure: z.object({
    code: z.string().min(1).max(100),
    retryable: z.boolean(),
  }).nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const filesystemWorkspacePageSchema = z.object({
  items: z.array(filesystemWorkspaceSchema).max(50),
  nextCursor: z.string().min(1).nullable(),
});

export const createGitWorktreeRequestSchema = z.object({
  branchName: z.string().trim().min(1).max(255),
}).strict();

export const worktreeOperationSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  branchName: z.string().min(1).max(255),
  status: z.enum(['pending', 'running', 'succeeded', 'failed']),
  failure: z.object({
    code: z.string().min(1).max(100),
    retryable: z.boolean(),
  }).nullable(),
});

export const gitWorktreeSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  workingRootId: uuidSchema,
  branchName: z.string().min(1).max(255),
  headCommit: z.string().regex(/^[0-9a-f]{40,64}$/u),
  lifecycleStatus: z.enum(['ready', 'archived']),
  isDefault: z.boolean(),
  currentRevisionId: uuidSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const gitWorktreePageSchema = z.object({
  items: z.array(gitWorktreeSchema).max(50),
  nextCursor: z.string().min(1).nullable(),
});

export type FilesystemWorkspaceContract = z.infer<typeof filesystemWorkspaceSchema>;
export type FilesystemWorkspacePageContract = z.infer<typeof filesystemWorkspacePageSchema>;
export type WorkspaceOperationModeContract = z.infer<typeof workspaceOperationModeSchema>;
export type GitWorktreeContract = z.infer<typeof gitWorktreeSchema>;
export type GitWorktreePageContract = z.infer<typeof gitWorktreePageSchema>;
export type WorktreeOperationContract = z.infer<typeof worktreeOperationSchema>;
