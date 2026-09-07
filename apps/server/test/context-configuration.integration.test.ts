import { randomUUID } from 'node:crypto';
import { agentId, agentRevisionId, PostgresAgentModule } from '@cmaster/agents';
import {
  contextPolicyRevision,
  deriveEffectiveContextInputLimit,
  slice4BaselineContextPolicy,
} from '@cmaster/context';
import { modelProfileId, PostgresModelGateway, type ModelAdapter } from '@cmaster/models';
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

const unusedAdapter: ModelAdapter = {
  providerKind: 'openai-compatible',
  async *stream() {
    throw new Error('Provider I/O is not expected while resolving Context configuration');
  },
  classifyError() {
    throw new Error('Provider classification is not expected');
  },
};

async function provisionIdentity() {
  const identity = new PostgresDevelopmentIdentity(pool, {
    organizationId: organizationId(randomUUID()),
    organizationName: `Context Configuration ${randomUUID()}`,
    principalId: principalId(randomUUID()),
    principalDisplayName: 'Context Configuration Employee',
  });
  await identity.provision();
  return identity;
}

describe('Slice 4 immutable execution configuration', () => {
  it('resolves a new Agent Revision with its fixed Context Policy reference', async () => {
    const identity = await provisionIdentity();
    const contextArtifactRevisionId = agentRevisionId(randomUUID());
    const configuration = {
      agentId: agentId(randomUUID()),
      echoRevisionId: agentRevisionId(randomUUID()),
      aiSdkRevisionId: agentRevisionId(randomUUID()),
      toolRevisionId: agentRevisionId(randomUUID()),
      contextArtifactRevisionId,
      contextPolicyRevision: slice4BaselineContextPolicy.revision,
      activeRevisionId: contextArtifactRevisionId,
      name: `Context Agent ${randomUUID()}`,
    };
    const agents = new PostgresAgentModule(pool, configuration);

    await agents.provision(identity.resolveRequest().organizationId);

    await expect(agents.resolveDefault(identity.resolveRequest().organizationId)).resolves.toMatchObject({
      agentRevisionId: configuration.contextArtifactRevisionId,
      engineKind: 'ai-sdk',
      modelRequirement: { streamingText: true, toolCalling: true },
      contextPolicyRevision: 'slice4-context-v1',
    });

    const conflicting = new PostgresAgentModule(pool, {
      ...configuration,
      contextPolicyRevision: contextPolicyRevision('mutated-context-policy'),
    });
    await expect(conflicting.provision(identity.resolveRequest().organizationId))
      .rejects.toThrow('immutable configuration');
  });

  it('resolves the strictest input capacity from immutable Model Profile limits', async () => {
    const identity = await provisionIdentity();
    const models = new PostgresModelGateway(pool, unusedAdapter, {
      credentials: new Map([
        ['env:primary', 'primary-secret'],
        ['env:fallback', 'fallback-secret'],
      ]),
    });
    const organizationId = identity.resolveRequest().organizationId;
    await models.provision(organizationId, [
      {
        id: modelProfileId(randomUUID()),
        displayName: 'Slice 3 Primary',
        routeRole: 'primary',
        baseUrl: 'https://primary.example.test/v1',
        providerModelId: 'primary-model',
        credentialRef: 'env:primary',
        capabilities: { streamingText: true, toolCalling: true },
        dataHandlingTier: 'internal',
        costTier: 'standard',
      },
      {
        id: modelProfileId(randomUUID()),
        displayName: 'Slice 3 Fallback',
        routeRole: 'fallback',
        baseUrl: 'https://fallback.example.test/v1',
        providerModelId: 'fallback-model',
        credentialRef: 'env:fallback',
        capabilities: { streamingText: true, toolCalling: true },
        dataHandlingTier: 'internal',
        costTier: 'standard',
      },
    ]);

    const primaryProfileId = modelProfileId(randomUUID());
    const fallbackProfileId = modelProfileId(randomUUID());
    await models.provision(organizationId, [
      {
        id: primaryProfileId,
        displayName: 'Context Primary',
        routeRole: 'primary',
        baseUrl: 'https://primary.example.test/v1',
        providerModelId: 'primary-model',
        credentialRef: 'env:primary',
        capabilities: { streamingText: true, toolCalling: true },
        contextLimits: { contextWindowTokens: 131_072, maxOutputTokens: 16_384 },
        dataHandlingTier: 'test',
        costTier: 'test',
      },
      {
        id: fallbackProfileId,
        displayName: 'Context Fallback',
        routeRole: 'fallback',
        baseUrl: 'https://fallback.example.test/v1',
        providerModelId: 'fallback-model',
        credentialRef: 'env:fallback',
        capabilities: { streamingText: true, toolCalling: true },
        contextLimits: { contextWindowTokens: 65_536, maxOutputTokens: 8_192 },
        dataHandlingTier: 'test',
        costTier: 'test',
      },
    ]);

    const modelBudget = await models.resolveContextBudget({
      organizationId,
      requiresToolCalling: true,
    });
    expect(modelBudget).toEqual({
      primaryProfileId,
      fallbackProfileId,
      strictestContextWindowTokens: 65_536,
      maximumOutputTokens: 16_384,
    });
    expect(deriveEffectiveContextInputLimit(
      slice4BaselineContextPolicy,
      modelBudget,
    )).toBe(45_056);

    await expect(models.provision(organizationId, [{
      id: modelProfileId(randomUUID()),
      displayName: 'Oversized Context Profile',
      routeRole: 'primary',
      baseUrl: 'https://primary.example.test/v1',
      providerModelId: 'primary-model',
      credentialRef: 'env:primary',
      capabilities: { streamingText: true, toolCalling: true },
      contextLimits: { contextWindowTokens: 2_147_483_648, maxOutputTokens: 8_192 },
      dataHandlingTier: 'test',
      costTier: 'test',
    }])).rejects.toThrow('positive PostgreSQL integers');

    await expect(models.provision(organizationId, [{
      id: primaryProfileId,
      displayName: 'Context Primary',
      routeRole: 'primary',
      baseUrl: 'https://primary.example.test/v1',
      providerModelId: 'primary-model',
      credentialRef: 'env:primary',
      capabilities: { streamingText: true, toolCalling: true },
      contextLimits: { contextWindowTokens: 131_072, maxOutputTokens: 8_192 },
      dataHandlingTier: 'test',
      costTier: 'test',
    }])).rejects.toThrow('immutable profile');
  });
});
