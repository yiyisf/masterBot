import { randomUUID } from 'node:crypto';
import {
  agentId,
  agentRevisionId,
  PostgresAgentModule,
} from '@cmaster/agents';
import {
  commandId,
  PostgresConversationModule,
} from '@cmaster/conversations';
import {
  contextInvocationId,
  PostgresContextBuilder,
  slice4BaselineContextPolicy,
  type InvocationContext,
} from '@cmaster/context';
import {
  PostgresExecutionModule,
  RunWorker,
  runCommandId,
  type AgentEngine,
  type EngineInvocation,
  type EngineEvent,
} from '@cmaster/execution';
import { modelProfileId } from '@cmaster/models';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
const pool = new Pool({ connectionString: databaseUrl });

beforeAll(async () => {
  await pool.query('SELECT 1');
});

afterAll(async () => {
  await pool.end();
});

class CapturingEngine implements AgentEngine {
  readonly kind = 'ai-sdk' as const;
  readonly version = '1' as const;
  invocation?: EngineInvocation;

  async *execute(input: EngineInvocation): AsyncIterable<EngineEvent> {
    this.invocation = input;
    if (!input.invocationContext) throw new Error('Invocation Context expected');
    yield {
      type: 'checkpoint_reached',
      checkpoint: {
        schemaVersion: 1,
        engineKind: 'ai-sdk',
        engineVersion: '1',
        contextManifestId: input.invocationContext.manifestId,
        toolCallId: 'context-test-boundary',
        outcome: 'completed',
        toolLoop: {
          modelStepNumber: 0,
          toolCallCount: 0,
          providerNeutralTranscript: [],
          completedToolCallIds: [],
          remainingModelToolRequests: [],
          outputGeneration: 0,
        },
      },
    };
    yield { type: 'text_delta', text: 'context received' };
    yield { type: 'completed' };
  }
}

describe('Context-aware Worker execution', () => {
  it('reuses a precommitted Manifest, excludes later Messages, and emits only safe metadata', async () => {
    const identity = new PostgresDevelopmentIdentity(pool, {
      organizationId: organizationId(randomUUID()),
      organizationName: `Context Execution Org ${randomUUID()}`,
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Context Employee',
    });
    await identity.provision();
    const requestIdentity = identity.resolveRequest();

    const contextRevisionId = agentRevisionId(randomUUID());
    const agents = new PostgresAgentModule(pool, {
      agentId: agentId(randomUUID()),
      echoRevisionId: agentRevisionId(randomUUID()),
      aiSdkRevisionId: agentRevisionId(randomUUID()),
      toolRevisionId: agentRevisionId(randomUUID()),
      contextArtifactRevisionId: contextRevisionId,
      contextPolicyRevision: slice4BaselineContextPolicy.revision,
      activeRevisionId: contextRevisionId,
      name: `Context Agent ${randomUUID()}`,
    });
    await agents.provision(requestIdentity.organizationId);

    const conversations = new PostgresConversationModule(pool);
    const conversation = (await conversations.create(requestIdentity, {
      commandId: commandId(randomUUID()),
      title: 'Recovery boundary',
    })).value;
    await conversations.appendEmployeeMessage(requestIdentity, conversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: 'initial request' }],
    });
    await conversations.appendAssistantMessage({
      organizationId: requestIdentity.organizationId,
      conversationId: conversation.id,
      sourceRunId: randomUUID(),
      sourceInvocationId: randomUUID(),
      parts: [{ type: 'text', text: 'initial answer' }],
    });
    const trigger = (await conversations.appendEmployeeMessage(requestIdentity, conversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: 'follow-up request' }],
    })).value;

    const execution = new PostgresExecutionModule(pool);
    const accepted = await execution.acceptRun(requestIdentity, {
      commandId: runCommandId(randomUUID()),
      messageId: trigger.id,
      conversationId: conversation.id,
      agent: await agents.resolveDefault(requestIdentity.organizationId),
    });
    const builder = new PostgresContextBuilder(pool, conversations);
    const modelBudget = {
      primaryProfileId: modelProfileId(randomUUID()),
      strictestContextWindowTokens: 65_536,
      maximumOutputTokens: 16_384,
    };
    const precommitted = await builder.build({
      organizationId: requestIdentity.organizationId,
      invocationId: contextInvocationId(accepted.value.rootInvocation.id),
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      modelBudget,
      fixedOverheadTokens: 128,
    });

    await conversations.appendEmployeeMessage(requestIdentity, conversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: 'must remain outside this Run' }],
    });

    const engine = new CapturingEngine();
    const worker = new RunWorker(
      execution,
      conversations,
      [engine],
      { workerId: `context-worker-${randomUUID()}`, leaseTtlMs: 1_000, maxAttempts: 3 },
      {
        agentRevisionId: contextRevisionId,
        builder,
        models: { resolveContextBudget: async () => modelBudget },
        resolveFixedOverheadTokens: async () => 128,
      },
    );
    await worker.relayOne();
    await worker.executeOne();

    expect(engine.invocation?.invocationContext).toEqual<InvocationContext>(
      precommitted.invocationContext,
    );
    expect(engine.invocation?.invocationContext?.messages).not.toContainEqual(
      expect.objectContaining({ text: 'must remain outside this Run' }),
    );
    const events = await execution.readEvents(requestIdentity, accepted.value.id, 0);
    const contextEvent = events.find((event) => event.type === 'invocation.context_built');
    expect(contextEvent?.data).toEqual({
      manifestId: precommitted.manifest.id,
      invocationId: accepted.value.rootInvocation.id,
      itemCount: 3,
      summarized: false,
      estimatedInputTokens: precommitted.manifest.estimatedInputTokens,
      contextPolicyRevision: 'slice4-context-v1',
    });
    expect(JSON.stringify(contextEvent)).not.toContain('initial request');
    expect(JSON.stringify(contextEvent)).not.toContain(precommitted.manifest.items[0]?.sourceHash);
  });
});
