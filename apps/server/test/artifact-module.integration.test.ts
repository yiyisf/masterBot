import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  artifactSourceToolCallId,
  ArtifactIdempotencyConflictError,
  ArtifactInputInvalidError,
  ArtifactNotFoundError,
  ArtifactRangeNotSatisfiableError,
  LocalArtifactContentStore,
  PostgresArtifactModule,
} from '@cmaster/artifacts';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString });
let storageRoot: string;

beforeAll(async () => {
  await pool.query('SELECT 1');
  storageRoot = await mkdtemp(join(tmpdir(), 'cmaster-artifacts-'));
});

afterAll(async () => {
  await pool.end();
  await rm(storageRoot, { recursive: true, force: true });
});

async function identity() {
  const source = new PostgresDevelopmentIdentity(pool, {
    organizationId: organizationId(randomUUID()),
    organizationName: `Artifact Org ${randomUUID()}`,
    principalId: principalId(randomUUID()),
    principalDisplayName: 'Artifact Owner',
  });
  await source.provision();
  return source.resolveRequest();
}

async function content(opened: Awaited<ReturnType<PostgresArtifactModule['open']>>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of opened.bytes) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

describe('Artifacts Module', () => {
  it('creates immutable private content and replays the same source ToolCall after restart', async () => {
    const owner = await identity();
    const sourceToolCallId = artifactSourceToolCallId(randomUUID());
    const command = {
      identity: owner,
      title: 'Launch notes',
      format: 'markdown' as const,
      content: '# Launch\nReady.',
      createdByInvocationId: randomUUID(),
      sourceToolCallId,
    };
    const artifacts = new PostgresArtifactModule(pool, storageRoot);

    const created = await artifacts.create(command);
    expect(created).toMatchObject({
      replayed: false,
      artifact: {
        title: 'Launch notes',
        kind: 'text',
        createdForPrincipalId: owner.principalId,
        currentVersionNumber: 1,
      },
      version: {
        versionNumber: 1,
        mediaType: 'text/markdown; charset=utf-8',
        sizeBytes: 15,
        sourceToolCallId,
      },
      reference: {
        artifactId: created.artifact.id,
        artifactVersionId: created.version.id,
      },
    });
    await expect(content(await artifacts.open({
      identity: owner,
      artifactId: created.artifact.id,
      artifactVersionId: created.version.id,
    }))).resolves.toBe('# Launch\nReady.');

    const restarted = new PostgresArtifactModule(pool, storageRoot);
    await expect(restarted.create(command)).resolves.toMatchObject({
      replayed: true,
      reference: created.reference,
    });
    await expect(content(await restarted.open({
      identity: owner,
      artifactId: created.artifact.id,
      artifactVersionId: created.version.id,
    }))).resolves.toBe('# Launch\nReady.');
    const closed = await restarted.open({
      identity: owner,
      artifactId: created.artifact.id,
      artifactVersionId: created.version.id,
      range: { kind: 'closed', start: 2, endInclusive: 7 },
    });
    expect(closed).toMatchObject({
      totalSizeBytes: 15,
      contentLength: 6,
      range: { start: 2, endInclusive: 7 },
    });
    await expect(content(closed)).resolves.toBe('Launch');
    await expect(content(await restarted.open({
      identity: owner,
      artifactId: created.artifact.id,
      artifactVersionId: created.version.id,
      range: { kind: 'open_ended', start: 9 },
    }))).resolves.toBe('Ready.');
    await expect(content(await restarted.open({
      identity: owner,
      artifactId: created.artifact.id,
      artifactVersionId: created.version.id,
      range: { kind: 'suffix', length: 6 },
    }))).resolves.toBe('Ready.');
    await expect(restarted.open({
      identity: owner,
      artifactId: created.artifact.id,
      artifactVersionId: created.version.id,
      range: { kind: 'closed', start: 15, endInclusive: 20 },
    })).rejects.toBeInstanceOf(ArtifactRangeNotSatisfiableError);

    await expect(restarted.create({ ...command, title: 'Changed request' }))
      .rejects.toBeInstanceOf(ArtifactIdempotencyConflictError);
  });

  it('reuses Organization content while preserving immutable Versions and private ownership', async () => {
    const owner = await identity();
    const artifacts = new PostgresArtifactModule(pool, storageRoot);
    const initial = await artifacts.create({
      identity: owner,
      title: 'Reusable text',
      format: 'plain_text',
      content: 'same bytes',
      createdByInvocationId: randomUUID(),
      sourceToolCallId: artifactSourceToolCallId(randomUUID()),
    });
    const duplicate = await artifacts.create({
      identity: owner,
      title: 'Another Artifact',
      format: 'plain_text',
      content: 'same bytes',
      createdByInvocationId: randomUUID(),
      sourceToolCallId: artifactSourceToolCallId(randomUUID()),
    });
    expect(duplicate.artifact.id).not.toBe(initial.artifact.id);
    expect(duplicate.version.contentId).toBe(initial.version.contentId);

    const next = await artifacts.createVersion({
      identity: owner,
      artifactId: initial.artifact.id,
      format: 'markdown',
      content: '**new immutable bytes**',
      createdByInvocationId: randomUUID(),
      sourceToolCallId: artifactSourceToolCallId(randomUUID()),
    });
    expect(next).toMatchObject({
      artifact: { id: initial.artifact.id, currentVersionNumber: 2 },
      version: { versionNumber: 2, mediaType: 'text/markdown; charset=utf-8' },
    });
    await expect(artifacts.get({
      identity: owner,
      artifactId: initial.artifact.id,
    })).resolves.toMatchObject({
      artifact: { currentVersionNumber: 2 },
      versions: [
        { id: initial.version.id, versionNumber: 1 },
        { id: next.version.id, versionNumber: 2 },
      ],
    });
    await expect(content(await artifacts.open({
      identity: owner,
      artifactId: initial.artifact.id,
      artifactVersionId: initial.version.id,
    }))).resolves.toBe('same bytes');
    await expect(content(await artifacts.open({
      identity: owner,
      artifactId: initial.artifact.id,
      artifactVersionId: next.version.id,
    }))).resolves.toBe('**new immutable bytes**');

    const otherPrincipal = new PostgresDevelopmentIdentity(pool, {
      organizationId: owner.organizationId,
      organizationName: 'Ignored Existing Name',
      principalId: principalId(randomUUID()),
      principalDisplayName: 'Other Employee',
    });
    await otherPrincipal.provision();
    await expect(artifacts.open({
      identity: otherPrincipal.resolveRequest(),
      artifactId: initial.artifact.id,
      artifactVersionId: initial.version.id,
    })).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });

  it('rejects invalid title or UTF-8 size without truncation and cleans stale staging files', async () => {
    const owner = await identity();
    const artifacts = new PostgresArtifactModule(pool, storageRoot);
    const base = {
      identity: owner,
      title: 'Bounded output',
      format: 'plain_text' as const,
      createdByInvocationId: randomUUID(),
      sourceToolCallId: artifactSourceToolCallId(randomUUID()),
    };
    await expect(artifacts.create({ ...base, title: '   ', content: 'text' }))
      .rejects.toBeInstanceOf(ArtifactInputInvalidError);
    await expect(artifacts.create({ ...base, title: 'x'.repeat(201), content: 'text' }))
      .rejects.toBeInstanceOf(ArtifactInputInvalidError);
    await expect(artifacts.create({ ...base, content: 'x'.repeat(48 * 1024 + 1) }))
      .rejects.toBeInstanceOf(ArtifactInputInvalidError);
    await expect(artifacts.create({ ...base, content: '\ud800' }))
      .rejects.toBeInstanceOf(ArtifactInputInvalidError);
    await expect(artifacts.create({ ...base, content: 'x'.repeat(48 * 1024) }))
      .resolves.toMatchObject({ version: { sizeBytes: 48 * 1024 } });

    const store = new LocalArtifactContentStore(storageRoot);
    await expect(store.cleanupStaging(new Date(Date.now() + 1_000))).resolves.toBeGreaterThan(0);
  });
});
