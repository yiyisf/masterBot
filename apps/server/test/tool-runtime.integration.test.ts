import { randomUUID } from 'node:crypto';
import {
  PostgresToolCatalog,
  toolGrantId,
  toolRevisionId,
} from '@cmaster/tools';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });

afterAll(async () => {
  await pool.end();
});

describe('PostgresToolCatalog', () => {
  it('lists only active Tool Capabilities contained in the Agent Tool Grant', async () => {
    const identity = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Tool Catalog ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Tool Catalog Employee',
    });
    await identity.provision();
    const organization = identity.resolveRequest().organizationId;
    const catalog = new PostgresToolCatalog(pool);
    const grantId = toolGrantId(randomUUID());
    const currentTimeRevisionId = toolRevisionId(randomUUID());

    await catalog.provision(organization, {
      revisions: [
        {
          id: currentTimeRevisionId,
          capabilityId: 'cmaster.utility.current_time:v1',
          name: 'Current time',
          description: 'Returns the current time.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          effect: 'read_only',
          recovery: 'retry_same_call',
          risks: [],
          providerKey: 'built-in:current-time',
        },
        {
          id: toolRevisionId(randomUUID()),
          capabilityId: 'cmaster.utility.text_statistics:v1',
          name: 'Text statistics',
          description: 'Counts text characters, words, and lines.',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
          effect: 'read_only',
          recovery: 'retry_same_call',
          risks: [],
          providerKey: 'built-in:text-statistics',
        },
      ],
      grants: [{ id: grantId, capabilityIds: ['cmaster.utility.current_time:v1'] }],
    });

    const tools = await catalog.list({ organizationId: organization, grantId });

    expect(tools).toEqual([
      {
        revisionId: currentTimeRevisionId,
        capabilityId: 'cmaster.utility.current_time:v1',
        name: 'Current time',
        description: 'Returns the current time.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        effect: 'read_only',
        recovery: 'retry_same_call',
        risks: [],
      },
    ]);
  });
});
