import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '#internal/conversations';

const safeSubjectSchema = z.object({
  title: z.string().min(1).max(200),
  details: z.record(z.string().max(80), z.string().max(500))
    .refine((details) => Object.keys(details).length <= 20, 'Too many safe detail fields'),
});

const pendingReferenceSchema = z.object({
  conversationId: uuidSchema,
  triggerMessageId: uuidSchema,
  runId: uuidSchema,
  interruptId: uuidSchema,
  createdAt: isoDateTimeSchema,
});

const employeeConfirmationSchema = pendingReferenceSchema.extend({
  kind: z.literal('employee_confirmation'),
  decisionStatus: z.enum(['pending', 'confirmed', 'rejected']),
  allowedResponses: z.array(z.enum(['confirm', 'reject'])).max(2),
  approvalSubject: safeSubjectSchema.extend({ approvalId: uuidSchema }),
}).superRefine((value, context) => {
  const expectedCount = value.decisionStatus === 'pending' ? 2 : 0;
  if (value.allowedResponses.length !== expectedCount) {
    context.addIssue({
      code: 'custom',
      path: ['allowedResponses'],
      message: 'Allowed responses must match the immutable Approval decision state',
    });
  }
});

const uncertainToolOutcomeReviewSchema = pendingReferenceSchema.extend({
  kind: z.literal('uncertain_tool_outcome_review'),
  allowedResponses: z.array(z.literal('continue_with_uncertainty')).length(1),
  subject: safeSubjectSchema,
});

export const pendingInterruptSchema = z.union([
  employeeConfirmationSchema,
  uncertainToolOutcomeReviewSchema,
]);

export const pendingInterruptPageSchema = z.object({
  items: z.array(pendingInterruptSchema).max(50),
  nextCursor: z.string().min(1).nullable(),
});

export type PendingInterruptContract = z.infer<typeof pendingInterruptSchema>;
export type PendingInterruptPageContract = z.infer<typeof pendingInterruptPageSchema>;
