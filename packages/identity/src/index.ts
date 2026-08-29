import type { Brand } from '@cmaster/kernel';
import type { Pool } from 'pg';

export type OrganizationId = Brand<string, 'OrganizationId'>;
export type PrincipalId = Brand<string, 'PrincipalId'>;

export interface RequestIdentity {
  organizationId: OrganizationId;
  principalId: PrincipalId;
  principalType: 'employee';
  displayName: string;
}

export interface DevelopmentIdentityConfig {
  organizationId: OrganizationId;
  organizationName: string;
  principalId: PrincipalId;
  principalDisplayName: string;
}

/**
 * Supplies a trusted, server-created RequestIdentity; callers never provide Organization or Principal IDs.
 * Development provisioning is idempotent and performs a bounded number of indexed writes.
 * Provisioning rejects database/constraint failures; request resolution is synchronous and allocation-only.
 */
export interface IdentityModule {
  provision(): Promise<void>;
  resolveRequest(): RequestIdentity;
}

export class PostgresDevelopmentIdentity implements IdentityModule {
  constructor(
    private readonly pool: Pool,
    private readonly config: DevelopmentIdentityConfig,
  ) {}

  async provision(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO organizations (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [this.config.organizationId, this.config.organizationName],
      );
      await client.query(
        `INSERT INTO principals (id, organization_id, principal_type, display_name)
         VALUES ($1, $2, 'employee', $3)
         ON CONFLICT (id) DO NOTHING`,
        [
          this.config.principalId,
          this.config.organizationId,
          this.config.principalDisplayName,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  resolveRequest(): RequestIdentity {
    return {
      organizationId: this.config.organizationId,
      principalId: this.config.principalId,
      principalType: 'employee',
      displayName: this.config.principalDisplayName,
    };
  }
}

export function organizationId(value: string): OrganizationId {
  return value as OrganizationId;
}

export function principalId(value: string): PrincipalId {
  return value as PrincipalId;
}
