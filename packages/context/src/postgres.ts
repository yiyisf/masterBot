import { createHash, randomUUID } from 'node:crypto';
import type {
  ConversationId,
  ConversationModule,
  Message,
  MessageId,
} from '@cmaster/conversations';
import type { OrganizationId } from '@cmaster/identity';
import type { Pool, PoolClient } from 'pg';
import {
  ContextCompressionRequiredError,
  ContextInputTooLargeError,
  ContextSourceIntegrityError,
  deriveEffectiveContextInputLimit,
  estimateConservativeUtf8Tokens,
  slice4BaselineContextPolicy,
  type BuildInvocationContext,
  type BuiltInvocationContext,
  type ContextArtifactVersionId,
  type ContextBuilder,
  type ContextInvocationId,
  type ContextManifest,
  type ContextManifestId,
  type ContextManifestItem,
  type ContextPolicy,
  type ContextPolicyRevision,
  type ContextSourceHash,
  type ContextSummaryId,
  type InvocationContext,
  type InvocationContextMessage,
  type MaterializeInvocationContext,
} from './types.js';

interface ManifestRow {
  id: string;
  organization_id: string;
  invocation_id: string;
  conversation_id: string;
  trigger_message_id: string;
  trigger_sequence: number;
  context_policy_revision: string;
  effective_input_tokens: number;
  estimated_input_tokens: number;
  fixed_overhead_tokens: number;
  item_count: number;
  summarized: false;
  created_at: Date;
}

interface ManifestItemRow {
  position: number;
  source_kind: 'message' | 'artifact' | 'summary';
  source_id: string;
  source_sequence: number | null;
  source_hash: string;
  provenance: ContextManifestItem['provenance'];
  trust_class: ContextManifestItem['trustClass'];
  inclusion_mode: ContextManifestItem['inclusionMode'];
}

function sourceHash(message: Message): ContextSourceHash {
  return createHash('sha256')
    .update(JSON.stringify({ author: message.author, parts: message.parts }))
    .digest('hex') as ContextSourceHash;
}

function estimateMessageTokens(message: Message): number {
  return message.parts.reduce(
    (total, part) => total + estimateConservativeUtf8Tokens(part.text),
    8,
  );
}

function mapManifestItem(row: ManifestItemRow): ContextManifestItem {
  const common = { sourceHash: row.source_hash as ContextSourceHash };
  if (row.source_kind === 'message') {
    if (row.source_sequence === null
      || !['employee_message', 'assistant_message'].includes(row.provenance)
      || row.trust_class !== 'conversation' || row.inclusion_mode !== 'verbatim') {
      throw new ContextSourceIntegrityError('Stored Message Context item is invalid');
    }
    return {
      sourceKind: 'message',
      sourceId: row.source_id as MessageId,
      sourceSequence: row.source_sequence,
      sourceHash: row.source_hash as ContextSourceHash,
      provenance: row.provenance as 'employee_message' | 'assistant_message',
      trustClass: 'conversation',
      inclusionMode: 'verbatim',
    };
  }
  if (row.source_kind === 'artifact') {
    if (row.source_sequence !== null || row.provenance !== 'artifact_version'
      || row.trust_class !== 'reference' || row.inclusion_mode !== 'verbatim') {
      throw new ContextSourceIntegrityError('Stored Artifact Context item is invalid');
    }
    return {
      sourceKind: 'artifact',
      ...common,
      sourceId: row.source_id as ContextArtifactVersionId,
      provenance: 'artifact_version',
      trustClass: 'reference',
      inclusionMode: 'verbatim',
    };
  }
  if (row.source_sequence !== null || row.provenance !== 'context_summary'
    || row.trust_class !== 'reference' || row.inclusion_mode !== 'summary') {
    throw new ContextSourceIntegrityError('Stored Summary Context item is invalid');
  }
  return {
    sourceKind: 'summary',
    ...common,
    sourceId: row.source_id as ContextSummaryId,
    provenance: 'context_summary',
    trustClass: 'reference',
    inclusionMode: 'summary',
  };
}

async function loadManifest(
  client: Pool | PoolClient,
  organizationId: OrganizationId,
  selector: { id: ContextManifestId } | { invocationId: ContextInvocationId },
): Promise<ContextManifest | undefined> {
  const byId = 'id' in selector;
  const result = await client.query<ManifestRow>(
    `SELECT * FROM context_manifests
     WHERE organization_id = $1 AND ${byId ? 'id' : 'invocation_id'} = $2`,
    [organizationId, byId ? selector.id : selector.invocationId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const items = await client.query<ManifestItemRow>(
    `SELECT position, source_kind, source_id, source_sequence, source_hash,
            provenance, trust_class, inclusion_mode
     FROM context_manifest_items
     WHERE organization_id = $1 AND manifest_id = $2
     ORDER BY position ASC`,
    [organizationId, row.id],
  );
  return {
    id: row.id as ContextManifestId,
    organizationId: row.organization_id as OrganizationId,
    invocationId: row.invocation_id as ContextInvocationId,
    conversationId: row.conversation_id as ConversationId,
    triggerMessageId: row.trigger_message_id as MessageId,
    triggerSequence: row.trigger_sequence,
    contextPolicyRevision: row.context_policy_revision as ContextPolicyRevision,
    effectiveInputTokens: row.effective_input_tokens,
    estimatedInputTokens: row.estimated_input_tokens,
    fixedOverheadTokens: row.fixed_overhead_tokens,
    itemCount: row.item_count,
    summarized: row.summarized,
    items: items.rows.map(mapManifestItem),
    createdAt: row.created_at,
  };
}

/** PostgreSQL Manifest Adapter; source bodies remain behind owning Module interfaces. */
export class PostgresContextBuilder implements ContextBuilder {
  constructor(
    private readonly pool: Pool,
    private readonly conversations: Pick<ConversationModule, 'readHistoryThrough'>,
    private readonly policy: ContextPolicy = slice4BaselineContextPolicy,
  ) {}

  async build(request: BuildInvocationContext): Promise<BuiltInvocationContext> {
    if (!Number.isSafeInteger(request.fixedOverheadTokens) || request.fixedOverheadTokens < 0) {
      throw new Error('Context fixed overhead must be a non-negative safe integer');
    }
    const client = await this.pool.connect();
    let manifest: ContextManifest;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `context:${request.organizationId}:${request.invocationId}`,
      ]);
      const existing = await loadManifest(client, request.organizationId, {
        invocationId: request.invocationId,
      });
      if (existing) {
        if (existing.conversationId !== request.conversationId
          || existing.triggerMessageId !== request.triggerMessageId
          || existing.contextPolicyRevision !== this.policy.revision) {
          throw new ContextSourceIntegrityError(
            'Invocation is already associated with different Context sources',
          );
        }
        manifest = existing;
      } else {
        const history = await this.conversations.readHistoryThrough({
          organizationId: request.organizationId,
          conversationId: request.conversationId,
          triggerMessageId: request.triggerMessageId,
        });
        const effectiveInputTokens = deriveEffectiveContextInputLimit(
          this.policy,
          request.modelBudget,
        );
        const trigger = history.messages.find(
          (message) => message.id === request.triggerMessageId,
        );
        if (!trigger) throw new ContextSourceIntegrityError('Trigger Message is absent from history');
        const mandatoryInputTokens = request.fixedOverheadTokens + estimateMessageTokens(trigger);
        if (mandatoryInputTokens > effectiveInputTokens) {
          throw new ContextInputTooLargeError('Mandatory Invocation Context exceeds the input limit');
        }
        const estimatedInputTokens = request.fixedOverheadTokens
          + history.messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
        if (estimatedInputTokens > effectiveInputTokens) {
          throw new ContextCompressionRequiredError(
            'Conversation history requires Context compression',
          );
        }

        const manifestId = randomUUID() as ContextManifestId;
        await client.query(
          `INSERT INTO context_manifests (
             id, organization_id, invocation_id, conversation_id, trigger_message_id,
             trigger_sequence, context_policy_revision, effective_input_tokens,
             estimated_input_tokens, fixed_overhead_tokens, item_count
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [manifestId, request.organizationId, request.invocationId, request.conversationId,
            request.triggerMessageId, history.triggerSequence, this.policy.revision,
            effectiveInputTokens, estimatedInputTokens, request.fixedOverheadTokens,
            history.messages.length],
        );
        for (const [position, message] of history.messages.entries()) {
          await client.query(
            `INSERT INTO context_manifest_items (
               manifest_id, organization_id, position, source_kind, source_id,
               source_sequence, source_hash, provenance, trust_class, inclusion_mode
             ) VALUES ($1, $2, $3, 'message', $4, $5, $6, $7, 'conversation', 'verbatim')`,
            [manifestId, request.organizationId, position, message.id, message.sequence,
              sourceHash(message), message.author === 'employee'
                ? 'employee_message' : 'assistant_message'],
          );
        }
        const inserted = await loadManifest(client, request.organizationId, { id: manifestId });
        if (!inserted) throw new Error('Context Manifest was not persisted');
        manifest = inserted;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return {
      manifest,
      invocationContext: await this.materialize({
        organizationId: request.organizationId,
        manifestId: manifest.id,
      }),
    };
  }

  async materialize(request: MaterializeInvocationContext): Promise<InvocationContext> {
    const manifest = await loadManifest(this.pool, request.organizationId, {
      id: request.manifestId,
    });
    if (!manifest) throw new ContextSourceIntegrityError('Context Manifest was not found');
    const history = await this.conversations.readHistoryThrough({
      organizationId: request.organizationId,
      conversationId: manifest.conversationId,
      triggerMessageId: manifest.triggerMessageId,
    });
    const messagesById = new Map(history.messages.map((message) => [message.id, message]));
    const messages: InvocationContextMessage[] = [];
    for (const item of manifest.items) {
      if (item.sourceKind !== 'message') {
        throw new ContextSourceIntegrityError('Context source kind is not materializable in this Slice');
      }
      const message = messagesById.get(item.sourceId);
      if (!message || message.sequence !== item.sourceSequence || sourceHash(message) !== item.sourceHash) {
        throw new ContextSourceIntegrityError('Context source integrity check failed');
      }
      const expectedProvenance = message.author === 'employee'
        ? 'employee_message' : 'assistant_message';
      if (item.provenance !== expectedProvenance) {
        throw new ContextSourceIntegrityError('Context source provenance check failed');
      }
      messages.push({
        role: message.author === 'employee' ? 'user' : 'assistant',
        text: message.parts.map((part) => part.text).join(''),
        trustClass: 'conversation',
      });
    }
    return { manifestId: manifest.id, messages };
  }
}
