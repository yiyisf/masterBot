import { createHash, randomUUID } from 'node:crypto';
import type { ArtifactReference } from '@cmaster/artifacts';
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

export interface ArtifactReferenceMessagePart extends ArtifactReference {
  type: 'artifact_reference';
  text?: never;
}

export type MessagePart = TextMessagePart | ArtifactReferenceMessagePart;

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

/** Immutable ordered history bounded by the verified Employee Trigger Message. */
export interface ConversationHistory {
  readonly conversationId: ConversationId;
  readonly triggerMessageId: MessageId;
  readonly triggerSequence: number;
  readonly messages: readonly Message[];
}

/** Trusted, Organization-scoped Context read; missing or mismatched Trigger throws. */
export interface ReadConversationHistory {
  readonly organizationId: OrganizationId;
  readonly principalId: PrincipalId;
  readonly conversationId: ConversationId;
  readonly triggerMessageId: MessageId;
}

export type ConversationPreview =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'artifact' }
  | { readonly kind: 'empty' };

export interface ConversationSummary {
  readonly id: ConversationId;
  readonly title?: string;
  readonly preview: ConversationPreview;
  readonly updatedAt: Date;
}

export interface ConversationPage {
  readonly items: readonly ConversationSummary[];
  readonly nextCursor?: string;
}

export interface MessagePage {
  readonly items: readonly Message[];
  /** Pass this exclusive sequence cursor to retrieve the preceding page. */
  readonly beforeSequence?: number;
}

export interface CommandResult<Value> {
  value: Value;
  replayed: boolean;
}

export class ConversationNotFoundError extends Error {}
export class MessageNotFoundError extends Error {}
export class IdempotencyConflictError extends Error {}
export class InvalidConversationCursorError extends Error {}
export class InvalidConversationTitleError extends Error {}

/**
 * Owns immutable, Organization-scoped Conversations and ordered Messages.
 * Creation, rename, and Employee append commands are idempotent; key reuse with another payload
 * throws IdempotencyConflictError. Missing, cross-Organization, and cross-Principal resources throw
 * the same corresponding not-found error. Appends serialize on the Conversation and assign a
 * strictly increasing sequence. Recent listing uses a stable opaque `(updatedAt, conversationId)`
 * cursor. Message pages load either the latest bounded suffix or an exclusive `beforeSequence`
 * window, remain ascending, and are linear in the requested limit.
 * Controlled history reads verify the Employee Trigger in the same Organization/Conversation and
 * return ascending immutable Messages only through its sequence; selection and budgeting stay in Context.
 */
export interface ConversationModule {
  create(
    identity: RequestIdentity,
    command: { commandId: CommandId; title?: string },
  ): Promise<CommandResult<Conversation>>;
  appendEmployeeMessage(
    identity: RequestIdentity,
    conversationId: ConversationId,
    command: { commandId: CommandId; parts: TextMessagePart[] },
  ): Promise<CommandResult<Message>>;
  rename(
    identity: RequestIdentity,
    conversationId: ConversationId,
    command: { commandId: CommandId; title: string },
  ): Promise<CommandResult<Conversation>>;
  appendAssistantMessage(command: {
    organizationId: OrganizationId;
    conversationId: ConversationId;
    sourceRunId: string;
    sourceInvocationId: string;
    parts: MessagePart[];
  }): Promise<CommandResult<Message>>;
  get(identity: RequestIdentity, conversationId: ConversationId): Promise<Conversation>;
  getCreatedByCommand(identity: RequestIdentity, commandId: CommandId): Promise<Conversation>;
  getRenamedByCommand(
    identity: RequestIdentity,
    conversationId: ConversationId,
    commandId: CommandId,
  ): Promise<Conversation>;
  getEmployeeMessageByCommand(identity: RequestIdentity, commandId: CommandId): Promise<Message>;
  list(
    identity: RequestIdentity,
    query: { readonly cursor?: string; readonly limit: number },
  ): Promise<ConversationPage>;
  count(identity: RequestIdentity): Promise<number>;
  listMessages(
    identity: RequestIdentity,
    conversationId: ConversationId,
    afterSequence: number,
    limit: number,
  ): Promise<Message[]>;
  listMessagePage(
    identity: RequestIdentity,
    conversationId: ConversationId,
    query: { readonly beforeSequence?: number; readonly limit: number },
  ): Promise<MessagePage>;
  readHistoryThrough(query: ReadConversationHistory): Promise<ConversationHistory>;
  getMessageTrigger(
    identity: Pick<RequestIdentity, 'organizationId' | 'principalId'>,
    messageId: MessageId,
  ): Promise<MessageTrigger>;
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

interface RenameReceiptRow extends ConversationRow {
  rename_request_hash: string;
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

const initialTitleCodeUnits = 80;
const previewCodeUnits = 160;
const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

function normalizeVisibleText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function boundUnicode(value: string, maximumCodeUnits: number): string {
  let bounded = '';
  for (const { segment } of graphemeSegmenter.segment(value)) {
    if (bounded.length + segment.length > maximumCodeUnits) break;
    bounded += segment;
  }
  return bounded;
}

function initialTitle(text: string): string {
  return boundUnicode(normalizeVisibleText(text), initialTitleCodeUnits);
}

function previewFromParts(parts: readonly MessagePart[]): ConversationPreview {
  const text = normalizeVisibleText(parts
    .filter((part): part is TextMessagePart => part.type === 'text')
    .map((part) => part.text)
    .join(' '));
  if (text) return { kind: 'text', text: boundUnicode(text, previewCodeUnits) };
  if (parts.some((part) => part.type === 'artifact_reference')) return { kind: 'artifact' };
  return { kind: 'empty' };
}

interface ConversationCursor {
  readonly updatedAt: string;
  readonly id: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function encodeCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string): ConversationCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object'
      || !('updatedAt' in parsed) || typeof parsed.updatedAt !== 'string'
      || !('id' in parsed) || typeof parsed.id !== 'string'
      || !uuidPattern.test(parsed.id)
      || Number.isNaN(Date.parse(parsed.updatedAt))) throw new InvalidConversationCursorError();
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch (error) {
    if (error instanceof InvalidConversationCursorError) throw error;
    throw new InvalidConversationCursorError();
  }
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
  if (!Array.isArray(value) || value.length === 0) throw new Error('Stored Message parts are invalid');
  return value.map((part): MessagePart => {
    if (!part || typeof part !== 'object' || !('type' in part)) {
      throw new Error('Stored Message part is invalid');
    }
    if (part.type === 'text' && 'text' in part && typeof part.text === 'string') {
      return { type: 'text', text: part.text };
    }
    if (part.type === 'artifact_reference'
      && 'artifactId' in part && typeof part.artifactId === 'string'
      && 'artifactVersionId' in part && typeof part.artifactVersionId === 'string') {
      return {
        type: 'artifact_reference',
        artifactId: part.artifactId as ArtifactReference['artifactId'],
        artifactVersionId: part.artifactVersionId as ArtifactReference['artifactVersionId'],
      };
    }
    throw new Error('Stored Message part is invalid');
  });
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
        if (previous.created_by_principal_id !== identity.principalId) {
          throw new ConversationNotFoundError();
        }
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
    command: { commandId: CommandId; parts: TextMessagePart[] },
  ): Promise<CommandResult<Message>> {
    if (command.parts.length !== 1 || command.parts[0]?.type !== 'text') {
      throw new Error('Employee Message must contain exactly one Text Part');
    }
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
        const ownedConversation = await client.query(
          `SELECT 1 FROM conversations
           WHERE organization_id = $1 AND id = $2 AND created_by_principal_id = $3`,
          [identity.organizationId, previous.conversation_id, identity.principalId],
        );
        if (ownedConversation.rowCount !== 1) throw new ConversationNotFoundError();
        if (previous.request_hash !== requestHash) throw new IdempotencyConflictError();
        await client.query('COMMIT');
        return { value: mapMessage(previous), replayed: true };
      }

      const conversation = await client.query<ConversationRow>(
        `SELECT * FROM conversations
         WHERE organization_id = $1 AND id = $2 AND created_by_principal_id = $3
         FOR UPDATE`,
        [identity.organizationId, conversationId, identity.principalId],
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
         SET last_message_sequence = $2,
             title = CASE WHEN $2 = 1 AND title IS NULL THEN $3 ELSE title END,
             updated_at = clock_timestamp()
         WHERE id = $1`,
        [conversationId, sequence, initialTitle(command.parts[0].text)],
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

  async rename(
    identity: RequestIdentity,
    conversationId: ConversationId,
    command: { commandId: CommandId; title: string },
  ): Promise<CommandResult<Conversation>> {
    const title = command.title.trim();
    if (!title || title.length > 200) throw new InvalidConversationTitleError();
    const requestHash = hash({ conversationId, title });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockCommand(client, identity.organizationId, command.commandId);
      const existing = await client.query<RenameReceiptRow>(
        `SELECT c.*, r.request_hash AS rename_request_hash
         FROM conversation_rename_receipts r
         JOIN conversations c
           ON c.organization_id = r.organization_id AND c.id = r.conversation_id
         WHERE r.organization_id = $1 AND r.command_id = $2`,
        [identity.organizationId, command.commandId],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.created_by_principal_id !== identity.principalId) {
          throw new ConversationNotFoundError();
        }
        if (previous.rename_request_hash !== requestHash) throw new IdempotencyConflictError();
        await client.query('COMMIT');
        return { value: mapConversation(previous), replayed: true };
      }

      const renamed = await client.query<ConversationRow>(
        `UPDATE conversations
         SET title = $4, updated_at = clock_timestamp()
         WHERE organization_id = $1 AND id = $2 AND created_by_principal_id = $3
         RETURNING *`,
        [identity.organizationId, conversationId, identity.principalId, title],
      );
      const value = renamed.rows[0];
      if (!value) throw new ConversationNotFoundError();
      await client.query(
        `INSERT INTO conversation_rename_receipts (
           organization_id, command_id, conversation_id, request_hash
         ) VALUES ($1, $2, $3, $4)`,
        [identity.organizationId, command.commandId, conversationId, requestHash],
      );
      await client.query('COMMIT');
      return { value: mapConversation(value), replayed: false };
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
      `SELECT * FROM conversations
       WHERE organization_id = $1 AND id = $2 AND created_by_principal_id = $3`,
      [identity.organizationId, conversationId, identity.principalId],
    );
    if (!result.rows[0]) throw new ConversationNotFoundError();
    return mapConversation(result.rows[0]);
  }

  async getCreatedByCommand(
    identity: RequestIdentity,
    commandId: CommandId,
  ): Promise<Conversation> {
    const result = await this.pool.query<ConversationRow>(
      `SELECT * FROM conversations
       WHERE organization_id = $1 AND created_by_principal_id = $2 AND idempotency_key = $3`,
      [identity.organizationId, identity.principalId, commandId],
    );
    if (!result.rows[0]) throw new ConversationNotFoundError();
    return mapConversation(result.rows[0]);
  }

  async getRenamedByCommand(
    identity: RequestIdentity,
    conversationId: ConversationId,
    commandId: CommandId,
  ): Promise<Conversation> {
    const result = await this.pool.query<ConversationRow>(
      `SELECT c.* FROM conversation_rename_receipts r
       JOIN conversations c
         ON c.organization_id = r.organization_id AND c.id = r.conversation_id
       WHERE r.organization_id = $1 AND r.conversation_id = $2 AND r.command_id = $3
         AND c.created_by_principal_id = $4`,
      [identity.organizationId, conversationId, commandId, identity.principalId],
    );
    if (!result.rows[0]) throw new ConversationNotFoundError();
    return mapConversation(result.rows[0]);
  }

  async getEmployeeMessageByCommand(
    identity: RequestIdentity,
    commandId: CommandId,
  ): Promise<Message> {
    const result = await this.pool.query<MessageRow>(
      `SELECT m.* FROM messages m
       JOIN conversations c
         ON c.organization_id = m.organization_id AND c.id = m.conversation_id
       WHERE m.organization_id = $1 AND c.created_by_principal_id = $2
         AND m.idempotency_key = $3 AND m.author_type = 'employee'`,
      [identity.organizationId, identity.principalId, commandId],
    );
    if (!result.rows[0]) throw new MessageNotFoundError();
    return mapMessage(result.rows[0]);
  }

  async list(
    identity: RequestIdentity,
    query: { readonly cursor?: string; readonly limit: number },
  ): Promise<ConversationPage> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50) {
      throw new InvalidConversationCursorError();
    }
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const result = await this.pool.query<ConversationRow & { last_message_parts: unknown | null }>(
      `SELECT c.*, last_message.parts AS last_message_parts
       FROM conversations c
       LEFT JOIN LATERAL (
         SELECT parts FROM messages
         WHERE organization_id = c.organization_id AND conversation_id = c.id
         ORDER BY sequence DESC LIMIT 1
       ) last_message ON true
       WHERE c.organization_id = $1 AND c.created_by_principal_id = $2
         AND ($3::timestamptz IS NULL OR (c.updated_at, c.id) < ($3::timestamptz, $4::uuid))
       ORDER BY c.updated_at DESC, c.id DESC LIMIT $5`,
      [identity.organizationId, identity.principalId, cursor?.updatedAt ?? null,
        cursor?.id ?? null, query.limit + 1],
    );
    const pageRows = result.rows.slice(0, query.limit);
    const items = pageRows.map((row): ConversationSummary => ({
      id: row.id as ConversationId,
      ...(row.title === null ? {} : { title: row.title }),
      preview: row.last_message_parts === null
        ? { kind: 'empty' }
        : previewFromParts(messageParts(row.last_message_parts)),
      updatedAt: row.updated_at,
    }));
    const last = pageRows.at(-1);
    return {
      items,
      ...(result.rows.length > query.limit && last
        ? { nextCursor: encodeCursor({ updatedAt: last.updated_at.toISOString(), id: last.id }) }
        : {}),
    };
  }

  async count(identity: RequestIdentity): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM conversations
       WHERE organization_id = $1 AND created_by_principal_id = $2`,
      [identity.organizationId, identity.principalId],
    );
    return Number(result.rows[0]?.count ?? 0);
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

  async listMessagePage(
    identity: RequestIdentity,
    conversationId: ConversationId,
    query: { readonly beforeSequence?: number; readonly limit: number },
  ): Promise<MessagePage> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200
      || (query.beforeSequence !== undefined
        && (!Number.isInteger(query.beforeSequence) || query.beforeSequence < 1))) {
      throw new InvalidConversationCursorError();
    }
    await this.get(identity, conversationId);
    const result = await this.pool.query<MessageRow>(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE organization_id = $1 AND conversation_id = $2
           AND ($3::integer IS NULL OR sequence < $3)
         ORDER BY sequence DESC LIMIT $4
       ) recent_messages
       ORDER BY sequence ASC`,
      [identity.organizationId, conversationId, query.beforeSequence ?? null, query.limit + 1],
    );
    const hasEarlier = result.rows.length > query.limit;
    const pageRows = hasEarlier ? result.rows.slice(1) : result.rows;
    return {
      items: pageRows.map(mapMessage),
      ...(hasEarlier && pageRows[0] ? { beforeSequence: pageRows[0].sequence } : {}),
    };
  }

  async readHistoryThrough(query: ReadConversationHistory): Promise<ConversationHistory> {
    const triggerResult = await this.pool.query<MessageRow>(
      `SELECT m.* FROM messages m
       JOIN conversations c
         ON c.organization_id = m.organization_id AND c.id = m.conversation_id
       WHERE m.organization_id = $1 AND m.conversation_id = $2 AND m.id = $3
         AND m.author_type = 'employee' AND c.created_by_principal_id = $4`,
      [query.organizationId, query.conversationId, query.triggerMessageId, query.principalId],
    );
    const trigger = triggerResult.rows[0];
    if (!trigger) throw new MessageNotFoundError();
    const history = await this.pool.query<MessageRow>(
      `SELECT * FROM messages
       WHERE organization_id = $1 AND conversation_id = $2 AND sequence <= $3
       ORDER BY sequence ASC`,
      [query.organizationId, query.conversationId, trigger.sequence],
    );
    return {
      conversationId: query.conversationId,
      triggerMessageId: query.triggerMessageId,
      triggerSequence: trigger.sequence,
      messages: history.rows.map(mapMessage),
    };
  }

  async getMessageTrigger(
    identity: Pick<RequestIdentity, 'organizationId' | 'principalId'>,
    messageId: MessageId,
  ): Promise<MessageTrigger> {
    const result = await this.pool.query<MessageRow>(
      `SELECT m.* FROM messages m
       JOIN conversations c
         ON c.organization_id = m.organization_id AND c.id = m.conversation_id
       WHERE m.organization_id = $1 AND m.id = $2 AND m.author_type = 'employee'
         AND c.created_by_principal_id = $3`,
      [identity.organizationId, messageId, identity.principalId],
    );
    const row = result.rows[0];
    if (!row) throw new MessageNotFoundError();
    const parts = messageParts(row.parts);
    const firstPart = parts[0];
    if (!firstPart || firstPart.type !== 'text') {
      throw new Error('Employee Message Text Part is unavailable');
    }
    return {
      messageId: row.id as MessageId,
      conversationId: row.conversation_id as ConversationId,
      organizationId: row.organization_id as OrganizationId,
      prompt: firstPart.text,
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
