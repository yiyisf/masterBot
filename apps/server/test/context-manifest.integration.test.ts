import { randomUUID } from 'node:crypto';
import {
  commandId,
  MessageNotFoundError,
  PostgresConversationModule,
} from '@cmaster/conversations';
import {
  ContextBuildFailureError,
  ContextCompressionRequiredError,
  ContextInputTooLargeError,
  contextInvocationId,
  contextRunId,
  PostgresContextBuilder,
} from '@cmaster/context';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import {
  modelProfileId,
  type ModelEvent,
  type ModelGateway,
  type ModelInvocationRequest,
} from '@cmaster/models';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
const pool = new Pool({ connectionString: databaseUrl });

beforeAll(async () => {
  await pool.query('SELECT 1');
});

afterAll(async () => {
  await pool.end();
});

const summaryText = `## Employee Goal\nLaunch safely\n## Explicit Constraints\nNone\n## Established Facts\nPrior analysis exists\n## Decisions and Commitments\nUse staged rollout\n## Relevant Artifacts\nNone\n## Unresolved Items\nConfirm launch date`;

class SummaryModelGateway implements Pick<ModelGateway, 'stream'> {
  readonly requests: ModelInvocationRequest[] = [];

  constructor(
    private readonly mode: 'success' | 'fallback' | 'failure' | 'unsafe' = 'success',
  ) {}

  async *stream(request: ModelInvocationRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const callId = randomUUID() as never;
    const profile = { id: modelProfileId(randomUUID()), displayName: 'Summary Model' };
    yield { type: 'model_selected', callId, profile, fallback: false };
    if (this.mode === 'fallback') {
      yield { type: 'text_delta', text: 'discarded private draft' };
      yield {
        type: 'model_output_discarded',
        profileId: profile.id,
        reason: 'fallback',
      };
      const fallbackProfile = { id: modelProfileId(randomUUID()), displayName: 'Fallback Summary' };
      const fallbackCallId = randomUUID() as never;
      yield {
        type: 'model_fallback_selected',
        fromProfileId: profile.id,
        toProfile: fallbackProfile,
      };
      yield { type: 'model_selected', callId: fallbackCallId, profile: fallbackProfile, fallback: true };
      yield { type: 'text_delta', text: summaryText };
      yield {
        type: 'model_completed',
        callId: fallbackCallId,
        profile: fallbackProfile,
        usage: { inputTokens: 1_700, outputTokens: 180, totalTokens: 1_880 },
        fallbackUsed: true,
      };
      return;
    }
    if (this.mode === 'failure') {
      yield {
        type: 'model_failed',
        callId,
        profile,
        failure: {
          code: 'stream_interrupted',
          message: 'provider secret must not escape',
          retryable: true,
        },
        hadOutput: false,
      };
      return;
    }
    yield {
      type: 'text_delta',
      text: this.mode === 'unsafe' ? `${summaryText}\npassword=leaked-value` : summaryText,
    };
    yield {
      type: 'model_completed',
      callId,
      profile,
      usage: { inputTokens: 1_700, outputTokens: 180, totalTokens: 1_880 },
      fallbackUsed: false,
    };
  }
}

async function provisionIdentity() {
  const identity = new PostgresDevelopmentIdentity(pool, {
    organizationId: organizationId(randomUUID()),
    organizationName: `Context Org ${randomUUID()}`,
    principalId: principalId(randomUUID()),
    principalDisplayName: 'Context Employee',
  });
  await identity.provision();
  return identity;
}

describe('governed Invocation Context', () => {
  it('reads immutable Conversation history only through the Trigger Message', async () => {
    const identity = await provisionIdentity();
    const conversations = new PostgresConversationModule(pool);
    const requestIdentity = identity.resolveRequest();
    const conversation = (await conversations.create(requestIdentity, {
      commandId: commandId(randomUUID()),
      title: 'Bounded history',
    })).value;
    const first = (await conversations.appendEmployeeMessage(requestIdentity, conversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: 'first request' }],
    })).value;
    const answer = (await conversations.appendAssistantMessage({
      organizationId: requestIdentity.organizationId,
      conversationId: conversation.id,
      sourceRunId: randomUUID(),
      sourceInvocationId: randomUUID(),
      parts: [{ type: 'text', text: 'first answer' }],
    })).value;
    const trigger = (await conversations.appendEmployeeMessage(requestIdentity, conversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: 'second request' }],
    })).value;
    await conversations.appendEmployeeMessage(requestIdentity, conversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: 'later message' }],
    });

    await expect(conversations.readHistoryThrough({
      organizationId: requestIdentity.organizationId,
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
    })).resolves.toEqual({
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      triggerSequence: 3,
      messages: [first, answer, trigger],
    });

    const otherOrganization = await provisionIdentity();
    await expect(conversations.readHistoryThrough({
      organizationId: otherOrganization.resolveRequest().organizationId,
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
    })).rejects.toBeInstanceOf(MessageNotFoundError);
  });

  it('summarizes one older contiguous span and retains the newest complete Turn and Trigger', async () => {
    const identity = await provisionIdentity();
    const conversations = new PostgresConversationModule(pool);
    const requestIdentity = identity.resolveRequest();
    const conversation = (await conversations.create(requestIdentity, {
      commandId: commandId(randomUUID()),
      title: 'Long history',
    })).value;
    const appendEmployee = async (text: string) => (await conversations.appendEmployeeMessage(
      requestIdentity,
      conversation.id,
      { commandId: commandId(randomUUID()), parts: [{ type: 'text', text }] },
    )).value;
    const appendAssistant = async (text: string) => (await conversations.appendAssistantMessage({
      organizationId: requestIdentity.organizationId,
      conversationId: conversation.id,
      sourceRunId: randomUUID(),
      sourceInvocationId: randomUUID(),
      parts: [{ type: 'text', text }],
    })).value;
    const oldRequest = `old request api_key=super-secret ${'a'.repeat(700)}`;
    const oldAnswer = `old answer ${'b'.repeat(700)}`;
    await appendEmployee(oldRequest);
    await appendAssistant(oldAnswer);
    await appendEmployee(`recent request ${'c'.repeat(300)}`);
    await appendAssistant(`recent answer ${'d'.repeat(300)}`);
    const trigger = await appendEmployee(`trigger ${'e'.repeat(100)}`);
    const models = new SummaryModelGateway();
    const context = new PostgresContextBuilder(pool, conversations, models);
    const request = {
      organizationId: requestIdentity.organizationId,
      principalId: requestIdentity.principalId,
      invocationId: contextInvocationId(randomUUID()),
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      modelBudget: {
        strictestContextWindowTokens: 6_396,
        maximumOutputTokens: 100,
      },
      fixedOverheadTokens: 100,
      summaryExecution: {
        runId: contextRunId(randomUUID()),
        signal: new AbortController().signal,
      },
    };

    const built = await context.build(request);
    expect(models.requests).toHaveLength(1);
    expect(models.requests[0]).toMatchObject({ purpose: 'context_summary' });
    expect(models.requests[0]?.tools).toEqual([]);
    expect(models.requests[0]?.prompt).toContain('old request');
    expect(models.requests[0]?.prompt).not.toContain('super-secret');
    expect(models.requests[0]?.prompt).not.toContain('recent request');
    expect(built.manifest.summarized).toBe(true);
    expect(built.manifest.items.map((item) => [item.sourceKind, item.inclusionMode]))
      .toEqual([
        ['message', 'summary'],
        ['message', 'summary'],
        ['summary', 'summary'],
        ['message', 'verbatim'],
        ['message', 'verbatim'],
        ['message', 'verbatim'],
      ]);
    expect(built.invocationContext.messages).toEqual([
      { role: 'reference', text: summaryText, trustClass: 'reference' },
      { role: 'user', text: `recent request ${'c'.repeat(300)}`, trustClass: 'conversation' },
      { role: 'assistant', text: `recent answer ${'d'.repeat(300)}`, trustClass: 'conversation' },
      { role: 'user', text: `trigger ${'e'.repeat(100)}`, trustClass: 'conversation' },
    ]);

    await expect(context.build(request)).resolves.toEqual(built);
    expect(models.requests).toHaveLength(1);

    const fallbackModels = new SummaryModelGateway('fallback');
    const fallbackContext = new PostgresContextBuilder(pool, conversations, fallbackModels);
    const fallbackBuilt = await fallbackContext.build({
      ...request,
      invocationId: contextInvocationId(randomUUID()),
    });
    expect(fallbackBuilt.invocationContext.messages[0]).toEqual({
      role: 'reference', text: summaryText, trustClass: 'reference',
    });
    expect(JSON.stringify(fallbackBuilt)).not.toContain('discarded private draft');

    const unsafeModels = new SummaryModelGateway('unsafe');
    const unsafeContext = new PostgresContextBuilder(pool, conversations, unsafeModels);
    await expect(unsafeContext.build({
      ...request,
      invocationId: contextInvocationId(randomUUID()),
    })).rejects.toThrow('invalid structure');

    const failingModels = new SummaryModelGateway('failure');
    const failingContext = new PostgresContextBuilder(pool, conversations, failingModels);
    const failure = await failingContext.build({
      ...request,
      invocationId: contextInvocationId(randomUUID()),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ContextBuildFailureError);
    expect(failure).toMatchObject({ retryable: true });
    expect(String(failure)).not.toContain('provider secret');

    await expect(context.build({
      ...request,
      invocationId: contextInvocationId(randomUUID()),
      modelBudget: {
        strictestContextWindowTokens: 4_500,
        maximumOutputTokens: 100,
      },
      fixedOverheadTokens: 250,
    })).rejects.toBeInstanceOf(ContextInputTooLargeError);

    const oversizedSummaryModels = new SummaryModelGateway();
    const oversizedSummaryContext = new PostgresContextBuilder(
      pool,
      conversations,
      oversizedSummaryModels,
    );
    await expect(oversizedSummaryContext.build({
      ...request,
      invocationId: contextInvocationId(randomUUID()),
      modelBudget: {
        strictestContextWindowTokens: 5_196,
        maximumOutputTokens: 100,
      },
    })).rejects.toBeInstanceOf(ContextCompressionRequiredError);
    expect(oversizedSummaryModels.requests).toHaveLength(0);
  });

  it('creates and reuses an immutable short-history Manifest without storing source bodies', async () => {
    const identity = await provisionIdentity();
    const conversations = new PostgresConversationModule(pool);
    const requestIdentity = identity.resolveRequest();
    const conversation = (await conversations.create(requestIdentity, {
      commandId: commandId(randomUUID()),
      title: 'Manifest history',
    })).value;
    await conversations.appendEmployeeMessage(requestIdentity, conversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: 'prepare the report' }],
    });
    await conversations.appendAssistantMessage({
      organizationId: requestIdentity.organizationId,
      conversationId: conversation.id,
      sourceRunId: randomUUID(),
      sourceInvocationId: randomUUID(),
      parts: [{ type: 'text', text: 'what should it cover?' }],
    });
    const trigger = (await conversations.appendEmployeeMessage(requestIdentity, conversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: 'cover the launch decision' }],
    })).value;
    const invocationId = contextInvocationId(randomUUID());
    const context = new PostgresContextBuilder(pool, conversations);

    const buildRequest = {
      organizationId: requestIdentity.organizationId,
      principalId: requestIdentity.principalId,
      invocationId,
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      modelBudget: {
        strictestContextWindowTokens: 65_536,
        maximumOutputTokens: 16_384,
      },
      fixedOverheadTokens: 256,
    };
    const [built, concurrentRecovery] = await Promise.all([
      context.build(buildRequest),
      context.build(buildRequest),
    ]);
    expect(concurrentRecovery).toEqual(built);
    expect(built.invocationContext.messages).toEqual([
      { role: 'user', text: 'prepare the report', trustClass: 'conversation' },
      { role: 'assistant', text: 'what should it cover?', trustClass: 'conversation' },
      { role: 'user', text: 'cover the launch decision', trustClass: 'conversation' },
    ]);
    expect(built.manifest).toMatchObject({
      invocationId,
      triggerMessageId: trigger.id,
      triggerSequence: 3,
      contextPolicyRevision: 'slice4-context-v1',
      itemCount: 3,
      summarized: false,
      estimatedInputTokens: 344,
    });
    expect(built.manifest.items).toHaveLength(3);
    for (const item of built.manifest.items) {
      expect(item).toMatchObject({
        sourceKind: 'message',
        inclusionMode: 'verbatim',
        trustClass: 'conversation',
      });
      expect(item.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(item).not.toHaveProperty('text');
      expect(item).not.toHaveProperty('parts');
    }

    await expect(context.materialize({
      organizationId: requestIdentity.organizationId,
      principalId: requestIdentity.principalId,
      manifestId: built.manifest.id,
    })).resolves.toEqual(built.invocationContext);
  });
});
