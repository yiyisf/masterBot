import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '#internal/conversations';
import { runStatusSchema } from '#internal/runs';

export const workspaceConversationPreviewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().max(160) }),
  z.object({ kind: z.literal('artifact') }),
  z.object({ kind: z.literal('empty') }),
]);

export const workspaceConversationSummarySchema = z.object({
  id: uuidSchema,
  title: z.string().max(200).nullable(),
  preview: workspaceConversationPreviewSchema,
  updatedAt: isoDateTimeSchema,
  activity: z.object({
    activeRunCount: z.number().int().nonnegative(),
    pendingActionCount: z.number().int().nonnegative(),
    latestRunStatus: runStatusSchema.optional(),
  }),
});

export const workspaceConversationPageSchema = z.object({
  items: z.array(workspaceConversationSummarySchema).max(50),
  nextCursor: z.string().min(1).nullable(),
});

export const workspaceSummarySchema = z.object({
  conversationCount: z.number().int().nonnegative(),
  activeRunCount: z.number().int().nonnegative(),
  pendingActionCount: z.number().int().nonnegative(),
});

export type WorkspaceConversationSummaryContract = z.infer<typeof workspaceConversationSummarySchema>;
export type WorkspaceConversationPageContract = z.infer<typeof workspaceConversationPageSchema>;
export type WorkspaceSummaryContract = z.infer<typeof workspaceSummarySchema>;
