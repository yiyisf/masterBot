import { randomUUID } from 'node:crypto';
import {
  commandId,
  conversationId,
  ConversationNotFoundError,
  messageId,
  MessageNotFoundError,
  PostgresConversationModule,
} from '@cmaster/conversations';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });
const organization = organizationId(randomUUID());
const creator = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Workspace privacy test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Creator',
});
const colleague = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Workspace privacy test',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Colleague',
});
const conversations = new PostgresConversationModule(pool);

beforeAll(async () => {
  await creator.provision();
  await colleague.provision();
});
afterAll(async () => pool.end());

describe('creator-private Conversation queries', () => {
  it('initializes one deterministic Unicode-safe title and derives a bounded preview', async () => {
    const created = await conversations.create(creator.resolveRequest(), { commandId: commandId(randomUUID()) });
    const text = `  Plan   🚀  ${'x'.repeat(220)}  `;
    const message = await conversations.appendEmployeeMessage(
      creator.resolveRequest(), created.value.id,
      { commandId: commandId(randomUUID()), parts: [{ type: 'text', text }] },
    );
    await conversations.appendEmployeeMessage(
      creator.resolveRequest(), created.value.id,
      { commandId: commandId(randomUUID()), parts: [{ type: 'text', text: 'Second message' }] },
    );

    const page = await conversations.list(creator.resolveRequest(), { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: created.value.id,
      title: expect.stringMatching(/^Plan 🚀/),
      preview: { kind: 'text', text: 'Second message' },
    });
    expect((page.items[0]?.title ?? '').length).toBeLessThanOrEqual(80);
    expect((await conversations.get(creator.resolveRequest(), created.value.id)).title)
      .toBe(page.items[0]?.title);
    expect(message.value.id).toBeDefined();

    const emojiConversation = await conversations.create(creator.resolveRequest(), {
      commandId: commandId(randomUUID()),
    });
    await conversations.appendEmployeeMessage(
      creator.resolveRequest(), emojiConversation.value.id,
      { commandId: commandId(randomUUID()), parts: [{ type: 'text', text: '🚀'.repeat(200) }] },
    );
    const emojiPage = await conversations.list(creator.resolveRequest(), { limit: 1 });
    expect(emojiPage.items[0]?.preview).toEqual({ kind: 'text', text: '🚀'.repeat(80) });
  });

  it('uses stable opaque pagination and excludes a colleague’s Conversations', async () => {
    await conversations.create(creator.resolveRequest(), {
      commandId: commandId(randomUUID()), title: 'Creator first',
    });
    await conversations.create(creator.resolveRequest(), {
      commandId: commandId(randomUUID()), title: 'Creator second',
    });
    const colleagueConversation = await conversations.create(colleague.resolveRequest(), {
      commandId: commandId(randomUUID()), title: 'Colleague only',
    });
    const first = await conversations.list(creator.resolveRequest(), { limit: 1 });
    expect(first.nextCursor).toEqual(expect.any(String));
    if (!first.nextCursor) throw new Error('Expected another creator-owned Conversation page');
    expect(first.nextCursor).not.toContain(first.items[0]?.id ?? '');
    const second = await conversations.list(creator.resolveRequest(), {
      limit: 1, cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.id)).not.toContain(colleagueConversation.value.id);
  });

  it('makes cross-Principal and unknown Conversation reads indistinguishable', async () => {
    const created = await conversations.create(creator.resolveRequest(), { commandId: commandId(randomUUID()) });
    const appended = await conversations.appendEmployeeMessage(
      creator.resolveRequest(), created.value.id,
      { commandId: commandId(randomUUID()), parts: [{ type: 'text', text: 'Private request' }] },
    );

    await expect(conversations.get(colleague.resolveRequest(), created.value.id))
      .rejects.toBeInstanceOf(ConversationNotFoundError);
    await expect(conversations.get(colleague.resolveRequest(), conversationId(randomUUID())))
      .rejects.toBeInstanceOf(ConversationNotFoundError);
    await expect(conversations.listMessages(colleague.resolveRequest(), created.value.id, 0, 50))
      .rejects.toBeInstanceOf(ConversationNotFoundError);
    await expect(conversations.getMessageTrigger(colleague.resolveRequest(), appended.value.id))
      .rejects.toBeInstanceOf(MessageNotFoundError);
    await expect(conversations.getMessageTrigger(colleague.resolveRequest(), messageId(randomUUID())))
      .rejects.toBeInstanceOf(MessageNotFoundError);
  });
});
