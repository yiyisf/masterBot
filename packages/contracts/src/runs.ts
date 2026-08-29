import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './conversations.js';

export const runStatusSchema = z.enum([
  'accepted', 'queued', 'running', 'succeeded', 'failed', 'cancelled',
]);
export const runFailureSchema = z.object({
  code: z.enum(['engine_failed', 'dispatch_attempts_exhausted', 'output_delivery_failed']),
  message: z.string(),
  retryable: z.boolean(),
});
export const createRunRequestSchema = z.object({
  trigger: z.object({ type: z.literal('message'), messageId: uuidSchema }),
});
export const runSnapshotSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  initiatingPrincipalId: uuidSchema,
  conversationId: uuidSchema,
  trigger: z.object({ type: z.literal('message'), messageId: uuidSchema }),
  agentId: uuidSchema,
  agentRevisionId: uuidSchema,
  engine: z.object({ kind: z.literal('echo'), version: z.literal('1') }),
  rootInvocation: z.object({
    id: uuidSchema,
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']),
  }),
  status: runStatusSchema,
  cancellable: z.boolean(),
  lastSequence: z.number().int().nonnegative(),
  assistantMessageId: uuidSchema.optional(),
  failure: runFailureSchema.optional(),
  createdAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.optional(),
  completedAt: isoDateTimeSchema.optional(),
});
export const runEventEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: uuidSchema,
  runId: uuidSchema,
  sequence: z.number().int().positive(),
  type: z.string().min(1),
  timestamp: isoDateTimeSchema,
  causationId: uuidSchema.optional(),
  correlationId: uuidSchema,
  data: z.record(z.string(), z.unknown()),
});
export const cancelRunResponseSchema = z.object({
  outcome: z.literal('cancelled'),
  run: runSnapshotSchema,
});

export type RunSnapshotContract = z.infer<typeof runSnapshotSchema>;
export type RunEventContract = z.infer<typeof runEventEnvelopeSchema>;
