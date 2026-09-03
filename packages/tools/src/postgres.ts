import { createHash } from 'node:crypto';
import type { OrganizationId } from '@cmaster/identity';
import type { Pool } from 'pg';
import {
  type ListGrantedTools,
  type ToolCatalog,
  type ToolCatalogProvisioning,
  type ToolDescriptor,
  type ToolEffect,
  ToolProvisioningConflictError,
  type ToolRecovery,
  ToolRevisionNotFoundError,
  type ToolRevisionId,
  type ToolRisk,
} from './types.js';

interface ToolRevisionRow {
  id: string;
  organization_id: string;
  capability_id: string;
  name: string;
  description: string;
  input_schema: Readonly<Record<string, unknown>>;
  output_schema: Readonly<Record<string, unknown>>;
  effect: ToolEffect;
  recovery: ToolRecovery;
  risks: ToolRisk[];
  provider_key: string;
  status: 'active';
  config_hash: string;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function mapDescriptor(row: ToolRevisionRow): ToolDescriptor {
  return {
    revisionId: row.id as ToolRevisionId,
    capabilityId: row.capability_id,
    name: row.name,
    description: row.description,
    inputSchema: row.input_schema,
    outputSchema: row.output_schema,
    effect: row.effect,
    recovery: row.recovery,
    risks: row.risks,
  };
}

export class PostgresToolCatalog implements ToolCatalog {
  constructor(private readonly pool: Pool) {}

  async provision(
    organizationId: OrganizationId,
    input: ToolCatalogProvisioning,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const revision of input.revisions) {
        const configHash = digest(revision);
        await client.query(
          `INSERT INTO tool_capabilities (organization_id, id)
           VALUES ($1, $2) ON CONFLICT (organization_id, id) DO NOTHING`,
          [organizationId, revision.capabilityId],
        );
        await client.query(
          `INSERT INTO tool_revisions (
             id, organization_id, capability_id, name, description,
             input_schema, output_schema, effect, recovery, risks, provider_key, config_hash
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO NOTHING`,
          [revision.id, organizationId, revision.capabilityId,
            revision.name, revision.description, JSON.stringify(revision.inputSchema),
            JSON.stringify(revision.outputSchema), revision.effect, revision.recovery,
            JSON.stringify(revision.risks), revision.providerKey, configHash],
        );
        const stored = await client.query<{ config_hash: string }>(
          `SELECT config_hash FROM tool_revisions
           WHERE organization_id = $1 AND id = $2`,
          [organizationId, revision.id],
        );
        if (stored.rows[0]?.config_hash !== configHash) {
          throw new ToolProvisioningConflictError(`Tool Revision ${revision.id} is immutable`);
        }
      }
      for (const grant of input.grants) {
        const normalizedCapabilityIds = [...grant.capabilityIds].sort();
        const configHash = digest(normalizedCapabilityIds);
        await client.query(
          `INSERT INTO tool_grants (
             id, organization_id, capability_ids, config_hash
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO NOTHING`,
          [grant.id, organizationId, JSON.stringify(normalizedCapabilityIds), configHash],
        );
        const stored = await client.query<{ config_hash: string }>(
          `SELECT config_hash FROM tool_grants
           WHERE organization_id = $1 AND id = $2`,
          [organizationId, grant.id],
        );
        if (stored.rows[0]?.config_hash !== configHash) {
          throw new ToolProvisioningConflictError(`Tool Grant ${grant.id} is immutable`);
        }
        await client.query(
          `INSERT INTO agent_tool_grants (organization_id, agent_revision_id, grant_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (organization_id, agent_revision_id) DO NOTHING`,
          [organizationId, grant.agentRevisionId, grant.id],
        );
        const binding = await client.query<{ grant_id: string }>(
          `SELECT grant_id FROM agent_tool_grants
           WHERE organization_id = $1 AND agent_revision_id = $2`,
          [organizationId, grant.agentRevisionId],
        );
        if (binding.rows[0]?.grant_id !== grant.id) {
          throw new ToolProvisioningConflictError(
            `Agent Revision ${grant.agentRevisionId} Tool Grant is immutable`,
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deactivate(
    organizationId: OrganizationId,
    revisionId: ToolRevisionId,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE tool_revisions SET status = 'inactive'
       WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
      [organizationId, revisionId],
    );
    if (result.rowCount !== 1) throw new ToolRevisionNotFoundError();
  }

  async list(query: ListGrantedTools): Promise<ToolDescriptor[]> {
    const result = await this.pool.query<ToolRevisionRow>(
      `SELECT r.*
       FROM agent_tool_grants b
       JOIN tool_grants g
         ON g.organization_id = b.organization_id AND g.id = b.grant_id
       CROSS JOIN LATERAL jsonb_array_elements_text(g.capability_ids) granted(capability_id)
       JOIN tool_revisions r
         ON r.organization_id = g.organization_id
        AND r.capability_id = granted.capability_id
        AND r.status = 'active'
       WHERE b.organization_id = $1 AND b.agent_revision_id = $2
       ORDER BY r.capability_id`,
      [query.organizationId, query.agentRevisionId],
    );
    return result.rows.map(mapDescriptor);
  }
}
