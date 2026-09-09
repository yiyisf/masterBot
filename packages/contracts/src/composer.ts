import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '#internal/conversations';
import { runStatusSchema } from '#internal/runs';

export const operationCommandParamsSchema = z.object({ commandId: uuidSchema });

export const conversationRunSummarySchema = z.object({
  id: uuidSchema,
  triggerMessageId: uuidSchema,
  status: runStatusSchema,
  createdAt: isoDateTimeSchema,
});

export const conversationRunPageSchema = z.object({
  items: z.array(conversationRunSummarySchema).max(50),
  truncated: z.boolean(),
});

export type ConversationRunSummaryContract = z.infer<typeof conversationRunSummarySchema>;
export type ConversationRunPageContract = z.infer<typeof conversationRunPageSchema>;
