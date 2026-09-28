import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentId, agentRevisionId, PostgresAgentModule } from '@cmaster/agents';
import { commandId, PostgresConversationModule } from '@cmaster/conversations';
import {
  contextInvocationId,
  PostgresContextBuilder,
  slice4BaselineContextPolicy,
} from '@cmaster/context';
import {
  AiSdkAgentEngine,
  PostgresExecutionModule,
  runCommandId,
  RunWorker,
} from '@cmaster/execution';
import { PostgresApprovalModule, Slice3BaselinePolicy } from '@cmaster/governance';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import {
  modelProfileId,
  PostgresModelGateway,
  type ModelAdapter,
  type ModelAdapterEvent,
  type ModelAdapterRequest,
  type ModelFailure,
} from '@cmaster/models';
import { PostgresToolCatalog, PostgresToolRuntime } from '@cmaster/tools';
import {
  createConfiguredWorkspaceChangeContentStore,
  createConfiguredWorkspaceRevisionSnapshotStore,
  createConfiguredWorkspaceSandboxAdapter,
  PostgresWorkspaceCatalog,
  PostgresWorkspaceChanges,
  PostgresWorkspaceRunEnvironments,
  workspaceCommandId,
  workspaceInvocationId,
  type WorkspaceRevisionContentReader,
} from '@cmaster/workspaces';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { GovernedAgentToolRuntime } from '../src/governed-agent-tools.js';
import { Slice3DevelopmentEntitlements } from '../src/tool-confirmation-coordinator.js';
import {
  WorkspaceFileToolProvider,
  WorkspaceFileToolProvenanceObserver,
  workspaceFileToolCatalog,
} from '../src/workspace-file-tools.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
const pool = new Pool({ connectionString: databaseUrl });
const roots: string[] = [];
const sandboxCleanups: Array<() => Promise<void>> = [];

afterAll(async () => {
  await Promise.all(sandboxCleanups.map((cleanup) => cleanup()));
  await pool.end();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

class WorkspaceEditingModelAdapter implements ModelAdapter {
  readonly providerKind = 'openai-compatible' as const;
  calls = 0;
  toolOutputs: unknown[] = [];

  async *stream(request: ModelAdapterRequest): AsyncIterable<ModelAdapterEvent> {
    this.calls += 1;
    if (this.calls > 1) this.toolOutputs.push(request.transcript?.at(-1));
    const requested = this.calls === 1
      ? { requestId: 'open-fixed-file', name: 'workspace_open_file', input: { path: 'README.md' } }
      : this.calls === 2
        ? {
          requestId: 'write-private-overlay', name: 'workspace_write_file',
          input: { path: 'README.md', content: '# Edited README\n' },
        }
        : this.calls === 3
          ? { requestId: 'propose-private-overlay', name: 'workspace_propose_changes', input: {} }
          : undefined;
    if (requested) {
      yield { type: 'tool_requested', request: requested };
      yield { type: 'completed', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } };
      return;
    }
    yield { type: 'text_delta', text: 'The fixed file was edited and proposed.' };
    yield { type: 'completed', usage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 } };
  }

  classifyError(): ModelFailure {
    return { code: 'unknown_provider_error', message: 'Model failed.', retryable: false };
  }
}

describe('Workspace file Tools in the real Worker', () => {
  it('recovers a private overlay on another Worker, proposes it, and records open provenance', async () => {
    const identity = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Workspace Tool ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Workspace Tool Employee',
    });
    await identity.provision();
    const requestIdentity = identity.resolveRequest();
    const revisionId = agentRevisionId(randomUUID());
    const agents = new PostgresAgentModule(pool, {
      agentId: agentId(randomUUID()),
      echoRevisionId: agentRevisionId(randomUUID()),
      aiSdkRevisionId: agentRevisionId(randomUUID()),
      toolRevisionId: agentRevisionId(randomUUID()),
      contextArtifactRevisionId: revisionId,
      contextPolicyRevision: slice4BaselineContextPolicy.revision,
      activeRevisionId: revisionId,
      name: `Workspace Reader ${randomUUID()}`,
    });
    await agents.provision(requestIdentity.organizationId);
    const agent = await agents.resolveDefault(requestIdentity.organizationId);

    const modelsAdapter = new WorkspaceEditingModelAdapter();
    const models = new PostgresModelGateway(pool, modelsAdapter, {
      credentials: new Map([['env:test', 'model-secret']]),
    });
    await models.provision(requestIdentity.organizationId, [{
      id: modelProfileId(randomUUID()),
      displayName: 'Workspace Tool Model',
      routeRole: 'primary',
      baseUrl: 'https://models.example.test/v1',
      providerModelId: 'workspace-tool-model',
      credentialRef: 'env:test',
      capabilities: { streamingText: true, toolCalling: true },
      contextLimits: { contextWindowTokens: 16_384, maxOutputTokens: 2_048 },
      dataHandlingTier: 'test',
      costTier: 'test',
    }]);

    const conversations = new PostgresConversationModule(pool);
    const conversation = (await conversations.create(requestIdentity, {
      commandId: commandId(randomUUID()),
    })).value;
    const trigger = (await conversations.appendEmployeeMessage(
      requestIdentity,
      conversation.id,
      {
        commandId: commandId(randomUUID()),
        parts: [{ type: 'text', text: 'Read the fixed README.' }],
      },
    )).value;
    const execution = new PostgresExecutionModule(pool);
    const accepted = await execution.acceptRun(requestIdentity, {
      commandId: runCommandId(randomUUID()),
      conversationId: conversation.id,
      messageId: trigger.id,
      agent,
    });

    const workspace = (await new PostgresWorkspaceCatalog(pool).provisionEmpty(
      requestIdentity,
      {
        commandId: workspaceCommandId(randomUUID()),
        name: 'Worker fixed files',
        operationMode: 'edit_with_confirmation',
      },
    )).value;
    const root = workspace.defaultWorkingRoot;
    if (!root) throw new Error('Expected a default Working Root');
    const bytes = Buffer.from('# Pinned README\n');
    const entry = {
      path: 'README.md', mediaType: 'text/markdown; charset=utf-8',
      sizeBytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const revisionContent: WorkspaceRevisionContentReader = {
      async list() { return [entry]; },
      async open() { return bytes; },
      async isPathVisible() { return true; },
      async pathExists() { return true; },
    };
    const storageRoot = await mkdtemp(join(tmpdir(), 'cmaster-worker-sandbox-'));
    roots.push(storageRoot);
    const firstSandbox = createConfiguredWorkspaceSandboxAdapter({
      storageRoot, revisionContent,
    });
    const firstWorkerEnvironments = new PostgresWorkspaceRunEnvironments(pool, {
      sandbox: firstSandbox,
    });
    const environmentRequest = {
      invocationId: workspaceInvocationId(accepted.value.rootInvocation.id),
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: root.currentRevisionId,
    };
    const preparedEnvironment = await firstWorkerEnvironments.prepare(
      requestIdentity, environmentRequest,
    );
    sandboxCleanups.push(() => firstSandbox.release({
      environmentId: preparedEnvironment.id,
    }));

    const changes = new PostgresWorkspaceChanges(pool, {
      revisionContent,
      contentStore: createConfiguredWorkspaceChangeContentStore({ storageRoot }),
      snapshotStore: createConfiguredWorkspaceRevisionSnapshotStore({ storageRoot }),
    });
    const recoveredEnvironments = new PostgresWorkspaceRunEnvironments(pool, {
      sandbox: createConfiguredWorkspaceSandboxAdapter({ storageRoot, revisionContent }),
      changes,
    });
    const context = new PostgresContextBuilder(pool, conversations);
    const catalog = new PostgresToolCatalog(pool);
    await catalog.provision(
      requestIdentity.organizationId,
      workspaceFileToolCatalog(requestIdentity.organizationId, revisionId),
    );
    const tools = new PostgresToolRuntime(
      pool,
      new Slice3BaselinePolicy(),
      new PostgresApprovalModule(pool),
      [new WorkspaceFileToolProvider(recoveredEnvironments)],
    );
    const agentTools = new GovernedAgentToolRuntime(
      catalog,
      tools,
      identity,
      new Slice3DevelopmentEntitlements(),
      execution,
      [new WorkspaceFileToolProvenanceObserver(recoveredEnvironments, context)],
    );
    const worker = new RunWorker(
      execution,
      conversations,
      [new AiSdkAgentEngine(models, agentTools)],
      { workerId: `workspace-reader-${randomUUID()}`, leaseTtlMs: 1_000, maxAttempts: 3 },
      {
        agentRevisionId: revisionId,
        builder: context,
        models,
        resolveFixedOverheadTokens: async () => 128,
      },
    );

    let completed = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await worker.relayOne();
      await worker.executeOne();
      const current = await execution.getRun(requestIdentity, accepted.value.id);
      if (current.status === 'succeeded') {
        completed = true;
        break;
      }
      if (current.status === 'failed') break;
    }

    expect(completed).toBe(true);
    expect(modelsAdapter.toolOutputs).toEqual([
      expect.objectContaining({
        role: 'tool', output: expect.objectContaining({
          path: 'README.md', content: '# Pinned README\n',
        }),
      }),
      expect.objectContaining({
        role: 'tool', output: expect.objectContaining({
          kind: 'write', path: 'README.md', changed: true,
        }),
      }),
      expect.objectContaining({
        role: 'tool', output: expect.objectContaining({
          status: 'proposed',
          entries: [expect.objectContaining({ kind: 'modify', path: 'README.md' })],
        }),
      }),
    ]);
    await expect(recoveredEnvironments.listOverlay(
      requestIdentity, environmentRequest.invocationId,
    )).resolves.toMatchObject({ items: [{ kind: 'write', path: 'README.md' }] });
    const recoveredContext = await context.build({
      organizationId: requestIdentity.organizationId,
      principalId: requestIdentity.principalId,
      invocationId: contextInvocationId(accepted.value.rootInvocation.id),
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      modelBudget: await models.resolveContextBudget({
        organizationId: requestIdentity.organizationId,
        requiresToolCalling: true,
      }),
      fixedOverheadTokens: 128,
    });
    expect(recoveredContext.manifest.items).toContainEqual(expect.objectContaining({
      sourceKind: 'workspace_file',
      workspaceId: workspace.id,
      workingRootId: root.id,
      revisionId: root.currentRevisionId,
      path: 'README.md',
      sourceHash: entry.sha256,
    }));
  });
});
