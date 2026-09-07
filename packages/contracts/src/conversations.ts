import { z } from 'zod';

export const uuidSchema = z.uuid();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export const textMessagePartSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(32 * 1024).refine((value) => value.trim().length > 0, 'Text is required'),
});
export const artifactReferenceMessagePartSchema = z.object({
  type: z.literal('artifact_reference'),
  artifactId: uuidSchema,
  artifactVersionId: uuidSchema,
});
export const employeeMessagePartsSchema = z.tuple([textMessagePartSchema]);
export const messagePartsSchema = z.array(z.discriminatedUnion('type', [
  textMessagePartSchema,
  artifactReferenceMessagePartSchema,
])).min(1);

export const createConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});
export const conversationSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  createdByPrincipalId: uuidSchema,
  title: z.string().optional(),
  lastMessageSequence: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export const appendMessageRequestSchema = z.object({ parts: employeeMessagePartsSchema });
export const messageSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  conversationId: uuidSchema,
  sequence: z.number().int().positive(),
  author: z.enum(['employee', 'assistant']),
  parts: messagePartsSchema,
  createdAt: isoDateTimeSchema,
  sourceRunId: uuidSchema.optional(),
  sourceInvocationId: uuidSchema.optional(),
});
export const messagePageSchema = z.object({
  items: z.array(messageSchema),
  nextSequence: z.number().int().nonnegative(),
});

export type ConversationContract = z.infer<typeof conversationSchema>;
export type MessageContract = z.infer<typeof messageSchema>;
