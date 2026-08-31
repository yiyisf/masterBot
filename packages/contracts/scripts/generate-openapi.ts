import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);
const conversations = await import('../src/conversations.js');
const runs = await import('../src/runs.js');
const { problemDetailsSchema } = await import('../src/problem.js');
const { systemStatusSchema } = await import('../src/system-status.js');

const registry = new OpenAPIRegistry();
const problem = registry.register('ProblemDetails', problemDetailsSchema);
const conversation = registry.register('Conversation', conversations.conversationSchema);
const message = registry.register('Message', conversations.messageSchema);
const messagePage = registry.register('MessagePage', conversations.messagePageSchema);
const run = registry.register('RunSnapshot', runs.runSnapshotSchema);
const acceptRunResponse = registry.register('AcceptRunResponse', runs.acceptRunResponseSchema);
registry.register('RunEvent', runs.runEventEnvelopeSchema);
const cancelResponse = registry.register('CancelRunResponse', runs.cancelRunResponseSchema);
const resolveInterruptResponse = registry.register(
  'ResolveInterruptResponse', runs.resolveInterruptResponseSchema,
);
const systemStatus = registry.register('SystemStatus', systemStatusSchema);

const idempotencyHeaders = z.object({ 'idempotency-key': z.uuid() });
const idempotencyReplayHeaders = z.object({ 'Idempotency-Replayed': z.enum(['true', 'false']) });
const optionalIdempotencyReplayHeaders = z.object({
  'Idempotency-Replayed': z.enum(['true', 'false']).optional(),
});
const idPath = (name: string) => z.object({ [name]: z.uuid() });
const problemResponse = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problem } },
});

registry.registerPath({
  method: 'get', path: '/api/v1/system/status', summary: 'Read system status',
  responses: { 200: { description: 'Current status', content: { 'application/json': { schema: systemStatus } } } },
});
registry.registerPath({
  method: 'post', path: '/api/v1/conversations', summary: 'Create a Conversation',
  request: { headers: idempotencyHeaders, body: { required: true, content: { 'application/json': { schema: conversations.createConversationRequestSchema } } } },
  responses: {
    201: { description: 'Conversation created or replayed', headers: idempotencyReplayHeaders, content: { 'application/json': { schema: conversation } } },
    400: problemResponse('Invalid command'), 409: problemResponse('Idempotency conflict'),
  },
});
registry.registerPath({
  method: 'get', path: '/api/v1/conversations/{conversationId}', summary: 'Read a Conversation',
  request: { params: idPath('conversationId') },
  responses: { 200: { description: 'Conversation', content: { 'application/json': { schema: conversation } } }, 400: problemResponse('Invalid request'), 404: problemResponse('Not found') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/conversations/{conversationId}/messages', summary: 'Append an Employee Message',
  request: {
    params: idPath('conversationId'), headers: idempotencyHeaders,
    body: { required: true, content: { 'application/json': { schema: conversations.appendMessageRequestSchema } } },
  },
  responses: {
    201: { description: 'Message appended or replayed', headers: idempotencyReplayHeaders, content: { 'application/json': { schema: message } } },
    400: problemResponse('Invalid command'), 404: problemResponse('Not found'), 409: problemResponse('Idempotency conflict'),
  },
});
registry.registerPath({
  method: 'get', path: '/api/v1/conversations/{conversationId}/messages', summary: 'Read ordered Messages',
  request: {
    params: idPath('conversationId'),
    query: z.object({ afterSequence: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(200).default(100) }),
  },
  responses: { 200: { description: 'Message page', content: { 'application/json': { schema: messagePage } } }, 400: problemResponse('Invalid request'), 404: problemResponse('Not found') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/runs', summary: 'Accept a Run',
  request: { headers: idempotencyHeaders, body: { required: true, content: { 'application/json': { schema: runs.createRunRequestSchema } } } },
  responses: {
    202: { description: 'Run accepted or replayed', headers: idempotencyReplayHeaders, content: { 'application/json': { schema: acceptRunResponse } } },
    400: problemResponse('Invalid command'), 404: problemResponse('Trigger not found'), 409: problemResponse('Idempotency conflict'),
  },
});
registry.registerPath({
  method: 'get', path: '/api/v1/runs/{runId}', summary: 'Read a Run Snapshot',
  request: { params: idPath('runId') },
  responses: { 200: { description: 'Run Snapshot', content: { 'application/json': { schema: run } } }, 400: problemResponse('Invalid request'), 404: problemResponse('Not found') },
});
registry.registerPath({
  method: 'post', path: '/api/v1/runs/{runId}/interrupts/{interruptId}/resolve',
  summary: 'Resolve an active Run Interrupt',
  request: {
    params: z.object({ runId: z.uuid(), interruptId: z.uuid() }),
    headers: idempotencyHeaders,
    body: {
      required: true,
      content: { 'application/json': { schema: runs.resolveInterruptRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Interrupt resolved or replayed',
      headers: idempotencyReplayHeaders,
      content: { 'application/json': { schema: resolveInterruptResponse } },
    },
    400: problemResponse('Invalid request'), 404: problemResponse('Not found'),
    409: problemResponse('Interrupt response or idempotency conflict'),
  },
});
registry.registerPath({
  method: 'get', path: '/api/v1/runs/{runId}/events', summary: 'Stream replayable Run Events',
  request: {
    params: idPath('runId'),
    query: z.object({ afterSequence: z.coerce.number().int().nonnegative().optional() }),
    headers: z.object({ 'last-event-id': z.string().regex(/^\d+$/).optional() }),
  },
  responses: {
    200: { description: 'SSE stream; each data field is a RunEvent', content: { 'text/event-stream': { schema: z.string() } } },
    400: problemResponse('Invalid request'), 404: problemResponse('Not found'),
  },
});
registry.registerPath({
  method: 'get', path: '/api/v1/runs/{runId}/ui-stream', summary: 'Present Run Events as an AI SDK UI Message Stream',
  request: {
    params: idPath('runId'),
    query: z.object({ afterSequence: z.coerce.number().int().nonnegative().optional() }),
    headers: z.object({ 'last-event-id': z.string().regex(/^\\d+$/).optional() }),
  },
  responses: {
    200: { description: 'AI SDK UI Message Stream derived from canonical Run Events', content: { 'text/event-stream': { schema: z.string() } } },
    400: problemResponse('Invalid request'), 404: problemResponse('Not found'),
  },
});
registry.registerPath({
  method: 'post', path: '/api/v1/runs/{runId}/commands/cancel', summary: 'Cancel a Run',
  request: { params: idPath('runId'), headers: idempotencyHeaders },
  responses: {
    200: { description: 'Run cancelled or replayed', headers: idempotencyReplayHeaders, content: { 'application/json': { schema: cancelResponse } } },
    400: problemResponse('Invalid request'), 404: problemResponse('Not found'),
    409: { ...problemResponse('Cancellation too late or idempotency conflict'), headers: optionalIdempotencyReplayHeaders },
  },
});

const generator = new OpenApiGeneratorV31(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.1.0', info: { title: 'CMaster Bot API', version: '1.0.0' },
});
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(packageRoot, 'openapi/openapi.v1.json');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
