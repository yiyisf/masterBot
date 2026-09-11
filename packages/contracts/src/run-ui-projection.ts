import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '#internal/conversations';

export const runUiStatusSchema = z.enum([
  'queued', 'working', 'waiting', 'completed', 'failed', 'cancelled',
]);

const safeDetailsSchema = z.record(z.string().max(80), z.string().max(500))
  .refine((details) => Object.keys(details).length <= 20, 'Too many safe detail fields');

export const runUiInterruptSchema = z.object({
  id: uuidSchema,
  kind: z.enum(['tool_confirmation', 'tool_outcome_review']),
  title: z.string().min(1).max(200),
  details: safeDetailsSchema,
  allowedResponses: z.array(z.enum([
    'confirm', 'reject', 'continue_with_uncertainty',
  ])).min(1).max(3),
});

const aggregateUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

const timelineTechnicalSchema = z.object({
  safeId: z.string().min(1).max(200).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  agentDisplayName: z.string().min(1).max(200).optional(),
  modelDisplayName: z.string().min(1).max(200).optional(),
  fallback: z.boolean().optional(),
  usage: aggregateUsageSchema.optional(),
  safeErrorCode: z.string().regex(/^[a-z0-9_]{1,100}$/u).optional(),
  correlationId: uuidSchema.optional(),
});

export const runUiTimelineItemSchema = z.object({
  id: uuidSchema,
  sequence: z.number().int().positive(),
  category: z.enum([
    'status', 'context', 'agent', 'tool', 'approval',
    'artifact', 'fallback', 'warning', 'completion',
  ]),
  presentation: z.enum([
    'run_accepted', 'run_queued', 'run_started', 'run_recovered', 'run_waiting',
    'run_resumed', 'context_prepared', 'agent_started', 'model_selected',
    'tool_running', 'tool_succeeded', 'tool_denied', 'tool_failed',
    'approval_requested', 'approval_resolved', 'artifact_available',
    'fallback_selected', 'output_restarted', 'run_completed', 'run_failed',
    'run_cancelled', 'activity_updated',
  ]),
  occurredAt: isoDateTimeSchema,
  tool: z.object({
    capability: z.string().min(1).max(200),
    status: z.enum([
      'running', 'succeeded', 'denied', 'failed',
      'confirmation_required', 'requires_review', 'unknown',
    ]),
    title: z.string().min(1).max(200).optional(),
    details: safeDetailsSchema.optional(),
  }).optional(),
  artifact: z.object({
    artifactId: uuidSchema,
    artifactVersionId: uuidSchema,
  }).optional(),
  technical: timelineTechnicalSchema.optional(),
});

export const runUiProjectionSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  runId: uuidSchema,
  conversationId: uuidSchema,
  triggerMessageId: uuidSchema,
  status: runUiStatusSchema,
  cancellable: z.boolean(),
  lastSequence: z.number().int().nonnegative(),
  draft: z.object({
    generation: z.number().int().nonnegative(),
    text: z.string(),
    state: z.enum(['streaming', 'complete']),
  }).optional(),
  assistantMessageId: uuidSchema.optional(),
  activeInterrupt: runUiInterruptSchema.optional(),
  timeline: z.array(runUiTimelineItemSchema).max(100),
  hasEarlierTimeline: z.boolean(),
  timelineBeforeSequence: z.number().int().positive().optional(),
  technical: z.object({
    correlationId: uuidSchema,
    agentRevisionId: uuidSchema.optional(),
    modelDisplayName: z.string().min(1).max(200).optional(),
    fallback: z.boolean().optional(),
    usage: aggregateUsageSchema.optional(),
    safeErrorCode: z.string().regex(/^[a-z0-9_]{1,100}$/u).optional(),
  }),
});

const projectionChangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('projection_advanced') }),
  z.object({ type: z.literal('status_changed'), status: runUiStatusSchema, cancellable: z.boolean() }),
  z.object({ type: z.literal('assistant_draft_started'), generation: z.number().int().nonnegative() }),
  z.object({ type: z.literal('assistant_draft_appended'), generation: z.number().int().nonnegative(), text: z.string() }),
  z.object({ type: z.literal('assistant_draft_reset'), generation: z.number().int().nonnegative(), reason: z.enum(['fallback', 'failure', 'recovery', 'unknown']) }),
  z.object({ type: z.literal('assistant_draft_completed'), generation: z.number().int().nonnegative() }),
  z.object({ type: z.literal('assistant_draft_cleared'), reason: z.enum(['message_available', 'failed', 'cancelled']) }),
  z.object({ type: z.literal('timeline_item_upserted'), item: runUiTimelineItemSchema }),
  z.object({ type: z.literal('active_interrupt_changed'), interrupt: runUiInterruptSchema.nullable() }),
  z.object({ type: z.literal('assistant_message_available'), messageId: uuidSchema }),
  z.object({ type: z.literal('artifact_available'), artifactId: uuidSchema, artifactVersionId: uuidSchema }),
]);

export const runUiProjectionEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: uuidSchema,
  runId: uuidSchema,
  sequence: z.number().int().positive(),
  type: z.literal('projection.updated'),
  changes: z.array(projectionChangeSchema).min(1).max(5),
});

export const runUiTimelinePageSchema = z.object({
  items: z.array(runUiTimelineItemSchema).max(100),
  beforeSequence: z.number().int().positive().optional(),
});

export type RunUiStatusContract = z.infer<typeof runUiStatusSchema>;
export type RunUiInterruptContract = z.infer<typeof runUiInterruptSchema>;
export type RunUiProjectionSnapshotContract = z.infer<typeof runUiProjectionSnapshotSchema>;
export type RunUiProjectionEventContract = z.infer<typeof runUiProjectionEventSchema>;
export type RunUiProjectionChangeContract = z.infer<typeof projectionChangeSchema>;
export type RunUiTimelineItemContract = z.infer<typeof runUiTimelineItemSchema>;
export type RunUiTimelinePageContract = z.infer<typeof runUiTimelinePageSchema>;
