import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { agentRevisionId } from '@cmaster/agents';
import {
  artifactId,
  artifactSourceToolCallId,
  artifactVersionId,
  PostgresArtifactModule,
  type ArtifactModule,
} from '@cmaster/artifacts';
import {
  commandId,
  PostgresConversationModule,
} from '@cmaster/conversations';
import {
  contextInvocationId,
  contextRunId,
  ContextSourceIntegrityError,
  PostgresContextBuilder,
} from '@cmaster/context';
import { type AgentEngine } from '@cmaster/execution';
import { organizationId, PostgresDevelopmentIdentity, principalId } from '@cmaster/identity';
import {
  modelProfileId,
  type ModelEvent,
  type ModelGateway,
  type ModelInvocationRequest,
} from '@cmaster/models';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
let storageRoot: string;

beforeAll(async () => { storageRoot = await mkdtemp(join(tmpdir(), 'cmaster-context-artifact-')); });
afterAll(async () => {
  await pool.end();
  await rm(storageRoot, { recursive: true, force: true });
});

const summary = `## Employee Goal\nReuse prior work\n## Explicit Constraints\nNone\n## Established Facts\nAn Artifact contains prior output\n## Decisions and Commitments\nKeep the exact Version\n## Relevant Artifacts\nPrior Artifact Version\n## Unresolved Items\nTransform the content`;

class ArtifactAwareEngine implements AgentEngine {
  readonly kind = 'ai-sdk' as const;
  readonly version = '1' as const;

  async *execute(input: Parameters<AgentEngine['execute']>[0]) {
    const reference = input.invocationContext?.messages.find((message) => (
      message.role === 'reference' && message.text.includes('Original Version')
    ));
    if (!reference) throw new Error('Pinned Artifact Context was unavailable');
    yield { type: 'text_delta' as const, text: `Transformed: ${reference.text.toUpperCase()}` };
    yield { type: 'completed' as const, artifactReferences: [] };
  }
}

class SummaryGateway implements Pick<ModelGateway, 'stream'> {
  readonly requests: ModelInvocationRequest[] = [];

  async *stream(request: ModelInvocationRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const callId = randomUUID() as never;
    const profile = { id: modelProfileId(randomUUID()), displayName: 'Summary Model' };
    yield { type: 'model_selected', callId, profile, fallback: false };
    yield { type: 'text_delta', text: summary };
    yield {
      type: 'model_completed',
      callId,
      profile,
      usage: { inputTokens: 1_500, outputTokens: 150, totalTokens: 1_650 },
      fallbackUsed: false,
    };
  }
}

async function fixture() {
  const identity = new PostgresDevelopmentIdentity(pool, {
    organizationId: organizationId(randomUUID()),
    organizationName: `Context Artifact ${randomUUID()}`,
    principalId: principalId(randomUUID()),
    principalDisplayName: 'Artifact Context Employee',
  });
  await identity.provision();
  return {
    identity,
    conversations: new PostgresConversationModule(pool),
    artifacts: new PostgresArtifactModule(pool, storageRoot),
  };
}

async function addArtifactTurn(
  test: Awaited<ReturnType<typeof fixture>>,
  conversationId: Parameters<typeof test.conversations.appendAssistantMessage>[0]['conversationId'],
  content: string,
) {
  await test.conversations.appendEmployeeMessage(test.identity.resolveRequest(), conversationId, {
    commandId: commandId(randomUUID()),
    parts: [{ type: 'text', text: 'Create reusable output.' }],
  });
  const created = await test.artifacts.create({
    identity: test.identity.resolveRequest(),
    title: 'Reusable output',
    format: 'markdown',
    content,
    createdByInvocationId: randomUUID(),
    sourceToolCallId: artifactSourceToolCallId(randomUUID()),
  });
  await test.conversations.appendAssistantMessage({
    organizationId: test.identity.resolveRequest().organizationId,
    conversationId,
    sourceRunId: randomUUID(),
    sourceInvocationId: randomUUID(),
    parts: [
      { type: 'text', text: 'Reusable output created.' },
      { type: 'artifact_reference', ...created.reference },
    ],
  });
  return created;
}

describe('historical Artifact Invocation Context', () => {
  it('materializes the pinned Version as low-trust content and verifies authorization and hash on recovery', async () => {
    const test = await fixture();
    const conversation = (await test.conversations.create(test.identity.resolveRequest(), {
      commandId: commandId(randomUUID()),
    })).value;
    const originalContent = '# Original Version\nKeep this exact text.';
    const created = await addArtifactTurn(test, conversation.id, originalContent);
    const trigger = (await test.conversations.appendEmployeeMessage(
      test.identity.resolveRequest(), conversation.id, {
        commandId: commandId(randomUUID()),
        parts: [{ type: 'text', text: 'Transform the prior exact Artifact.' }],
      },
    )).value;
    const builder = new PostgresContextBuilder(pool, test.conversations, undefined, test.artifacts);
    const built = await builder.build({
      organizationId: test.identity.resolveRequest().organizationId,
      principalId: test.identity.resolveRequest().principalId,
      invocationId: contextInvocationId(randomUUID()),
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      modelBudget: { strictestContextWindowTokens: 65_536, maximumOutputTokens: 16_384 },
      fixedOverheadTokens: 256,
    });

    expect(built.invocationContext.messages).toContainEqual({
      role: 'reference', text: originalContent, trustClass: 'reference',
    });
    expect(built.manifest.items).toContainEqual(expect.objectContaining({
      sourceKind: 'artifact',
      artifactId: created.artifact.id,
      sourceId: created.version.id,
      trustClass: 'reference',
      inclusionMode: 'verbatim',
    }));
    expect(JSON.stringify(built.manifest)).not.toContain(originalContent);

    await test.artifacts.createVersion({
      identity: test.identity.resolveRequest(),
      artifactId: created.artifact.id,
      format: 'markdown',
      content: '# New Version\nMust not replace history.',
      createdByInvocationId: randomUUID(),
      sourceToolCallId: artifactSourceToolCallId(randomUUID()),
    });
    await expect(builder.materialize({
      organizationId: test.identity.resolveRequest().organizationId,
      principalId: test.identity.resolveRequest().principalId,
      manifestId: built.manifest.id,
    })).resolves.toEqual(built.invocationContext);

    const transformed: string[] = [];
    for await (const event of new ArtifactAwareEngine().execute({
      organizationId: test.identity.resolveRequest().organizationId,
      runId: randomUUID() as never,
      invocationId: randomUUID() as never,
      agentRevisionId: agentRevisionId(randomUUID()),
      prompt: 'Transform the prior exact Artifact.',
      invocationContext: built.invocationContext,
    })) {
      if (event.type === 'text_delta') transformed.push(event.text);
    }
    expect(transformed.join('')).toContain('Transformed: # ORIGINAL VERSION');

    const other = new PostgresDevelopmentIdentity(pool, {
      organizationId: test.identity.resolveRequest().organizationId,
      organizationName: 'Existing Organization',
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Other Employee',
    });
    await other.provision();
    await expect(builder.materialize({
      organizationId: other.resolveRequest().organizationId,
      principalId: other.resolveRequest().principalId,
      manifestId: built.manifest.id,
    })).rejects.toBeInstanceOf(ContextSourceIntegrityError);

    const changedArtifacts: Pick<ArtifactModule, 'get' | 'open'> = {
      get: (query) => test.artifacts.get(query),
      async open(query) {
        const opened = await test.artifacts.open(query);
        return {
          ...opened,
          bytes: (async function* () { yield Buffer.from('changed content'); })(),
        };
      },
    };
    const changedBuilder = new PostgresContextBuilder(
      pool, test.conversations, undefined, changedArtifacts,
    );
    await expect(changedBuilder.materialize({
      organizationId: test.identity.resolveRequest().organizationId,
      principalId: test.identity.resolveRequest().principalId,
      manifestId: built.manifest.id,
    })).rejects.toBeInstanceOf(ContextSourceIntegrityError);
  });

  it('keeps unsupported Artifact content out of model text while retaining safe provenance', async () => {
    const test = await fixture();
    const conversation = (await test.conversations.create(test.identity.resolveRequest(), {
      commandId: commandId(randomUUID()),
    })).value;
    const unsupportedArtifactId = artifactId(randomUUID());
    const unsupportedVersionId = artifactVersionId(randomUUID());
    await test.conversations.appendAssistantMessage({
      organizationId: test.identity.resolveRequest().organizationId,
      conversationId: conversation.id,
      sourceRunId: randomUUID(),
      sourceInvocationId: randomUUID(),
      parts: [
        { type: 'text', text: 'Binary output is available.' },
        {
          type: 'artifact_reference',
          artifactId: unsupportedArtifactId,
          artifactVersionId: unsupportedVersionId,
        },
      ],
    });
    const trigger = (await test.conversations.appendEmployeeMessage(
      test.identity.resolveRequest(), conversation.id, {
        commandId: commandId(randomUUID()),
        parts: [{ type: 'text', text: 'Use only supported context.' }],
      },
    )).value;
    let contentReads = 0;
    const unsupportedArtifacts: Pick<ArtifactModule, 'get' | 'open'> = {
      async get() {
        return {
          artifact: {
            id: unsupportedArtifactId,
            organizationId: test.identity.resolveRequest().organizationId,
            title: 'Binary',
            kind: 'binary' as never,
            createdForPrincipalId: test.identity.resolveRequest().principalId,
            currentVersionNumber: 1,
            createdAt: new Date(),
          },
          versions: [{
            id: unsupportedVersionId,
            artifactId: unsupportedArtifactId,
            contentId: randomUUID() as never,
            versionNumber: 1,
            mediaType: 'application/pdf' as never,
            sizeBytes: 100,
            createdByInvocationId: randomUUID(),
            sourceToolCallId: artifactSourceToolCallId(randomUUID()),
            createdAt: new Date(),
          }],
        };
      },
      async open() {
        contentReads += 1;
        throw new Error('Unsupported content must not be opened');
      },
    };
    const builder = new PostgresContextBuilder(
      pool, test.conversations, undefined, unsupportedArtifacts,
    );
    const built = await builder.build({
      organizationId: test.identity.resolveRequest().organizationId,
      principalId: test.identity.resolveRequest().principalId,
      invocationId: contextInvocationId(randomUUID()),
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      modelBudget: { strictestContextWindowTokens: 65_536, maximumOutputTokens: 16_384 },
      fixedOverheadTokens: 256,
    });
    expect(contentReads).toBe(0);
    expect(built.manifest.items).toContainEqual(expect.objectContaining({
      sourceKind: 'artifact',
      artifactId: unsupportedArtifactId,
      sourceId: unsupportedVersionId,
      inclusionMode: 'reference_only',
    }));
    expect(built.invocationContext.messages).not.toContainEqual(expect.objectContaining({
      role: 'reference',
    }));
  });

  it('keeps a recent Turn with its Artifact or summarizes both as one older source span', async () => {
    const test = await fixture();
    const conversation = (await test.conversations.create(test.identity.resolveRequest(), {
      commandId: commandId(randomUUID()),
    })).value;
    const oldArtifactContent = `Prior Artifact ${'a'.repeat(1_200)}`;
    const created = await addArtifactTurn(test, conversation.id, oldArtifactContent);
    await test.conversations.appendEmployeeMessage(test.identity.resolveRequest(), conversation.id, {
      commandId: commandId(randomUUID()),
      parts: [{ type: 'text', text: `recent request ${'b'.repeat(500)}` }],
    });
    await test.conversations.appendAssistantMessage({
      organizationId: test.identity.resolveRequest().organizationId,
      conversationId: conversation.id,
      sourceRunId: randomUUID(),
      sourceInvocationId: randomUUID(),
      parts: [{ type: 'text', text: `recent answer ${'c'.repeat(500)}` }],
    });
    const trigger = (await test.conversations.appendEmployeeMessage(
      test.identity.resolveRequest(), conversation.id, {
        commandId: commandId(randomUUID()),
        parts: [{ type: 'text', text: 'Use the prior work.' }],
      },
    )).value;
    const models = new SummaryGateway();
    const builder = new PostgresContextBuilder(pool, test.conversations, models, test.artifacts);
    const built = await builder.build({
      organizationId: test.identity.resolveRequest().organizationId,
      principalId: test.identity.resolveRequest().principalId,
      invocationId: contextInvocationId(randomUUID()),
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      modelBudget: { strictestContextWindowTokens: 6_396, maximumOutputTokens: 100 },
      fixedOverheadTokens: 100,
      summaryExecution: { runId: contextRunId(randomUUID()), signal: new AbortController().signal },
    });

    expect(models.requests[0]?.prompt).toContain(oldArtifactContent);
    expect(built.manifest.items).toContainEqual(expect.objectContaining({
      sourceKind: 'artifact',
      artifactId: created.artifact.id,
      sourceId: created.version.id,
      inclusionMode: 'summary',
    }));
    expect(built.invocationContext.messages[0]).toEqual({
      role: 'reference', text: summary, trustClass: 'reference',
    });
    expect(JSON.stringify(built.invocationContext)).not.toContain(oldArtifactContent);
    expect(JSON.stringify(built.invocationContext)).toContain('recent request');
  });
});
