import type { OrganizationId } from '@cmaster/identity';
import type { Brand } from '@cmaster/kernel';
import type { Pool } from 'pg';

export type AgentId = Brand<string, 'AgentId'>;
export type AgentRevisionId = Brand<string, 'AgentRevisionId'>;

export interface ResolvedAgentRevision {
  agentId: AgentId;
  agentRevisionId: AgentRevisionId;
  engineKind: 'echo';
  engineVersion: '1';
}

export interface DevelopmentAgentConfig {
  agentId: AgentId;
  agentRevisionId: AgentRevisionId;
  name: string;
}

/**
 * Provisions and resolves the fixed immutable Development Echo Agent Revision.
 * Operations are Organization-scoped and use indexed identity lookups; provisioning is idempotent.
 * Resolution rejects when the configured published Echo Revision is absent or incompatible.
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
}

export class PostgresAgentModule implements AgentModule {
  constructor(
    private readonly pool: Pool,
    private readonly config: DevelopmentAgentConfig,
  ) {}

  async provision(organizationId: OrganizationId): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS agents_active_revision_fk DEFERRED');
      await client.query(
        `INSERT INTO agents (id, organization_id, name, active_revision_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [this.config.agentId, organizationId, this.config.name, this.config.agentRevisionId],
      );
      await client.query(
        `INSERT INTO agent_revisions (
           id, organization_id, agent_id, revision_number,
           engine_kind, engine_version, status
         ) VALUES ($1, $2, $3, 1, 'echo', '1', 'published')
         ON CONFLICT (id) DO NOTHING`,
        [this.config.agentRevisionId, organizationId, this.config.agentId],
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
      `SELECT a.id AS agent_id, r.id AS revision_id, r.engine_kind, r.engine_version
       FROM agents a
       JOIN agent_revisions r
         ON r.organization_id = a.organization_id
        AND r.id = a.active_revision_id
       WHERE a.organization_id = $1 AND a.id = $2`,
      [organizationId, this.config.agentId],
    );
    const row = result.rows[0];
    if (!row || row.engine_kind !== 'echo' || row.engine_version !== '1') {
      throw new Error('Development Echo Agent is not provisioned');
    }
    return {
      agentId: row.agent_id as AgentId,
      agentRevisionId: row.revision_id as AgentRevisionId,
      engineKind: 'echo',
      engineVersion: '1',
    };
  }
}

export function agentId(value: string): AgentId {
  return value as AgentId;
}

export function agentRevisionId(value: string): AgentRevisionId {
  return value as AgentRevisionId;
}
