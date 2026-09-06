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
import { buildApi } from '../src/app.js';
import { loadServerConfig } from '../src/config.js';
import { InMemoryFeatureFlags } from '../src/feature-flags.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
let storageRoot: string;

beforeAll(async () => { storageRoot = await mkdtemp(join(tmpdir(), 'cmaster-artifact-api-')); });
afterAll(async () => {
  await pool.end();
  await rm(storageRoot, { recursive: true, force: true });
});

const config = loadServerConfig({
  DATABASE_URL: databaseUrl,
  CMASTER_SERVER_ROLE: 'api',
  CMASTER_RUNTIME_ENV: 'test',
  NEXT_ARCHITECTURE_ENABLED: 'true',
  CMASTER_DEVELOPMENT_IDENTITY_ENABLED: 'true',
}, []);

async function identity(organizationIdValue = organizationId(randomUUID())) {
  const source = new PostgresDevelopmentIdentity(pool, {
    organizationId: organizationIdValue,
    organizationName: `Artifact API ${randomUUID()}`,
    principalId: principalId(randomUUID()),
    principalDisplayName: 'Artifact Reader',
  });
  await source.provision();
  return source;
}

describe('private Artifact REST reads', () => {
  it('serves authorized metadata and complete/closed/open/suffix content without leaking storage data', async () => {
    const owner = await identity();
    const artifacts = new PostgresArtifactModule(pool, storageRoot);
    const created = await artifacts.create({
      identity: owner.resolveRequest(),
      title: 'Readable Artifact',
      format: 'plain_text',
      content: '0123456789',
      createdByInvocationId: randomUUID(),
      sourceToolCallId: artifactSourceToolCallId(randomUUID()),
    });
    let requestIdentity = owner.resolveRequest();
    const app = buildApi({
      config,
      database: { check: async () => true },
      featureFlags: new InMemoryFeatureFlags({
        nextArchitecture: true, toolRuntime: false, contextArtifacts: true,
      }),
      artifactApi: { identity: { resolveRequest: () => requestIdentity }, artifacts },
    });
    const base = `/api/v1/artifacts/${created.artifact.id}`;
    const exact = `${base}/versions/${created.version.id}`;

    const metadata = await app.inject({ method: 'GET', url: base });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json()).toMatchObject({
      artifact: { id: created.artifact.id, title: 'Readable Artifact', kind: 'text' },
      versions: [{ id: created.version.id, versionNumber: 1, sizeBytes: 10 }],
    });
    expect(JSON.stringify(metadata.json())).not.toMatch(/hash|storage|path|provider/i);
    expect((await app.inject({ method: 'GET', url: exact })).json()).toMatchObject({
      id: created.version.id,
      artifactId: created.artifact.id,
      mediaType: 'text/plain; charset=utf-8',
      sizeBytes: 10,
    });

    const complete = await app.inject({ method: 'GET', url: `${exact}/content` });
    expect(complete.statusCode).toBe(200);
    expect(complete.body).toBe('0123456789');
    expect(complete.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'content-length': '10',
      'content-type': 'text/plain; charset=utf-8',
    });
    const ranges = [
      { value: 'bytes=2-5', body: '2345', contentRange: 'bytes 2-5/10' },
      { value: 'bytes=7-', body: '789', contentRange: 'bytes 7-9/10' },
      { value: 'bytes=-3', body: '789', contentRange: 'bytes 7-9/10' },
    ];
    for (const range of ranges) {
      const response = await app.inject({
        method: 'GET', url: `${exact}/content`, headers: { range: range.value },
      });
      expect(response.statusCode).toBe(206);
      expect(response.body).toBe(range.body);
      expect(response.headers['content-range']).toBe(range.contentRange);
      expect(response.headers['content-length']).toBe(String(Buffer.byteLength(range.body)));
    }
    for (const range of [
      'bytes=20-30',
      'bytes=5-2',
      'bytes=-0',
      'bytes=999999999999999999999-',
      'bytes=0-1,4-5',
      'items=0-1',
    ]) {
      const response = await app.inject({
        method: 'GET', url: `${exact}/content`, headers: { range },
      });
      expect(response.statusCode).toBe(416);
      expect(response.headers['content-range']).toBe('bytes */10');
    }

    const sameOrganizationOtherPrincipal = await identity(owner.resolveRequest().organizationId);
    requestIdentity = sameOrganizationOtherPrincipal.resolveRequest();
    expect((await app.inject({ method: 'GET', url: base })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: exact })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${exact}/content` })).statusCode).toBe(404);
    requestIdentity = (await identity()).resolveRequest();
    expect((await app.inject({ method: 'GET', url: base })).statusCode).toBe(404);
    await app.close();

    const disabled = buildApi({
      config,
      database: { check: async () => true },
      featureFlags: new InMemoryFeatureFlags({
        nextArchitecture: true, toolRuntime: false, contextArtifacts: false,
      }),
    });
    expect((await disabled.inject({ method: 'GET', url: base })).statusCode).toBe(404);
    await disabled.close();
  });
});
