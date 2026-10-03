import { randomUUID } from 'node:crypto';
import {
  agentId,
  agentRevisionId,
  PostgresAgentModule,
} from '@cmaster/agents';
import { slice4BaselineContextPolicy } from '@cmaster/context';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import {
  PostgresToolCatalog,
  toolGrantId,
} from '@cmaster/tools';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import {
  APPLY_WORKSPACE_CHANGES_CAPABILITY_ID,
  workspaceFileToolCatalog,
} from '../src/workspace-file-tools.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });

afterAll(async () => {
  await pool.end();
});

describe('Workspace-enabled Agent Revision upgrade', () => {
  it('adds a new immutable Agent Revision and Tool Grant without changing the Context Revision', async () => {
    const identity = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Workspace Agent Upgrade ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Workspace Agent Upgrade Employee',
    });
    await identity.provision();
    const requestIdentity = identity.resolveRequest();
    const configuredAgentId = agentId(randomUUID());
    const echoRevisionId = agentRevisionId(randomUUID());
    const aiSdkRevisionId = agentRevisionId(randomUUID());
    const toolRevisionId = agentRevisionId(randomUUID());
    const contextRevisionId = agentRevisionId(randomUUID());
    const workspaceRevisionId = agentRevisionId(randomUUID());
    const shared = {
      agentId: configuredAgentId,
      echoRevisionId,
      aiSdkRevisionId,
      toolRevisionId,
      contextArtifactRevisionId: contextRevisionId,
      contextPolicyRevision: slice4BaselineContextPolicy.revision,
      name: `Workspace Upgrade Agent ${randomUUID()}`,
    } as const;

    const contextAgent = new PostgresAgentModule(pool, {
      ...shared,
      activeRevisionId: contextRevisionId,
    });
    await contextAgent.provision(requestIdentity.organizationId);
    await expect(contextAgent.resolveDefault(requestIdentity.organizationId))
      .resolves.toMatchObject({ agentRevisionId: contextRevisionId });

    const catalog = new PostgresToolCatalog(pool);
    const oldCatalog = workspaceFileToolCatalog(
      requestIdentity.organizationId,
      contextRevisionId,
    );
    const oldGrant = oldCatalog.grants[0];
    if (!oldGrant) throw new Error('Expected the prior Workspace Tool Grant');
    await catalog.provision(requestIdentity.organizationId, {
      revisions: oldCatalog.revisions,
      grants: [{
        id: toolGrantId(randomUUID()),
        agentRevisionId: contextRevisionId,
        capabilityIds: oldGrant.capabilityIds.filter(
          (capabilityId) => capabilityId !== APPLY_WORKSPACE_CHANGES_CAPABILITY_ID,
        ),
      }],
    });

    const workspaceAgent = new PostgresAgentModule(pool, {
      ...shared,
      workspaceRevisionId,
      activeRevisionId: workspaceRevisionId,
    });
    await workspaceAgent.provision(requestIdentity.organizationId);
    await catalog.provision(
      requestIdentity.organizationId,
      workspaceFileToolCatalog(requestIdentity.organizationId, workspaceRevisionId),
    );

    await expect(workspaceAgent.resolveDefault(requestIdentity.organizationId))
      .resolves.toMatchObject({ agentRevisionId: workspaceRevisionId });
    await expect(catalog.list({
      organizationId: requestIdentity.organizationId,
      agentRevisionId: contextRevisionId,
    })).resolves.not.toContainEqual(expect.objectContaining({
      capabilityId: APPLY_WORKSPACE_CHANGES_CAPABILITY_ID,
    }));
    await expect(catalog.list({
      organizationId: requestIdentity.organizationId,
      agentRevisionId: workspaceRevisionId,
    })).resolves.toContainEqual(expect.objectContaining({
      capabilityId: APPLY_WORKSPACE_CHANGES_CAPABILITY_ID,
    }));
  });
});
