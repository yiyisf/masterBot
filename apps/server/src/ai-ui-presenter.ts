import { uuidSchema } from '@cmaster/contracts';
import { runId, type RunEventEnvelope } from '@cmaster/execution';
import type { FastifyInstance } from 'fastify';
import { UI_MESSAGE_STREAM_HEADERS, type UIMessageChunk } from 'ai';
import { z } from 'zod';
import {
  followRunEventBatches,
  sendRunApiError,
  type RunApiDependencies,
} from './run-api.js';

interface PresenterState {
  generation: number;
}

function textPartId(event: RunEventEnvelope, generation: number): string {
  return `${event.runId}:output:${generation}`;
}

function eventData(event: RunEventEnvelope): Record<string, unknown> {
  return event.data && typeof event.data === 'object' && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : {};
}

/**
 * canonical Run Event 到 AI SDK UI Chunk 的单向映射。
 * 每个 Run Event 最多生成一个 Chunk，确保 SSE id=Run sequence 时不会在同一 sequence 中途断裂。
 */
export function presentRunEvent(
  event: RunEventEnvelope,
  state: PresenterState,
): UIMessageChunk {
  const data = eventData(event);
  const generation = typeof data.generation === 'number' ? data.generation : state.generation;
  state.generation = generation;

  if (event.type.startsWith('tool.')) {
    return {
      type: 'data-cmaster-tool',
      id: event.eventId,
      data: { eventType: event.type, ...data, sequence: event.sequence },
    };
  }

  switch (event.type) {
    case 'invocation.output_started':
      return { type: 'text-start', id: textPartId(event, generation) };
    case 'invocation.output_delta':
      return {
        type: 'text-delta',
        id: textPartId(event, generation),
        delta: typeof data.text === 'string' ? data.text : '',
      };
    case 'invocation.output_completed':
      return { type: 'text-end', id: textPartId(event, generation) };
    case 'invocation.output_reset':
      // AI SDK 没有通用“撤回已显示文本”Chunk；临时使用 data part，正式 Workspace Presenter 会消费它并替换投影。
      return {
        type: 'data-cmaster-output-reset',
        id: event.eventId,
        data: { generation, reason: data.reason ?? 'unknown', sequence: event.sequence },
      };
    case 'run.succeeded':
      return { type: 'finish', finishReason: 'stop' };
    case 'run.failed': {
      const failure = data.failure && typeof data.failure === 'object'
        ? data.failure as Record<string, unknown>
        : {};
      return {
        type: 'error',
        errorText: typeof failure.message === 'string'
          ? failure.message
          : 'The Run could not be completed.',
      };
    }
    case 'run.cancelled':
      return { type: 'abort', reason: 'The Run was cancelled.' };
    case 'model.selected':
    case 'model.fallback_selected':
    case 'model.output_discarded':
    case 'model.completed':
    case 'model.failed':
      return {
        type: 'data-cmaster-model',
        id: event.eventId,
        data: { eventType: event.type, ...data, sequence: event.sequence },
      };
    default:
      return {
        type: 'data-cmaster-event',
        id: event.eventId,
        data: { eventType: event.type, sequence: event.sequence },
      };
  }
}

export function registerAiUiPresenter(
  app: FastifyInstance,
  dependencies: RunApiDependencies,
): void {
  app.get('/api/v1/runs/:runId/ui-stream', async (request, reply) => {
    try {
      const params = z.object({ runId: uuidSchema }).parse(request.params);
      const query = z.object({ afterSequence: z.coerce.number().int().nonnegative().optional() }).parse(request.query);
      const lastEventId = request.headers['last-event-id'];
      const headerCursor = typeof lastEventId === 'string'
        ? z.coerce.number().int().nonnegative().parse(lastEventId)
        : undefined;
      let cursor = headerCursor ?? query.afterSequence ?? 0;
      const identity = dependencies.identity.resolveRequest();
      const initialRun = await dependencies.execution.getRun(identity, runId(params.runId));
      z.number().int().nonnegative().max(initialRun.lastSequence).parse(cursor);

      const corsOrigin = reply.getHeader('access-control-allow-origin');
      const corsCredentials = reply.getHeader('access-control-allow-credentials');
      reply.hijack();
      if (corsOrigin !== undefined) reply.raw.setHeader('Access-Control-Allow-Origin', corsOrigin);
      if (corsCredentials !== undefined) reply.raw.setHeader('Access-Control-Allow-Credentials', corsCredentials);
      reply.raw.writeHead(200, UI_MESSAGE_STREAM_HEADERS);
      const controller = new AbortController();
      request.raw.once('close', () => controller.abort());
      const state: PresenterState = { generation: 0 };

      if (['succeeded', 'failed', 'cancelled'].includes(initialRun.status)
        && cursor >= initialRun.lastSequence) {
        reply.raw.end('data: [DONE]\n\n');
        return;
      }
      for await (const events of followRunEventBatches(
        dependencies, identity, runId(params.runId), cursor, controller.signal,
      )) {
        for (const event of events) {
          const chunk = presentRunEvent(event, state);
          reply.raw.write(`id: ${event.sequence}\ndata: ${JSON.stringify(chunk)}\n\n`);
          cursor = event.sequence;
          if (['run.succeeded', 'run.failed', 'run.cancelled'].includes(event.type)) {
            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();
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
