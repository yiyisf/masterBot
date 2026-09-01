import {
  acceptRunResponseSchema,
  appendMessageRequestSchema,
  conversationSchema,
  createConversationRequestSchema,
  createRunRequestSchema,
  messagePageSchema,
  messageSchema,
  problemDetailsSchema,
  resolveInterruptRequestSchema,
  resolveInterruptResponseSchema,
  resolveToolConfirmationRequestSchema,
  resolveToolConfirmationResponseSchema,
  runEventEnvelopeSchema,
  runSnapshotSchema,
  uuidSchema,
} from '@cmaster/contracts';
import {
  commandId,
  conversationId,
  ConversationNotFoundError,
  IdempotencyConflictError,
  messageId,
  MessageNotFoundError,
  type Conversation,
  type ConversationModule,
  type Message,
} from '@cmaster/conversations';
import {
  interruptId,
  runCommandId,
  runId,
  RunIdempotencyConflictError,
  RunNotFoundError,
  type ExecutionModule,
  type RunEventEnvelope,
  type RunId,
  type RunSnapshot,
} from '@cmaster/execution';
import type { AgentModule } from '@cmaster/agents';
import type { IdentityModule } from '@cmaster/identity';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';
import type { RunEventNotifier } from './run-event-notifier.js';
import {
  ToolConfirmationConflictError,
  type ToolConfirmationCoordinator,
} from './tool-confirmation-coordinator.js';

export interface RunApiDependencies {
  identity: IdentityModule;
  agents: AgentModule;
  conversations: ConversationModule;
  execution: ExecutionModule;
  notifier: RunEventNotifier;
  toolConfirmation?: ToolConfirmationCoordinator;
}

export async function* followRunEventBatches(
  dependencies: Pick<RunApiDependencies, 'execution' | 'notifier'>,
  identity: ReturnType<IdentityModule['resolveRequest']>,
  id: RunId,
  afterSequence: number,
  signal: AbortSignal,
): AsyncIterable<readonly RunEventEnvelope[]> {
  let cursor = afterSequence;
  while (!signal.aborted) {
    const events = await dependencies.execution.readEvents(identity, id, cursor);
    yield events;
    for (const event of events) {
      cursor = event.sequence;
      if (['run.succeeded', 'run.failed', 'run.cancelled'].includes(event.type)) return;
    }
    await dependencies.notifier.wait(id, 2_000, signal);
  }
}

function idempotencyKey(request: FastifyRequest): string {
  return uuidSchema.parse(request.headers['idempotency-key']);
}

function conversationContract(value: Conversation): unknown {
  return conversationSchema.parse({
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  });
}

function messageContract(value: Message): unknown {
  return messageSchema.parse({ ...value, createdAt: value.createdAt.toISOString() });
}

function runContract(value: RunSnapshot): unknown {
  return runSnapshotSchema.parse({
    ...value,
    createdAt: value.createdAt.toISOString(),
    ...(value.startedAt ? { startedAt: value.startedAt.toISOString() } : {}),
    ...(value.completedAt ? { completedAt: value.completedAt.toISOString() } : {}),
  });
}

function eventContract(value: RunEventEnvelope): unknown {
  return runEventEnvelopeSchema.parse({ ...value, timestamp: value.timestamp.toISOString() });
}

function problem(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: string,
  title: string,
  detail: string,
): FastifyReply {
  return reply.status(status).type('application/problem+json').send(problemDetailsSchema.parse({
    type: `https://cmaster.dev/problems/${code.replaceAll('_', '-')}`,
    title,
    status,
    code,
    detail,
    instance: request.url,
  }));
}

export function sendRunApiError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof ZodError) {
    return problem(reply, request, 400, 'invalid_request', 'Invalid request', 'The request does not match the API contract.');
  }
  if (error instanceof ConversationNotFoundError || error instanceof MessageNotFoundError || error instanceof RunNotFoundError) {
    return problem(reply, request, 404, 'resource_not_found', 'Resource not found', 'The requested resource was not found.');
  }
  if (error instanceof ToolConfirmationConflictError) {
    return problem(reply, request, 409, 'tool_confirmation_conflict', 'Tool confirmation conflict', 'The Tool confirmation is no longer active.');
  }
  if (error instanceof IdempotencyConflictError || error instanceof RunIdempotencyConflictError) {
    return problem(reply, request, 409, 'idempotency_conflict', 'Idempotency conflict', 'The Idempotency-Key was already used for another command.');
  }
  request.log.error({ err: error }, 'Run API request failed');
  return problem(reply, request, 500, 'internal_error', 'Internal error', 'The request could not be completed.');
}

export function registerRunApi(app: FastifyInstance, dependencies: RunApiDependencies): void {
  app.post('/api/v1/conversations', async (request, reply) => {
    try {
      const body = createConversationRequestSchema.parse(request.body);
      const result = await dependencies.conversations.create(dependencies.identity.resolveRequest(), {
        commandId: commandId(idempotencyKey(request)),
        ...(body.title ? { title: body.title } : {}),
      });
      reply.header('Idempotency-Replayed', String(result.replayed));
      return reply.status(201).send(conversationContract(result.value));
    } catch (error) {
      return sendRunApiError(error, request, reply);
    }
  });

  app.get('/api/v1/conversations/:conversationId', async (request, reply) => {
    try {
      const params = z.object({ conversationId: uuidSchema }).parse(request.params);
      const value = await dependencies.conversations.get(
        dependencies.identity.resolveRequest(), conversationId(params.conversationId),
      );
      return reply.send(conversationContract(value));
    } catch (error) {
      return sendRunApiError(error, request, reply);
    }
  });

  app.post('/api/v1/conversations/:conversationId/messages', async (request, reply) => {
    try {
      const params = z.object({ conversationId: uuidSchema }).parse(request.params);
      const body = appendMessageRequestSchema.parse(request.body);
      const result = await dependencies.conversations.appendEmployeeMessage(
        dependencies.identity.resolveRequest(), conversationId(params.conversationId), {
          commandId: commandId(idempotencyKey(request)), parts: body.parts,
        },
      );
      reply.header('Idempotency-Replayed', String(result.replayed));
      return reply.status(201).send(messageContract(result.value));
    } catch (error) {
      return sendRunApiError(error, request, reply);
    }
  });

  app.get('/api/v1/conversations/:conversationId/messages', async (request, reply) => {
    try {
      const params = z.object({ conversationId: uuidSchema }).parse(request.params);
      const query = z.object({
        afterSequence: z.coerce.number().int().nonnegative().default(0),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      }).parse(request.query);
      const items = await dependencies.conversations.listMessages(
        dependencies.identity.resolveRequest(), conversationId(params.conversationId),
        query.afterSequence, query.limit,
      );
      return reply.send(messagePageSchema.parse({
        items: items.map(messageContract),
        nextSequence: items.at(-1)?.sequence ?? query.afterSequence,
      }));
    } catch (error) {
      return sendRunApiError(error, request, reply);
    }
  });

  app.post('/api/v1/runs', async (request, reply) => {
    try {
      const body = createRunRequestSchema.parse(request.body);
      const identity = dependencies.identity.resolveRequest();
      const trigger = await dependencies.conversations.getMessageTrigger(
        identity.organizationId, messageId(body.trigger.messageId),
      );
      const agent = await dependencies.agents.resolveDefault(identity.organizationId);
      const result = await dependencies.execution.acceptRun(identity, {
        commandId: runCommandId(idempotencyKey(request)),
        messageId: trigger.messageId,
        conversationId: trigger.conversationId,
        agent,
      });
      reply.header('Idempotency-Replayed', String(result.replayed));
      return reply.status(202).send(acceptRunResponseSchema.parse({
        runId: result.value.id,
        eventsUrl: `/api/v1/runs/${result.value.id}/events`,
      }));
    } catch (error) {
      return sendRunApiError(error, request, reply);
    }
  });

  app.get('/api/v1/runs/:runId', async (request, reply) => {
    try {
      const params = z.object({ runId: uuidSchema }).parse(request.params);
      const value = await dependencies.execution.getRun(
        dependencies.identity.resolveRequest(), runId(params.runId),
      );
      return reply.send(runContract(value));
    } catch (error) {
      return sendRunApiError(error, request, reply);
    }
  });

  app.post('/api/v1/runs/:runId/commands/cancel', async (request, reply) => {
    try {
      const params = z.object({ runId: uuidSchema }).parse(request.params);
      const result = await dependencies.execution.cancelRun(
        dependencies.identity.resolveRequest(), runId(params.runId),
        runCommandId(idempotencyKey(request)),
      );
      reply.header('Idempotency-Replayed', String(result.replayed));
      if (result.kind === 'too_late') {
        return problem(reply, request, 409, 'run_cancellation_too_late', 'Cancellation too late', 'The result was already generated and will be delivered.');
      }
      return reply.send({ outcome: 'cancelled', run: runContract(result.run) });
    } catch (error) {
      return sendRunApiError(error, request, reply);
    }
  });

  if (dependencies.toolConfirmation) {
    app.post('/api/v1/runs/:runId/tool-confirmations/:interruptId/resolve', async (request, reply) => {
      try {
        const params = z.object({ runId: uuidSchema, interruptId: uuidSchema }).parse(request.params);
        const body = resolveToolConfirmationRequestSchema.parse(request.body);
        // Confirmation is durable; Browser disconnect must not abort an in-flight Provider operation.
        const result = await dependencies.toolConfirmation!.resolve(
          dependencies.identity.resolveRequest(), runId(params.runId), interruptId(params.interruptId), {
            commandId: idempotencyKey(request),
            response: body.response,
            signal: new AbortController().signal,
          },
        );
        reply.header('Idempotency-Replayed', String(result.replayed));
        return reply.send(resolveToolConfirmationResponseSchema.parse({
          run: runContract(result.run),
        }));
      } catch (error) {
        return sendRunApiError(error, request, reply);
      }
    });
  }

  app.post('/api/v1/runs/:runId/interrupts/:interruptId/resolve', async (request, reply) => {
    try {
      const params = z.object({ runId: uuidSchema, interruptId: uuidSchema }).parse(request.params);
      const body = resolveInterruptRequestSchema.parse(request.body);
      const result = await dependencies.execution.resolveInterrupt(
        dependencies.identity.resolveRequest(), runId(params.runId), interruptId(params.interruptId), {
          commandId: runCommandId(idempotencyKey(request)),
          response: body.response,
        },
      );
      reply.header('Idempotency-Replayed', String(result.replayed));
      return reply.send(resolveInterruptResponseSchema.parse({ run: runContract(result.value) }));
    } catch (error) {
      return sendRunApiError(error, request, reply);
    }
  });

  app.get('/api/v1/runs/:runId/events', async (request, reply) => {
    try {
      const params = z.object({ runId: uuidSchema }).parse(request.params);
      const query = z.object({ afterSequence: z.coerce.number().int().nonnegative().optional() }).parse(request.query);
      const header = request.headers['last-event-id'];
      const cursorFromHeader = typeof header === 'string' ? z.coerce.number().int().nonnegative().parse(header) : undefined;
      let cursor = cursorFromHeader ?? query.afterSequence ?? 0;
      const identity = dependencies.identity.resolveRequest();
      const initialRun = await dependencies.execution.getRun(identity, runId(params.runId));
      if (cursor > initialRun.lastSequence) {
        return problem(reply, request, 400, 'invalid_event_cursor', 'Invalid event cursor', 'The event cursor is ahead of the Run.');
      }

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
        reply.raw.end();
        return;
      }
      let heartbeatAt = Date.now();
      for await (const events of followRunEventBatches(
        dependencies, identity, runId(params.runId), cursor, controller.signal,
      )) {
        for (const event of events) {
          reply.raw.write(`id: ${event.sequence}\nevent: run-event\ndata: ${JSON.stringify(eventContract(event))}\n\n`);
          cursor = event.sequence;
          if (['run.succeeded', 'run.failed', 'run.cancelled'].includes(event.type)) {
            reply.raw.end();
            return;
          }
        }
        if (Date.now() - heartbeatAt >= 15_000) {
          reply.raw.write(': heartbeat\n\n');
          heartbeatAt = Date.now();
        }
      }
      reply.raw.end();
    } catch (error) {
      if (!reply.raw.headersSent) return sendRunApiError(error, request, reply);
      reply.raw.end();
    }
  });
}
