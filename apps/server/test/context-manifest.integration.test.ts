import { randomUUID } from 'node:crypto';
import {
  commandId,
  MessageNotFoundError,
  PostgresConversationModule,
} from '@cmaster/conversations';
import { contextInvocationId, PostgresContextBuilder } from '@cmaster/context';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
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
      manifestId: built.manifest.id,
    })).resolves.toEqual(built.invocationContext);
  });
});
