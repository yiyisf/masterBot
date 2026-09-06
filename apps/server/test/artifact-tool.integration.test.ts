import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { agentId, agentRevisionId, PostgresAgentModule } from '@cmaster/agents';
import {
  artifactSourceToolCallId,
  ArtifactInputInvalidError,
  createTextArtifactToolRevision,
  CreateTextArtifactToolProvider,
  PostgresArtifactModule,
} from '@cmaster/artifacts';
import { commandId, PostgresConversationModule } from '@cmaster/conversations';
import { slice4BaselineContextPolicy } from '@cmaster/context';
import {
  AiSdkAgentEngine,
  PostgresExecutionModule,
  runCommandId,
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
  ToolInputValidationError,
  workflowValidationToolCatalog,
} from '@cmaster/tools';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GovernedAgentToolRuntime } from '../src/governed-agent-tools.js';
import { Slice3DevelopmentEntitlements } from '../src/tool-confirmation-coordinator.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
let storageRoot: string;

beforeAll(async () => { storageRoot = await mkdtemp(join(tmpdir(), 'cmaster-artifact-tool-')); });
afterAll(async () => {
  await pool.end();
  await rm(storageRoot, { recursive: true, force: true });
});

class ArtifactModelAdapter implements ModelAdapter {
  readonly providerKind = 'openai-compatible' as const;
  calls = 0;

  async *stream(_request: ModelAdapterRequest): AsyncIterable<ModelAdapterEvent> {
    this.calls += 1;
    if (this.calls === 1) {
      yield {
        type: 'tool_requested',
        request: {
          requestId: 'artifact-request-1',
          name: 'create_text_artifact',
          input: { title: 'Run report', format: 'markdown', content: '# Durable report' },
        },
      };
      yield { type: 'completed', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } };
      return;
    }
    yield { type: 'text_delta', text: 'The report is ready.' };
    yield { type: 'completed', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } };
  }

  classifyError(): ModelFailure {
    return { code: 'unknown_provider_error', message: 'Model failed.', retryable: false };
  }
}

async function openedText(
  opened: Awaited<ReturnType<PostgresArtifactModule['open']>>,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of opened.bytes) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

describe('Artifact governed Tool and Harness', () => {
  it('creates through Tool Runtime and fixes an exact Artifact Version Reference in the Message', async () => {
    const identity = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Artifact Tool ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Artifact Employee',
    });
    await identity.provision();
    const toolAgentRevisionId = agentRevisionId(randomUUID());
    const artifactAgentRevisionId = agentRevisionId(randomUUID());
    const agents = new PostgresAgentModule(pool, {
      agentId: agentId(randomUUID()),
      echoRevisionId: agentRevisionId(randomUUID()),
      toolRevisionId: toolAgentRevisionId,
      contextArtifactRevisionId: artifactAgentRevisionId,
      contextPolicyRevision: slice4BaselineContextPolicy.revision,
      activeRevisionId: artifactAgentRevisionId,
      name: `Artifact Agent ${randomUUID()}`,
    });
    await agents.provision(identity.resolveRequest().organizationId);
    const revision = await agents.resolveDefault(identity.resolveRequest().organizationId);

    const modelAdapter = new ArtifactModelAdapter();
    const models = new PostgresModelGateway(pool, modelAdapter, {
      credentials: new Map([['env:test', 'model-secret']]),
    });
    await models.provision(identity.resolveRequest().organizationId, [{
      id: modelProfileId(randomUUID()),
      displayName: 'Artifact Model',
      routeRole: 'primary',
      baseUrl: 'https://models.example.test/v1',
      providerModelId: 'artifact-model',
      credentialRef: 'env:test',
      capabilities: { streamingText: true, toolCalling: true },
      dataHandlingTier: 'test',
      costTier: 'test',
    }]);

    const catalog = new PostgresToolCatalog(pool);
    const baseline = workflowValidationToolCatalog(toolAgentRevisionId);
    const baselineToolCatalog = {
      revisions: baseline.revisions.map((descriptor) => ({
        ...descriptor,
        id: toolRevisionId(randomUUID()),
      })),
      grants: [{
        id: toolGrantId(randomUUID()),
        agentRevisionId: toolAgentRevisionId,
        capabilityIds: baseline.grants[0]?.capabilityIds ?? [],
      }],
    };
    await catalog.provision(identity.resolveRequest().organizationId, baselineToolCatalog);
    await catalog.provision(identity.resolveRequest().organizationId, {
      revisions: [
        ...baselineToolCatalog.revisions,
        { ...createTextArtifactToolRevision, id: toolRevisionId(randomUUID()) },
      ],
      grants: [{
        id: toolGrantId(randomUUID()),
        agentRevisionId: revision.agentRevisionId,
        capabilityIds: [
          ...(baselineToolCatalog.grants[0]?.capabilityIds ?? []),
          createTextArtifactToolRevision.capabilityId,
        ],
      }],
    });
    await expect(catalog.list({
      organizationId: identity.resolveRequest().organizationId,
      agentRevisionId: toolAgentRevisionId,
    })).resolves.not.toContainEqual(expect.objectContaining({
      capabilityId: createTextArtifactToolRevision.capabilityId,
    }));
    await expect(catalog.list({
      organizationId: identity.resolveRequest().organizationId,
      agentRevisionId: artifactAgentRevisionId,
    })).resolves.toContainEqual(expect.objectContaining({
      capabilityId: createTextArtifactToolRevision.capabilityId,
      effect: 'idempotent_write',
      recovery: 'reconcile',
    }));
    const artifacts = new PostgresArtifactModule(pool, storageRoot);
    const tools = new PostgresToolRuntime(
      pool,
      new Slice3BaselinePolicy(),
      new PostgresApprovalModule(pool),
      [new CreateTextArtifactToolProvider(artifacts)],
    );
    const execution = new PostgresExecutionModule(pool);
    const conversations = new PostgresConversationModule(pool);
    const governedTools = new GovernedAgentToolRuntime(
      catalog,
      tools,
      identity,
      new Slice3DevelopmentEntitlements(),
      execution,
    );
    const conversation = await conversations.create(identity.resolveRequest(), {
      commandId: commandId(randomUUID()),
    });
    const trigger = await conversations.appendEmployeeMessage(
      identity.resolveRequest(),
      conversation.value.id,
      {
        commandId: commandId(randomUUID()),
        parts: [{ type: 'text', text: 'Create the report.' }],
      },
    );
    const accepted = await execution.acceptRun(identity.resolveRequest(), {
      commandId: runCommandId(randomUUID()),
      conversationId: conversation.value.id,
      messageId: trigger.value.id,
      agent: revision,
    });
    const worker = new RunWorker(
      execution,
      conversations,
      [new AiSdkAgentEngine(models, governedTools)],
      { workerId: `artifact-worker-${randomUUID()}`, leaseTtlMs: 1_000, maxAttempts: 3 },
    );
    await worker.relayOne();
    await worker.executeOne();

    const messages = await conversations.listMessages(
      identity.resolveRequest(), conversation.value.id, 0, 10,
    );
    const assistant = messages.find((message) => message.author === 'assistant');
    expect(assistant?.parts).toEqual([
      { type: 'text', text: 'The report is ready.' },
      {
        type: 'artifact_reference',
        artifactId: expect.any(String),
        artifactVersionId: expect.any(String),
      },
    ]);
    const reference = assistant?.parts[1];
    if (!reference || reference.type !== 'artifact_reference') {
      throw new Error('Artifact Reference Message Part expected');
    }
    await expect(openedText(await artifacts.open({
      identity: identity.resolveRequest(),
      artifactId: reference.artifactId,
      artifactVersionId: reference.artifactVersionId,
    }))).resolves.toBe('# Durable report');

    const run = await execution.getRun(identity.resolveRequest(), accepted.value.id);
    expect(run.status).toBe('succeeded');
    const events = await execution.readEvents(identity.resolveRequest(), accepted.value.id, 0);
    const createdEvent = events.find((event) => event.type === 'artifact.created');
    expect(createdEvent?.data).toMatchObject({
      invocationId: run.rootInvocation.id,
      artifactId: reference.artifactId,
      artifactVersionId: reference.artifactVersionId,
      kind: 'text',
      mediaType: 'text/markdown; charset=utf-8',
    });
    expect(JSON.stringify(createdEvent)).not.toContain('# Durable report');
    expect(JSON.stringify(createdEvent)).not.toContain('storage');
    expect(JSON.stringify(createdEvent)).not.toContain('hash');

    await expect(tools.invoke({
      identity: identity.resolveRequest(),
      agentRevisionId: revision.agentRevisionId,
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      runId: randomUUID(),
      invocationId: randomUUID(),
      modelRequestId: 'oversized-artifact-request',
      capabilityId: createTextArtifactToolRevision.capabilityId,
      input: { title: 'Too large', format: 'plain_text', content: 'x'.repeat(48 * 1024 + 1) },
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(ToolInputValidationError);
    await expect(tools.invoke({
      identity: identity.resolveRequest(),
      agentRevisionId: revision.agentRevisionId,
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      runId: randomUUID(),
      invocationId: randomUUID(),
      modelRequestId: 'oversized-utf8-artifact-request',
      capabilityId: createTextArtifactToolRevision.capabilityId,
      input: { title: 'Too many bytes', format: 'plain_text', content: '界'.repeat(20_000) },
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(ArtifactInputInvalidError);

    const crashCommand = {
      identity: identity.resolveRequest(),
      agentRevisionId: revision.agentRevisionId,
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      runId: randomUUID(),
      invocationId: randomUUID(),
      modelRequestId: 'artifact-crash-request',
      capabilityId: createTextArtifactToolRevision.capabilityId,
      input: {
        title: 'Crash-safe Artifact',
        format: 'plain_text',
        content: 'committed before ToolOutcome',
      },
      signal: new AbortController().signal,
    } as const;
    const child = spawn(process.execPath, [
      '--import', 'tsx', '--conditions=development',
      new URL('./fixtures/artifact-dispatch-crash.ts', import.meta.url).pathname,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        TEST_ARTIFACT_STORAGE_ROOT: storageRoot,
        TEST_ORGANIZATION_ID: crashCommand.identity.organizationId,
        TEST_PRINCIPAL_ID: crashCommand.identity.principalId,
        TEST_AGENT_REVISION_ID: crashCommand.agentRevisionId,
        TEST_RUN_ID: crashCommand.runId,
        TEST_INVOCATION_ID: crashCommand.invocationId,
        TEST_MODEL_REQUEST_ID: crashCommand.modelRequestId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let childError = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { childError += chunk; });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    expect(exitCode, childError).toBe(86);
    await new Promise((resolve) => setTimeout(resolve, 140));

    const recovered = await tools.invoke(crashCommand);
    expect(recovered).toMatchObject({
      kind: 'success',
      value: {
        artifactId: expect.any(String),
        artifactVersionId: expect.any(String),
        versionNumber: 1,
      },
    });
    if (recovered.kind !== 'success' || !recovered.value
      || typeof recovered.value !== 'object'
      || !('artifactId' in recovered.value) || typeof recovered.value.artifactId !== 'string'
      || !('artifactVersionId' in recovered.value)
      || typeof recovered.value.artifactVersionId !== 'string') {
      throw new Error('Recovered Artifact ToolOutcome expected');
    }
    const replayedArtifact = await artifacts.create({
      identity: crashCommand.identity,
      title: crashCommand.input.title,
      format: crashCommand.input.format,
      content: crashCommand.input.content,
      createdByInvocationId: crashCommand.invocationId,
      sourceToolCallId: artifactSourceToolCallId(recovered.toolCallId),
    });
    expect(replayedArtifact).toMatchObject({
      replayed: true,
      reference: {
        artifactId: recovered.value.artifactId,
        artifactVersionId: recovered.value.artifactVersionId,
      },
    });
    expect(JSON.stringify(recovered)).not.toContain('committed before ToolOutcome');
    expect(JSON.stringify(recovered)).not.toContain('storage');
    expect(JSON.stringify(recovered)).not.toContain('hash');
  });
});
