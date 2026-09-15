import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '#internal/conversations';

export const workspaceOperationModeSchema = z.enum([
  'observe',
  'edit_with_confirmation',
  'trusted_automation',
]);

export const filesystemWorkspaceLifecycleStatusSchema = z.enum([
  'ready',
  'archived',
]);

export const createFilesystemWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  operationMode: workspaceOperationModeSchema.default('edit_with_confirmation'),
});

export const filesystemWorkspaceSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(120),
  source: z.object({ kind: z.literal('empty') }),
  operationMode: workspaceOperationModeSchema,
  lifecycleStatus: filesystemWorkspaceLifecycleStatusSchema,
  defaultWorkingRoot: z.object({
    id: uuidSchema,
    kind: z.literal('default'),
    currentRevisionId: uuidSchema,
  }),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const filesystemWorkspacePageSchema = z.object({
  items: z.array(filesystemWorkspaceSchema).max(50),
  nextCursor: z.string().min(1).nullable(),
});

export type FilesystemWorkspaceContract = z.infer<typeof filesystemWorkspaceSchema>;
export type FilesystemWorkspacePageContract = z.infer<typeof filesystemWorkspacePageSchema>;
export type WorkspaceOperationModeContract = z.infer<typeof workspaceOperationModeSchema>;
