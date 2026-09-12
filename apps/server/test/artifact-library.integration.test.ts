import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  artifactSourceToolCallId,
  PostgresArtifactModule,
} from '@cmaster/artifacts';
import { organizationId, PostgresDevelopmentIdentity, principalId } from '@cmaster/identity';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
let storageRoot: string;
const organization = organizationId(randomUUID());
const owner = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Artifact Library',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Artifact Owner',
});
const colleague = new PostgresDevelopmentIdentity(pool, {
  organizationId: organization,
  organizationName: 'Artifact Library',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Artifact Colleague',
});
const outsider = new PostgresDevelopmentIdentity(pool, {
  organizationId: organizationId(randomUUID()),
  organizationName: 'Other Organization',
  principalId: principalId(randomUUID()),
  principalDisplayName: 'Outside Reader',
});

beforeAll(async () => {
  storageRoot = await mkdtemp(join(tmpdir(), 'cmaster-artifact-library-'));
  await owner.provision();
  await colleague.provision();
  await outsider.provision();
});
afterAll(async () => {
  await pool.end();
  await rm(storageRoot, { recursive: true, force: true });
});

async function createArtifact(artifacts: PostgresArtifactModule, title: string) {
  return artifacts.create({
    identity: owner.resolveRequest(), title, format: 'plain_text', content: title,
    createdByInvocationId: randomUUID(),
    sourceToolCallId: artifactSourceToolCallId(randomUUID()),
  });
}

describe('private Artifact Library queries', () => {
  it('pages stable owner-only summaries that pin the exact current Version', async () => {
    const artifacts = new PostgresArtifactModule(pool, storageRoot);
    const first = await createArtifact(artifacts, 'First result');
    await createArtifact(artifacts, 'Second result');
    const third = await createArtifact(artifacts, 'Third result');
    const updated = await artifacts.createVersion({
      identity: owner.resolveRequest(), artifactId: third.artifact.id,
      format: 'markdown', content: '# Third result, revised',
      createdByInvocationId: randomUUID(),
      sourceToolCallId: artifactSourceToolCallId(randomUUID()),
    });

    const newest = await artifacts.list({ identity: owner.resolveRequest(), limit: 2 });
    expect(newest.items.map((item) => item.artifact.title)).toEqual([
      'Third result', 'Second result',
    ]);
    expect(newest.items[0]?.currentVersion).toMatchObject({
      id: updated.version.id, versionNumber: 2,
      mediaType: 'text/markdown; charset=utf-8',
    });
    const cursor = newest.nextCursor;
    if (!cursor) throw new Error('Expected an older Artifact cursor');
    const older = await artifacts.list({
      identity: owner.resolveRequest(), cursor, limit: 2,
    });
    expect(older.items.map((item) => item.artifact.id)).toEqual([first.artifact.id]);
    expect(older.nextCursor).toBeUndefined();

    await expect(artifacts.list({ identity: colleague.resolveRequest(), limit: 20 }))
      .resolves.toEqual({ items: [] });
    await expect(artifacts.list({ identity: outsider.resolveRequest(), limit: 20 }))
      .resolves.toEqual({ items: [] });
  });

  it('returns bounded immutable Version metadata newest first', async () => {
    const artifacts = new PostgresArtifactModule(pool, storageRoot);
    const created = await createArtifact(artifacts, 'Versioned result');
    const second = await artifacts.createVersion({
      identity: owner.resolveRequest(), artifactId: created.artifact.id,
      format: 'markdown', content: 'second', createdByInvocationId: randomUUID(),
      sourceToolCallId: artifactSourceToolCallId(randomUUID()),
    });
    await expect(artifacts.getVersion({
      identity: owner.resolveRequest(), artifactId: created.artifact.id,
      artifactVersionId: created.version.id,
    })).resolves.toMatchObject({
      artifact: { id: created.artifact.id },
      version: { id: created.version.id, versionNumber: 1 },
    });
    await expect(artifacts.getVersion({
      identity: colleague.resolveRequest(), artifactId: created.artifact.id,
      artifactVersionId: created.version.id,
    })).rejects.toThrow();
    const page = await artifacts.listVersions({
      identity: owner.resolveRequest(), artifactId: created.artifact.id, limit: 1,
    });
    expect(page).toEqual({
      artifact: second.artifact,
      items: [second.version],
      beforeVersionNumber: 2,
    });
    await expect(artifacts.listVersions({
      identity: colleague.resolveRequest(), artifactId: created.artifact.id, limit: 20,
    })).rejects.toThrow();
  });
});
