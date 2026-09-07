import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { agentId, agentRevisionId, PostgresAgentModule } from '@cmaster/agents';
import {
  createTextArtifactToolRevision,
  CreateTextArtifactToolProvider,
  PostgresArtifactModule,
} from '@cmaster/artifacts';
import { PostgresConversationModule } from '@cmaster/conversations';
import {
  estimateConservativeUtf8Tokens,
  PostgresContextBuilder,
  slice4BaselineContextPolicy,
  slice4BaselineFixedOverheadTokens,
} from '@cmaster/context';
import {
  AiSdkAgentEngine,
  PostgresExecutionModule,
  RunWorker,
} from '@cmaster/execution';
import { PostgresApprovalModule, Slice3BaselinePolicy } from '@cmaster/governance';
import { organizationId, PostgresDevelopmentIdentity, principalId } from '@cmaster/identity';
import {
  modelProfileId,
  PostgresModelGateway,
  type ModelAdapter,
  type ModelAdapterEvent,
  type ModelAdapterRequest,
  type ModelFailure,
} from '@cmaster/models';
import {
  PostgresToolCatalog,
  PostgresToolRuntime,
  toolGrantId,
  toolRevisionId,
  workflowValidationToolCatalog,
} from '@cmaster/tools';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApi } from '../src/app.js';
import { loadServerConfig } from '../src/config.js';
import { InMemoryFeatureFlags } from '../src/feature-flags.js';
import { GovernedAgentToolRuntime } from '../src/governed-agent-tools.js';
import { PollingRunEventNotifier } from '../src/run-event-notifier.js';
import {
  Slice3DevelopmentEntitlements,
  ToolConfirmationCoordinator,
} from '../src/tool-confirmation-coordinator.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
let storageRoot: string;

beforeAll(async () => { storageRoot = await mkdtemp(join(tmpdir(), 'cmaster-slice4-e2e-')); });
afterAll(async () => {
  await pool.end();
  await rm(storageRoot, { recursive: true, force: true });
});

class Slice4ModelAdapter implements ModelAdapter {
  readonly providerKind = 'openai-compatible' as const;
  calls = 0;
  secondRunTranscript: ModelAdapterRequest['transcript'];

  async *stream(request: ModelAdapterRequest): AsyncIterable<ModelAdapterEvent> {
    this.calls += 1;
    if (this.calls === 1) {
      yield { type: 'text_delta', text: 'Prior launch fact: rollout is staged.' };
      yield { type: 'completed', usage: { inputTokens: 2, outputTokens: 5, totalTokens: 7 } };
      return;
    }
    if (this.calls === 2) {
      this.secondRunTranscript = request.transcript;
      yield {
        type: 'tool_requested',
        request: {
          requestId: 'slice4-artifact-request',
          name: 'create_text_artifact',
          input: {
            title: 'Staged rollout plan',
            format: 'markdown',
            content: '# Rollout\nUse the prior staged launch fact.',
          },
        },
      };
      yield { type: 'completed', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
      return;
    }
    yield { type: 'text_delta', text: 'The staged rollout Artifact is ready.' };
    yield { type: 'completed', usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
  }

  classifyError(): ModelFailure {
    return { code: 'unknown_provider_error', message: 'Model failed.', retryable: false };
  }
}

function idempotencyHeaders() {
  return { 'idempotency-key': randomUUID() };
}

describe('Slice 4 Context-to-Artifact release flow', () => {
  it('runs a second Browser-triggered Run through Context, Tool, Message, replay, and authorized read', async () => {
    const identity = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Slice 4 E2E ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Slice 4 Employee',
    });
    await identity.provision();
    const contextAgentRevisionId = agentRevisionId(randomUUID());
    const agents = new PostgresAgentModule(pool, {
      agentId: agentId(randomUUID()),
      echoRevisionId: agentRevisionId(randomUUID()),
      toolRevisionId: agentRevisionId(randomUUID()),
      contextArtifactRevisionId: contextAgentRevisionId,
      contextPolicyRevision: slice4BaselineContextPolicy.revision,
      activeRevisionId: contextAgentRevisionId,
      name: `Slice 4 Agent ${randomUUID()}`,
    });
    await agents.provision(identity.resolveRequest().organizationId);

    const modelAdapter = new Slice4ModelAdapter();
    const models = new PostgresModelGateway(pool, modelAdapter, {
      credentials: new Map([['env:test', 'model-secret']]),
    });
    await models.provision(identity.resolveRequest().organizationId, [{
      id: modelProfileId(randomUUID()),
      displayName: 'Slice 4 Model',
      routeRole: 'primary',
      baseUrl: 'https://models.example.test/v1',
      providerModelId: 'slice4-model',
      credentialRef: 'env:test',
      capabilities: { streamingText: true, toolCalling: true },
      contextLimits: { contextWindowTokens: 65_536, maxOutputTokens: 16_384 },
      dataHandlingTier: 'test',
      costTier: 'test',
    }]);

    const catalog = new PostgresToolCatalog(pool);
    const baseline = workflowValidationToolCatalog(contextAgentRevisionId);
    const randomizedBaseline = baseline.revisions.map((revision) => ({
      ...revision, id: toolRevisionId(randomUUID()),
    }));
    await catalog.provision(identity.resolveRequest().organizationId, {
      revisions: [
        ...randomizedBaseline,
        { ...createTextArtifactToolRevision, id: toolRevisionId(randomUUID()) },
      ],
      grants: [{
        id: toolGrantId(randomUUID()),
        agentRevisionId: contextAgentRevisionId,
        capabilityIds: [
          ...(baseline.grants[0]?.capabilityIds ?? []),
          createTextArtifactToolRevision.capabilityId,
        ],
      }],
    });
    const writerArtifacts = new PostgresArtifactModule(pool, storageRoot);
    const readerArtifacts = new PostgresArtifactModule(pool, storageRoot);
    const approvals = new PostgresApprovalModule(pool);
    const tools = new PostgresToolRuntime(
      pool,
      new Slice3BaselinePolicy(),
      approvals,
      [new CreateTextArtifactToolProvider(writerArtifacts)],
    );
    const conversations = new PostgresConversationModule(pool);
    const execution = new PostgresExecutionModule(pool);
    const entitlements = new Slice3DevelopmentEntitlements();
    const governedTools = new GovernedAgentToolRuntime(
      catalog, tools, identity, entitlements, execution,
    );
    const createWorker = () => new RunWorker(
      execution,
      conversations,
      [new AiSdkAgentEngine(models, governedTools)],
      { workerId: `slice4-e2e-${randomUUID()}`, leaseTtlMs: 1_000, maxAttempts: 3 },
      {
        agentRevisionId: contextAgentRevisionId,
        builder: new PostgresContextBuilder(
          pool,
          conversations,
          models,
          new PostgresArtifactModule(pool, storageRoot),
        ),
        models,
        resolveFixedOverheadTokens: async (input) => (
          slice4BaselineFixedOverheadTokens
          + estimateConservativeUtf8Tokens(JSON.stringify(await governedTools.list(input)), 8)
        ),
      },
    );
    const worker = createWorker();
    const config = loadServerConfig({
      DATABASE_URL: databaseUrl,
      CMASTER_SERVER_ROLE: 'all',
      CMASTER_RUNTIME_ENV: 'test',
      NEXT_ARCHITECTURE_ENABLED: 'true',
      CMASTER_DEVELOPMENT_IDENTITY_ENABLED: 'true',
    }, []);
    const app = buildApi({
      config,
      database: { check: async () => true },
      featureFlags: new InMemoryFeatureFlags({
        nextArchitecture: true, toolRuntime: true, contextArtifacts: true,
      }),
      runApi: {
        identity, agents, conversations, execution, notifier: new PollingRunEventNotifier(),
      },
      artifactApi: { identity, artifacts: readerArtifacts },
      toolConfirmationCoordinator: new ToolConfirmationCoordinator(
        execution, tools, entitlements,
      ),
    });

    const conversationResponse = await app.inject({
      method: 'POST', url: '/api/v1/conversations', headers: idempotencyHeaders(), body: {},
    });
    const conversationId = conversationResponse.json<{ id: string }>().id;
    const firstMessage = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: idempotencyHeaders(),
      body: { parts: [{ type: 'text', text: 'Record the staged launch fact.' }] },
    });
    const firstRun = await app.inject({
      method: 'POST', url: '/api/v1/runs', headers: idempotencyHeaders(),
      body: {
        conversationId,
        trigger: { type: 'message', messageId: firstMessage.json<{ id: string }>().id },
      },
    });
    expect(firstRun.statusCode).toBe(202);
    await worker.relayOne();
    await worker.executeOne();

    const secondMessage = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: idempotencyHeaders(),
      body: { parts: [{ type: 'text', text: 'Create the exact rollout Artifact.' }] },
    });
    const secondRun = await app.inject({
      method: 'POST', url: '/api/v1/runs', headers: idempotencyHeaders(),
      body: {
        conversationId,
        trigger: { type: 'message', messageId: secondMessage.json<{ id: string }>().id },
      },
    });
    const secondRunId = secondRun.json<{ runId: string }>().runId;
    await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: idempotencyHeaders(),
      body: { parts: [{ type: 'text', text: 'This later Message must stay outside the Run.' }] },
    });
    const connectedStream = app.inject({
      method: 'GET', url: `/api/v1/runs/${secondRunId}/events?afterSequence=0`,
    });
    const restartedWorker = createWorker();
    await restartedWorker.relayOne();
    await restartedWorker.executeOne();

    expect(JSON.stringify(modelAdapter.secondRunTranscript)).toContain('Prior launch fact');
    expect(JSON.stringify(modelAdapter.secondRunTranscript)).not.toContain('later Message');
    const messagesResponse = await app.inject({
      method: 'GET', url: `/api/v1/conversations/${conversationId}/messages`,
    });
    const messages = messagesResponse.json<{ items: Array<{ parts: Array<Record<string, string>> }> }>().items;
    const finalMessage = messages.at(-1);
    const artifactReference = finalMessage?.parts.find((part) => part.type === 'artifact_reference');
    expect(artifactReference).toMatchObject({
      artifactId: expect.any(String), artifactVersionId: expect.any(String),
    });
    if (!artifactReference) throw new Error('Final Artifact Reference was unavailable');

    const metadata = await app.inject({
      method: 'GET', url: `/api/v1/artifacts/${artifactReference.artifactId}`,
    });
    expect(metadata.statusCode).toBe(200);
    const content = await app.inject({
      method: 'GET',
      url: `/api/v1/artifacts/${artifactReference.artifactId}/versions/${artifactReference.artifactVersionId}/content`,
    });
    expect(content.body).toBe('# Rollout\nUse the prior staged launch fact.');

    const events = await connectedStream;
    expect(events.statusCode).toBe(200);
    expect(events.body).toContain('artifact.created');
    expect(events.body).not.toContain('# Rollout');
    expect(events.body).not.toMatch(/model-secret|content_hash|storage_ref|blobs\/sha256/i);

    const reconnected = await app.inject({
      method: 'GET',
      url: `/api/v1/runs/${secondRunId}/events`,
      headers: { 'last-event-id': '1' },
    });
    expect(reconnected.statusCode).toBe(200);
    expect(reconnected.body).toContain('artifact.created');
    expect(reconnected.body).toContain('assistant_message.appended');
    const refreshed = await app.inject({
      method: 'GET', url: `/api/v1/conversations/${conversationId}/messages`,
    });
    expect(refreshed.json()).toEqual(messagesResponse.json());
    expect(refreshed.json<{ items: Array<{ parts: Array<Record<string, string>> }> }>()
      .items.at(-1)?.parts).toContainEqual(artifactReference);
    expect(await restartedWorker.executeOne()).toBe(false);
    expect(modelAdapter.calls).toBe(3);
    await app.close();
  });
});
