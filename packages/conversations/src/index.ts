import { createHash, randomUUID } from 'node:crypto';
import type { OrganizationId, PrincipalId, RequestIdentity } from '@cmaster/identity';
import type { Brand } from '@cmaster/kernel';
import type { Pool, PoolClient } from 'pg';

export type ConversationId = Brand<string, 'ConversationId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type CommandId = Brand<string, 'CommandId'>;

export interface TextMessagePart {
  type: 'text';
  text: string;
}

export type MessagePart = TextMessagePart;

export interface Conversation {
  id: ConversationId;
  organizationId: OrganizationId;
  createdByPrincipalId: PrincipalId;
  title?: string;
  lastMessageSequence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: MessageId;
  organizationId: OrganizationId;
  conversationId: ConversationId;
  sequence: number;
  author: 'employee' | 'assistant';
  parts: MessagePart[];
  createdAt: Date;
  sourceRunId?: string;
  sourceInvocationId?: string;
}

export interface MessageTrigger {
  messageId: MessageId;
  conversationId: ConversationId;
  organizationId: OrganizationId;
  prompt: string;
}

export interface CommandResult<Value> {
  value: Value;
  replayed: boolean;
}

export class ConversationNotFoundError extends Error {}
export class MessageNotFoundError extends Error {}
export class IdempotencyConflictError extends Error {}

export interface ConversationModule {
  create(
    identity: RequestIdentity,
    command: { commandId: CommandId; title?: string },
  ): Promise<CommandResult<Conversation>>;
  appendEmployeeMessage(
    identity: RequestIdentity,
    conversationId: ConversationId,
    command: { commandId: CommandId; parts: MessagePart[] },
  ): Promise<CommandResult<Message>>;
  appendAssistantMessage(command: {
    organizationId: OrganizationId;
    conversationId: ConversationId;
    sourceRunId: string;
    sourceInvocationId: string;
    parts: MessagePart[];
  }): Promise<CommandResult<Message>>;
  get(identity: RequestIdentity, conversationId: ConversationId): Promise<Conversation>;
  listMessages(
    identity: RequestIdentity,
    conversationId: ConversationId,
    afterSequence: number,
    limit: number,
  ): Promise<Message[]>;
  getMessageTrigger(organizationId: OrganizationId, messageId: MessageId): Promise<MessageTrigger>;
}

interface ConversationRow {
  id: string;
  organization_id: string;
  created_by_principal_id: string;
  title: string | null;
  last_message_sequence: number;
  created_at: Date;
  updated_at: Date;
  request_hash?: string;
}

interface MessageRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  sequence: number;
  author_type: 'employee' | 'assistant';
  parts: unknown;
  created_at: Date;
  source_run_id: string | null;
  source_invocation_id: string | null;
  request_hash?: string;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id as ConversationId,
    organizationId: row.organization_id as OrganizationId,
    createdByPrincipalId: row.created_by_principal_id as PrincipalId,
    ...(row.title === null ? {} : { title: row.title }),
    lastMessageSequence: row.last_message_sequence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageParts(value: unknown): MessagePart[] {
  if (!Array.isArray(value) || value.length !== 1) throw new Error('Stored Message parts are invalid');
  const part = value[0];
  if (!part || typeof part !== 'object' || !('type' in part) || !('text' in part)) {
    throw new Error('Stored Message part is invalid');
  }
  if (part.type !== 'text' || typeof part.text !== 'string') {
    throw new Error('Stored Message part is invalid');
  }
  return [{ type: 'text', text: part.text }];
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id as MessageId,
    organizationId: row.organization_id as OrganizationId,
    conversationId: row.conversation_id as ConversationId,
    sequence: row.sequence,
    author: row.author_type,
    parts: messageParts(row.parts),
    createdAt: row.created_at,
    ...(row.source_run_id === null ? {} : { sourceRunId: row.source_run_id }),
    ...(row.source_invocation_id === null ? {} : { sourceInvocationId: row.source_invocation_id }),
  };
}

async function lockCommand(client: PoolClient, organizationId: string, commandId: string): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`conversation:${organizationId}:${commandId}`],
  );
}

export class PostgresConversationModule implements ConversationModule {
  constructor(private readonly pool: Pool) {}

  async create(
    identity: RequestIdentity,
    command: { commandId: CommandId; title?: string },
  ): Promise<CommandResult<Conversation>> {
    const requestHash = hash({ title: command.title ?? null });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockCommand(client, identity.organizationId, command.commandId);
      const existing = await client.query<ConversationRow>(
        `SELECT * FROM conversations WHERE organization_id = $1 AND idempotency_key = $2`,
        [identity.organizationId, command.commandId],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) throw new IdempotencyConflictError();
        await client.query('COMMIT');
        return { value: mapConversation(previous), replayed: true };
      }

      const id = randomUUID();
      const inserted = await client.query<ConversationRow>(
        `INSERT INTO conversations (
           id, organization_id, created_by_principal_id, title, idempotency_key, request_hash
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [id, identity.organizationId, identity.principalId, command.title ?? null, command.commandId, requestHash],
      );
      await client.query('COMMIT');
      return { value: mapConversation(inserted.rows[0]!), replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async appendEmployeeMessage(
    identity: RequestIdentity,
    conversationId: ConversationId,
    command: { commandId: CommandId; parts: MessagePart[] },
  ): Promise<CommandResult<Message>> {
    const requestHash = hash({ conversationId, parts: command.parts });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockCommand(client, identity.organizationId, command.commandId);
      const existing = await client.query<MessageRow>(
        `SELECT * FROM messages WHERE organization_id = $1 AND idempotency_key = $2`,
        [identity.organizationId, command.commandId],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) throw new IdempotencyConflictError();
        await client.query('COMMIT');
        return { value: mapMessage(previous), replayed: true };
      }

      const conversation = await client.query<ConversationRow>(
        `SELECT * FROM conversations WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [identity.organizationId, conversationId],
      );
      const row = conversation.rows[0];
      if (!row) throw new ConversationNotFoundError();
      const sequence = row.last_message_sequence + 1;
      const inserted = await client.query<MessageRow>(
        `INSERT INTO messages (
           id, organization_id, conversation_id, sequence, author_type,
           author_principal_id, parts, idempotency_key, request_hash
         ) VALUES ($1, $2, $3, $4, 'employee', $5, $6, $7, $8)
         RETURNING *`,
        [randomUUID(), identity.organizationId, conversationId, sequence, identity.principalId,
          JSON.stringify(command.parts), command.commandId, requestHash],
      );
      await client.query(
        `UPDATE conversations
         SET last_message_sequence = $2, updated_at = clock_timestamp()
         WHERE id = $1`,
        [conversationId, sequence],
      );
      await client.query('COMMIT');
      return { value: mapMessage(inserted.rows[0]!), replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async appendAssistantMessage(command: {
    organizationId: OrganizationId;
    conversationId: ConversationId;
    sourceRunId: string;
    sourceInvocationId: string;
    parts: MessagePart[];
  }): Promise<CommandResult<Message>> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`assistant-message:${command.organizationId}:${command.sourceRunId}`],
      );
      const existing = await client.query<MessageRow>(
        `SELECT * FROM messages WHERE organization_id = $1 AND source_run_id = $2`,
        [command.organizationId, command.sourceRunId],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return { value: mapMessage(existing.rows[0]), replayed: true };
      }
      const conversation = await client.query<ConversationRow>(
        `SELECT * FROM conversations WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [command.organizationId, command.conversationId],
      );
      const row = conversation.rows[0];
      if (!row) throw new ConversationNotFoundError();
      const sequence = row.last_message_sequence + 1;
      const inserted = await client.query<MessageRow>(
        `INSERT INTO messages (
           id, organization_id, conversation_id, sequence, author_type, parts,
           source_run_id, source_invocation_id
         ) VALUES ($1, $2, $3, $4, 'assistant', $5, $6, $7)
         RETURNING *`,
        [randomUUID(), command.organizationId, command.conversationId, sequence,
          JSON.stringify(command.parts), command.sourceRunId, command.sourceInvocationId],
      );
      await client.query(
        `UPDATE conversations
         SET last_message_sequence = $2, updated_at = clock_timestamp()
         WHERE id = $1`,
        [command.conversationId, sequence],
      );
      await client.query('COMMIT');
      return { value: mapMessage(inserted.rows[0]!), replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(identity: RequestIdentity, conversationId: ConversationId): Promise<Conversation> {
    const result = await this.pool.query<ConversationRow>(
      `SELECT * FROM conversations WHERE organization_id = $1 AND id = $2`,
      [identity.organizationId, conversationId],
    );
    if (!result.rows[0]) throw new ConversationNotFoundError();
    return mapConversation(result.rows[0]);
  }

  async listMessages(
    identity: RequestIdentity,
    conversationId: ConversationId,
    afterSequence: number,
    limit: number,
  ): Promise<Message[]> {
    await this.get(identity, conversationId);
    const result = await this.pool.query<MessageRow>(
      `SELECT * FROM messages
       WHERE organization_id = $1 AND conversation_id = $2 AND sequence > $3
       ORDER BY sequence ASC LIMIT $4`,
      [identity.organizationId, conversationId, afterSequence, limit],
    );
    return result.rows.map(mapMessage);
  }

  async getMessageTrigger(organizationId: OrganizationId, messageId: MessageId): Promise<MessageTrigger> {
    const result = await this.pool.query<MessageRow>(
      `SELECT * FROM messages
       WHERE organization_id = $1 AND id = $2 AND author_type = 'employee'`,
      [organizationId, messageId],
    );
    const row = result.rows[0];
    if (!row) throw new MessageNotFoundError();
    const parts = messageParts(row.parts);
    return {
      messageId: row.id as MessageId,
      conversationId: row.conversation_id as ConversationId,
      organizationId: row.organization_id as OrganizationId,
      prompt: parts[0]!.text,
    };
  }
}

export function conversationId(value: string): ConversationId {
  return value as ConversationId;
}

export function messageId(value: string): MessageId {
  return value as MessageId;
}

export function commandId(value: string): CommandId {
  return value as CommandId;
}
