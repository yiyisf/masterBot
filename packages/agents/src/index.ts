import type { ContextPolicyRevision } from '@cmaster/context';
import type { OrganizationId } from '@cmaster/identity';
import type { Brand } from '@cmaster/kernel';
import type { Pool, PoolClient } from 'pg';

export type AgentId = Brand<string, 'AgentId'>;
export type AgentRevisionId = Brand<string, 'AgentRevisionId'>;

export type ResolvedAgentRevision =
  | {
    agentId: AgentId;
    agentRevisionId: AgentRevisionId;
    engineKind: 'echo';
    engineVersion: '1';
  }
  | {
    agentId: AgentId;
    agentRevisionId: AgentRevisionId;
    engineKind: 'ai-sdk';
    engineVersion: '1';
    modelRequirement: { streamingText: true; toolCalling?: true };
    contextPolicyRevision?: ContextPolicyRevision;
  };

export interface DevelopmentAgentConfig {
  agentId: AgentId;
  echoRevisionId: AgentRevisionId;
  aiSdkRevisionId?: AgentRevisionId;
  toolRevisionId?: AgentRevisionId;
  contextArtifactRevisionId?: AgentRevisionId;
  contextPolicyRevision?: ContextPolicyRevision;
  activeRevisionId: AgentRevisionId;
  name: string;
}

/**
 * Provisions and resolves immutable Development Agent Revisions.
 * Operations are Organization-scoped and use indexed identity lookups; provisioning is idempotent.
 * Resolution rejects when the configured active Revision is absent or incompatible.
 */
export interface AgentModule {
  provision(organizationId: OrganizationId): Promise<void>;
  resolveDefault(organizationId: OrganizationId): Promise<ResolvedAgentRevision>;
}

interface RevisionRow {
  agent_id: string;
  revision_id: string;
  engine_kind: string;
  engine_version: string;
  model_requirement: { streamingText?: unknown; toolCalling?: unknown } | null;
  context_policy_revision: string | null;
}

interface GovernedRevisionConfiguration {
  revisionId: AgentRevisionId;
  revisionNumber: 3 | 4;
  contextPolicyRevision: ContextPolicyRevision | null;
  description: 'Tool-enabled' | 'Context-enabled';
}

async function provisionGovernedRevision(
  client: PoolClient,
  organizationId: OrganizationId,
  agentIdValue: AgentId,
  configuration: GovernedRevisionConfiguration,
): Promise<void> {
  await client.query(
    `INSERT INTO agent_revisions (
       id, organization_id, agent_id, revision_number,
       engine_kind, engine_version, status, model_requirement, context_policy_revision
     ) VALUES ($1, $2, $3, $4, 'ai-sdk', '1', 'published', $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [configuration.revisionId, organizationId, agentIdValue, configuration.revisionNumber,
      JSON.stringify({ streamingText: true, toolCalling: true }),
      configuration.contextPolicyRevision],
  );
  const stored = await client.query<RevisionRow>(
    `SELECT r.id AS revision_id, r.engine_kind, r.engine_version,
            r.model_requirement, r.context_policy_revision
     FROM agent_revisions r
     WHERE r.organization_id = $1 AND r.agent_id = $2
       AND r.id = $3 AND r.revision_number = $4 AND r.status = 'published'`,
    [organizationId, agentIdValue, configuration.revisionId, configuration.revisionNumber],
  );
  const revision = stored.rows[0];
  if (revision?.engine_kind !== 'ai-sdk' || revision.engine_version !== '1'
    || revision.model_requirement?.streamingText !== true
    || revision.model_requirement.toolCalling !== true
    || revision.context_policy_revision !== configuration.contextPolicyRevision) {
    throw new Error(`${configuration.description} Agent Revision ${configuration.revisionId} conflicts with immutable configuration`);
  }
}

export class PostgresAgentModule implements AgentModule {
  constructor(
    private readonly pool: Pool,
    private readonly config: DevelopmentAgentConfig,
  ) {}

  async provision(organizationId: OrganizationId): Promise<void> {
    const hasContextRevision = this.config.contextArtifactRevisionId !== undefined;
    const hasContextPolicy = this.config.contextPolicyRevision !== undefined;
    if (hasContextRevision !== hasContextPolicy) {
      throw new Error('Context-enabled Agent Revision and Context Policy must be configured together');
    }
    const configuredRevisionIds = [
      this.config.echoRevisionId,
      this.config.aiSdkRevisionId,
      this.config.toolRevisionId,
      this.config.contextArtifactRevisionId,
    ];
    if (!configuredRevisionIds.includes(this.config.activeRevisionId)) {
      throw new Error('Active Development Agent Revision must be provisioned');
    }
    const activeRevisionId = this.config.activeRevisionId;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS agents_active_revision_fk DEFERRED');
      await client.query(
        `INSERT INTO agents (id, organization_id, name, active_revision_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [this.config.agentId, organizationId, this.config.name, activeRevisionId],
      );
      await client.query(
        `INSERT INTO agent_revisions (
           id, organization_id, agent_id, revision_number,
           engine_kind, engine_version, status, model_requirement
         ) VALUES ($1, $2, $3, 1, 'echo', '1', 'published', NULL)
         ON CONFLICT (id) DO NOTHING`,
        [this.config.echoRevisionId, organizationId, this.config.agentId],
      );
      if (this.config.aiSdkRevisionId) {
        await client.query(
          `INSERT INTO agent_revisions (
             id, organization_id, agent_id, revision_number,
             engine_kind, engine_version, status, model_requirement
           ) VALUES ($1, $2, $3, 2, 'ai-sdk', '1', 'published', $4)
           ON CONFLICT (id) DO NOTHING`,
          [this.config.aiSdkRevisionId, organizationId, this.config.agentId,
            JSON.stringify({ streamingText: true })],
        );
      }
      if (this.config.toolRevisionId) {
        await provisionGovernedRevision(client, organizationId, this.config.agentId, {
          revisionId: this.config.toolRevisionId,
          revisionNumber: 3,
          contextPolicyRevision: null,
          description: 'Tool-enabled',
        });
      }
      if (this.config.contextArtifactRevisionId && this.config.contextPolicyRevision) {
        await provisionGovernedRevision(client, organizationId, this.config.agentId, {
          revisionId: this.config.contextArtifactRevisionId,
          revisionNumber: 4,
          contextPolicyRevision: this.config.contextPolicyRevision,
          description: 'Context-enabled',
        });
      }
      // 临时开发激活策略：Feature Flag 选择不可变 Revision；正式发布/回滚流程留待 Agent Admin Slice。
      await client.query(
        `UPDATE agents SET active_revision_id = $3
         WHERE organization_id = $1 AND id = $2`,
        [organizationId, this.config.agentId, activeRevisionId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveDefault(organizationId: OrganizationId): Promise<ResolvedAgentRevision> {
    const result = await this.pool.query<RevisionRow>(
      `SELECT a.id AS agent_id, r.id AS revision_id, r.engine_kind,
              r.engine_version, r.model_requirement, r.context_policy_revision
       FROM agents a
       JOIN agent_revisions r
         ON r.organization_id = a.organization_id
        AND r.id = a.active_revision_id
       WHERE a.organization_id = $1 AND a.id = $2`,
      [organizationId, this.config.agentId],
    );
    const row = result.rows[0];
    if (!row || row.engine_version !== '1') {
      throw new Error('Development Agent is not provisioned');
    }
    if (row.engine_kind === 'echo') {
      return {
        agentId: row.agent_id as AgentId,
        agentRevisionId: row.revision_id as AgentRevisionId,
        engineKind: 'echo',
        engineVersion: '1',
      };
    }
    if (row.engine_kind === 'ai-sdk' && row.model_requirement?.streamingText === true) {
      return {
        agentId: row.agent_id as AgentId,
        agentRevisionId: row.revision_id as AgentRevisionId,
        engineKind: 'ai-sdk',
        engineVersion: '1',
        modelRequirement: {
          streamingText: true,
          ...(row.model_requirement.toolCalling === true ? { toolCalling: true as const } : {}),
        },
        ...(row.context_policy_revision === null
          ? {}
          : { contextPolicyRevision: row.context_policy_revision as ContextPolicyRevision }),
      };
    }
    throw new Error('Development Agent Revision is incompatible');
  }
}

export function agentId(value: string): AgentId {
  return value as AgentId;
}

export function agentRevisionId(value: string): AgentRevisionId {
  return value as AgentRevisionId;
}
