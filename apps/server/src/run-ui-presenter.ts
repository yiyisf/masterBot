import {
  runUiProjectionEventSchema,
  runUiProjectionSnapshotSchema,
  runUiTimelinePageSchema,
  uuidSchema,
  type RunUiInterruptContract,
  type RunUiProjectionChangeContract,
  type RunUiProjectionEventContract,
  type RunUiProjectionSnapshotContract,
  type RunUiStatusContract,
  type RunUiTimelineItemContract,
} from '@cmaster/contracts';
import { runId, type RunEventEnvelope, type RunSnapshot } from '@cmaster/execution';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  followRunEventBatches,
  sendRunApiError,
  type RunApiDependencies,
} from './run-api.js';

function eventData(event: RunEventEnvelope): Record<string, unknown> {
  return event.data && typeof event.data === 'object' && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : {};
}

function numeric(data: Record<string, unknown>, key: string, fallback = 0): number {
  return typeof data[key] === 'number' && Number.isInteger(data[key]) && data[key] >= 0
    ? data[key] : fallback;
}

function projectionStatus(status: RunSnapshot['status']): RunUiStatusContract {
  if (status === 'accepted' || status === 'queued') return 'queued';
  if (status === 'running') return 'working';
  if (status === 'waiting') return 'waiting';
  if (status === 'succeeded') return 'completed';
  return status;
}

function safeDetails(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .slice(0, 20)
    .map(([key, detail]) => [key.slice(0, 80), detail.slice(0, 500)] as const);
  return Object.fromEntries(entries);
}

function safeSummary(value: unknown): { title?: string; details?: Record<string, string> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const summary = value as Record<string, unknown>;
  const details = safeDetails(summary.details);
  return {
    ...(typeof summary.title === 'string' && summary.title
      ? { title: summary.title.slice(0, 200) } : {}),
    ...(details ? { details } : {}),
  };
}

function interruptProjection(data: Record<string, unknown>): RunUiInterruptContract | undefined {
  const summary = safeSummary(data.safeSubjectSummary);
  const allowed = Array.isArray(data.allowedResponses)
    ? data.allowedResponses.filter((response): response is 'confirm' | 'reject' | 'continue_with_uncertainty' => (
        response === 'confirm' || response === 'reject' || response === 'continue_with_uncertainty'
      ))
    : [];
  if (typeof data.interruptId !== 'string'
    || (data.kind !== 'tool_confirmation' && data.kind !== 'tool_outcome_review')
    || !summary.title || !summary.details || allowed.length === 0) return undefined;
  return {
    id: data.interruptId,
    kind: data.kind,
    title: summary.title,
    details: summary.details,
    allowedResponses: allowed.slice(0, 3),
  };
}

function snapshotInterrupt(run: RunSnapshot): RunUiInterruptContract | undefined {
  const interrupt = run.activeInterrupt;
  if (!interrupt) return undefined;
  return {
    id: interrupt.id,
    kind: interrupt.kind,
    title: interrupt.safeSubjectSummary.title.slice(0, 200),
    details: safeDetails(interrupt.safeSubjectSummary.details) ?? {},
    allowedResponses: interrupt.allowedResponses.filter((response) => (
      response === 'confirm' || response === 'reject' || response === 'continue_with_uncertainty'
    )).slice(0, 3),
  };
}

function timelineItem(
  event: RunEventEnvelope,
  category: RunUiTimelineItemContract['category'],
  presentation: RunUiTimelineItemContract['presentation'],
  extras: Partial<Pick<RunUiTimelineItemContract, 'tool' | 'artifact' | 'technical'>> = {},
): RunUiTimelineItemContract {
  return {
    id: event.eventId,
    sequence: event.sequence,
    category,
    presentation,
    occurredAt: event.timestamp.toISOString(),
    ...extras,
  };
}

function toolTimeline(event: RunEventEnvelope, data: Record<string, unknown>): RunUiTimelineItemContract {
  const status = event.type.slice('tool.'.length);
  const safeStatus = [
    'succeeded', 'denied', 'failed', 'confirmation_required', 'requires_review',
  ].includes(status) ? status as 'succeeded' | 'denied' | 'failed' | 'confirmation_required' | 'requires_review' : 'unknown';
  const presentation = safeStatus === 'succeeded' ? 'tool_succeeded'
    : safeStatus === 'denied' ? 'tool_denied'
      : safeStatus === 'failed' ? 'tool_failed' : 'tool_running';
  const summary = safeSummary(data.safeSummary);
  return timelineItem(event, 'tool', presentation, {
    tool: {
      capability: typeof data.toolName === 'string' ? data.toolName.slice(0, 200) : 'unknown',
      status: safeStatus,
      ...summary,
    },
    ...(typeof data.toolCallId === 'string'
      ? { technical: { safeId: data.toolCallId.slice(0, 200), correlationId: event.correlationId } }
      : {}),
  });
}

function timelineChange(event: RunEventEnvelope): RunUiProjectionChangeContract {
  const data = eventData(event);
  if (event.type.startsWith('tool.')) {
    return { type: 'timeline_item_upserted', item: toolTimeline(event, data) };
  }
  if (event.type === 'artifact.created'
    && typeof data.artifactId === 'string' && typeof data.artifactVersionId === 'string') {
    return {
      type: 'timeline_item_upserted',
      item: timelineItem(event, 'artifact', 'artifact_available', {
        artifact: {
          artifactId: data.artifactId,
          artifactVersionId: data.artifactVersionId,
        },
        technical: { correlationId: event.correlationId },
      }),
    };
  }
  if (event.type === 'invocation.output_reset') {
    const category = data.reason === 'fallback' ? 'fallback' : 'warning';
    return {
      type: 'timeline_item_upserted',
      item: timelineItem(event, category, 'output_restarted', {
        technical: { fallback: data.reason === 'fallback', correlationId: event.correlationId },
      }),
    };
  }
  const mapped: Partial<Record<RunEventEnvelope['type'], [
    RunUiTimelineItemContract['category'], RunUiTimelineItemContract['presentation'],
  ]>> = {
    'run.accepted': ['status', 'run_accepted'],
    'run.queued': ['status', 'run_queued'],
    'run.started': ['status', 'run_started'],
    'run.recovery_started': ['warning', 'run_recovered'],
    'run.waiting': ['status', 'run_waiting'],
    'run.resumed': ['status', 'run_resumed'],
    'invocation.context_built': ['context', 'context_prepared'],
    'invocation.started': ['agent', 'agent_started'],
    'model.selected': ['agent', 'model_selected'],
    'model.fallback_selected': ['fallback', 'fallback_selected'],
    'model.output_discarded': ['fallback', 'output_restarted'],
    'interrupt.requested': ['approval', 'approval_requested'],
    'interrupt.resolved': ['approval', 'approval_resolved'],
    'artifact.created': ['artifact', 'artifact_available'],
    'run.succeeded': ['completion', 'run_completed'],
    'run.failed': ['completion', 'run_failed'],
    'run.cancelled': ['completion', 'run_cancelled'],
  };
  const value = mapped[event.type] ?? ['warning', 'activity_updated'];
  const technical = event.type === 'model.selected' || event.type === 'model.fallback_selected'
    ? {
        ...(typeof data.displayName === 'string'
          ? { modelDisplayName: data.displayName.slice(0, 200) } : {}),
        fallback: event.type === 'model.fallback_selected' || data.fallback === true,
        correlationId: event.correlationId,
      }
    : { correlationId: event.correlationId };
  return {
    type: 'timeline_item_upserted',
    item: timelineItem(event, value[0], value[1], { technical }),
  };
}

/** 将一个 canonical sequence 映射为只含白名单字段的 Projection envelope。 */
export function projectRunEvent(event: RunEventEnvelope): RunUiProjectionEventContract {
  const data = eventData(event);
  const changes: RunUiProjectionChangeContract[] = [];
  const activeStatus: Partial<Record<RunEventEnvelope['type'], RunSnapshot['status']>> = {
    'run.accepted': 'accepted', 'run.queued': 'queued', 'run.started': 'running',
    'run.recovery_started': 'running', 'run.waiting': 'waiting', 'run.resumed': 'queued',
    'run.succeeded': 'succeeded', 'run.failed': 'failed', 'run.cancelled': 'cancelled',
  };
  const status = activeStatus[event.type];
  if (status) {
    changes.push({
      type: 'status_changed',
      status: projectionStatus(status),
      cancellable: ['accepted', 'queued', 'running', 'waiting'].includes(status),
    });
  }

  const generation = numeric(data, 'generation');
  if (event.type === 'invocation.output_started') {
    changes.push({ type: 'assistant_draft_started', generation });
  } else if (event.type === 'invocation.output_delta') {
    changes.push({
      type: 'assistant_draft_appended', generation,
      text: typeof data.text === 'string' ? data.text : '',
    });
  } else if (event.type === 'invocation.output_reset') {
    const reason = data.reason === 'fallback' || data.reason === 'failure' || data.reason === 'recovery'
      ? data.reason : 'unknown';
    changes.push({ type: 'assistant_draft_reset', generation, reason });
  } else if (event.type === 'invocation.output_completed') {
    changes.push({ type: 'assistant_draft_completed', generation });
  } else if (event.type === 'assistant_message.appended' && typeof data.messageId === 'string') {
    changes.push({ type: 'assistant_message_available', messageId: data.messageId });
    changes.push({ type: 'assistant_draft_cleared', reason: 'message_available' });
  } else if (event.type === 'run.failed' || event.type === 'run.cancelled') {
    changes.push({
      type: 'assistant_draft_cleared',
      reason: event.type === 'run.failed' ? 'failed' : 'cancelled',
    });
  }

  if (event.type === 'interrupt.requested') {
    const interrupt = interruptProjection(data);
    if (interrupt) changes.push({ type: 'active_interrupt_changed', interrupt });
  } else if (event.type === 'interrupt.resolved') {
    changes.push({ type: 'active_interrupt_changed', interrupt: null });
  }
  if (event.type === 'artifact.created'
    && typeof data.artifactId === 'string' && typeof data.artifactVersionId === 'string') {
    changes.push({
      type: 'artifact_available',
      artifactId: data.artifactId,
      artifactVersionId: data.artifactVersionId,
    });
  }
  if ((!event.type.startsWith('invocation.output_') || event.type === 'invocation.output_reset')
    && event.type !== 'assistant_message.appended') changes.push(timelineChange(event));
  if (changes.length === 0) changes.push({ type: 'projection_advanced' });

  return runUiProjectionEventSchema.parse({
    schemaVersion: 1,
    eventId: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    type: 'projection.updated',
    changes,
  });
}

export function buildRunUiProjectionSnapshot(
  run: RunSnapshot,
  events: readonly RunEventEnvelope[],
): RunUiProjectionSnapshotContract {
  let draft: RunUiProjectionSnapshotContract['draft'];
  let assistantMessageId = run.assistantMessageId as string | undefined;
  const timeline: RunUiTimelineItemContract[] = [];
  for (const event of events) {
    const projected = projectRunEvent(event);
    for (const change of projected.changes) {
      if (change.type === 'assistant_draft_started') {
        draft = { generation: change.generation, text: '', state: 'streaming' };
      } else if (change.type === 'assistant_draft_appended') {
        if (!draft || draft.generation !== change.generation) {
          draft = { generation: change.generation, text: '', state: 'streaming' };
        }
        draft = { ...draft, text: `${draft.text}${change.text}` };
      } else if (change.type === 'assistant_draft_reset') {
        draft = { generation: change.generation, text: '', state: 'streaming' };
      } else if (change.type === 'assistant_draft_completed' && draft?.generation === change.generation) {
        draft = { ...draft, state: 'complete' };
      } else if (change.type === 'assistant_draft_cleared') {
        draft = undefined;
      } else if (change.type === 'assistant_message_available') {
        assistantMessageId = change.messageId;
      } else if (change.type === 'timeline_item_upserted') {
        timeline.push(change.item);
      }
    }
  }
  if (run.status === 'failed' || run.status === 'cancelled' || assistantMessageId) draft = undefined;
  const recentTimeline = timeline.slice(-100);
  return runUiProjectionSnapshotSchema.parse({
    schemaVersion: 1,
    runId: run.id,
    conversationId: run.conversationId,
    triggerMessageId: run.trigger.messageId,
    status: projectionStatus(run.status),
    cancellable: run.cancellable,
    lastSequence: run.lastSequence,
    ...(draft ? { draft } : {}),
    ...(assistantMessageId ? { assistantMessageId } : {}),
    ...(snapshotInterrupt(run) ? { activeInterrupt: snapshotInterrupt(run) } : {}),
    timeline: recentTimeline,
    hasEarlierTimeline: timeline.length > recentTimeline.length,
    ...(timeline.length > recentTimeline.length && recentTimeline[0]
      ? { timelineBeforeSequence: recentTimeline[0].sequence } : {}),
    technical: {
      correlationId: run.id,
      agentRevisionId: run.agentRevisionId,
      ...(run.model ? {
        modelDisplayName: run.model.displayName.slice(0, 200),
        fallback: run.model.fallbackUsed,
      } : {}),
      ...(run.usage ? { usage: run.usage } : {}),
      ...(run.failure ? { safeErrorCode: run.failure.code } : {}),
    },
  });
}

function timelineFromEvents(events: readonly RunEventEnvelope[]): RunUiTimelineItemContract[] {
  return events.flatMap((event) => projectRunEvent(event).changes
    .filter((change): change is Extract<RunUiProjectionChangeContract, {
      type: 'timeline_item_upserted';
    }> => change.type === 'timeline_item_upserted')
    .map((change) => change.item));
}

export type RunUiPresenterDependencies = Pick<
  RunApiDependencies, 'identity' | 'execution' | 'notifier'
>;

export function registerRunUiPresenter(
  app: FastifyInstance,
  dependencies: RunUiPresenterDependencies,
): void {
  app.get('/api/v1/workspace/runs/:runId/projection', async (request, reply) => {
    try {
      const params = z.object({ runId: uuidSchema }).parse(request.params);
      const identity = dependencies.identity.resolveRequest();
      const id = runId(params.runId);
      const run = await dependencies.execution.getRun(identity, id);
      const events = await dependencies.execution.readEvents(identity, id, 0);
      return reply.send(buildRunUiProjectionSnapshot(run, events));
    } catch (error) {
      return sendRunApiError(error, request, reply);
    }
  });

  app.get('/api/v1/workspace/runs/:runId/timeline', async (request, reply) => {
    try {
      const params = z.object({ runId: uuidSchema }).parse(request.params);
      const query = z.object({
        beforeSequence: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(100),
      }).parse(request.query);
      const identity = dependencies.identity.resolveRequest();
      const id = runId(params.runId);
      let beforeSequence = query.beforeSequence;
      let items: RunUiTimelineItemContract[] = [];
      do {
        const page = await dependencies.execution.listEventPage(identity, id, {
          limit: query.limit - items.length,
          ...(beforeSequence === undefined ? {} : { beforeSequence }),
        });
        items = [...timelineFromEvents(page.items), ...items];
        beforeSequence = page.beforeSequence;
      } while (items.length < query.limit && beforeSequence !== undefined);
      return reply.send(runUiTimelinePageSchema.parse({
        items,
        ...(beforeSequence === undefined ? {} : { beforeSequence }),
      }));
    } catch (error) {
      return sendRunApiError(error, request, reply);
    }
  });

  app.get('/api/v1/workspace/runs/:runId/stream', async (request, reply) => {
    try {
      const params = z.object({ runId: uuidSchema }).parse(request.params);
      const query = z.object({
        afterSequence: z.coerce.number().int().nonnegative().optional(),
      }).parse(request.query);
      const lastEventId = request.headers['last-event-id'];
      const headerCursor = typeof lastEventId === 'string'
        ? z.coerce.number().int().nonnegative().parse(lastEventId) : undefined;
      let cursor = headerCursor ?? query.afterSequence ?? 0;
      const identity = dependencies.identity.resolveRequest();
      const id = runId(params.runId);
      const initialRun = await dependencies.execution.getRun(identity, id);
      z.number().int().nonnegative().max(initialRun.lastSequence).parse(cursor);

      const corsOrigin = reply.getHeader('access-control-allow-origin');
      const corsCredentials = reply.getHeader('access-control-allow-credentials');
      reply.hijack();
      if (corsOrigin !== undefined) reply.raw.setHeader('Access-Control-Allow-Origin', corsOrigin);
      if (corsCredentials !== undefined) reply.raw.setHeader('Access-Control-Allow-Credentials', corsCredentials);
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      const controller = new AbortController();
      request.raw.once('close', () => controller.abort());

      if (['succeeded', 'failed', 'cancelled'].includes(initialRun.status)
        && cursor >= initialRun.lastSequence) {
        reply.raw.end('data: [DONE]\n\n');
        return;
      }
      for await (const events of followRunEventBatches(
        dependencies, identity, id, cursor, controller.signal,
      )) {
        for (const event of events) {
          const projected = projectRunEvent(event);
          reply.raw.write(
            `id: ${event.sequence}\nevent: run-ui-projection\ndata: ${JSON.stringify(projected)}\n\n`,
          );
          cursor = event.sequence;
          if (['run.succeeded', 'run.failed', 'run.cancelled'].includes(event.type)) {
            reply.raw.end('data: [DONE]\n\n');
            return;
          }
        }
      }
      reply.raw.end();
    } catch (error) {
      if (!reply.raw.headersSent) return sendRunApiError(error, request, reply);
      reply.raw.end();
    }
  });
}
