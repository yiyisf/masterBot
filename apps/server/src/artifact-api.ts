import {
  artifactContentHeadersSchema,
  artifactVersionSchema,
  artifactViewSchema,
  problemDetailsSchema,
  uuidSchema,
} from '@cmaster/contracts';
import {
  ArtifactNotFoundError,
  ArtifactRangeNotSatisfiableError,
  artifactId,
  artifactVersionId,
  type ArtifactByteRangeRequest,
  type ArtifactModule,
  type ArtifactVersion,
} from '@cmaster/artifacts';
import type { RequestIdentity } from '@cmaster/identity';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RequestIdentitySource } from './governed-agent-tools.js';

export interface ArtifactApiDependencies {
  identity: RequestIdentitySource;
  artifacts: Pick<ArtifactModule, 'get' | 'open'>;
}

function versionContract(version: ArtifactVersion) {
  return artifactVersionSchema.parse({
    id: version.id,
    artifactId: version.artifactId,
    versionNumber: version.versionNumber,
    mediaType: version.mediaType,
    sizeBytes: version.sizeBytes,
    createdAt: version.createdAt.toISOString(),
  });
}

function rangeInteger(value: string, allowZero: boolean): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new ArtifactRangeNotSatisfiableError();
  }
  return parsed;
}

function parseRange(value: string | undefined): ArtifactByteRangeRequest | undefined {
  if (value === undefined) return undefined;
  if (value.includes(',')) throw new ArtifactRangeNotSatisfiableError();
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match) throw new ArtifactRangeNotSatisfiableError();
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (startText === '' && endText === '') throw new ArtifactRangeNotSatisfiableError();
  if (startText === '') return { kind: 'suffix', length: rangeInteger(endText, false) };
  if (endText === '') return { kind: 'open_ended', start: rangeInteger(startText, true) };
  return {
    kind: 'closed',
    start: rangeInteger(startText, true),
    endInclusive: rangeInteger(endText, true),
  };
}

async function bytes(content: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of content) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function notFound(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(404).type('application/problem+json').send(problemDetailsSchema.parse({
    type: 'https://cmaster.internal/problems/not-found',
    title: 'Not Found',
    status: 404,
    detail: 'Artifact was not found.',
    instance: request.url,
  }));
}

function invalidRequest(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(400).type('application/problem+json').send(problemDetailsSchema.parse({
    type: 'https://cmaster.internal/problems/invalid-request',
    title: 'Invalid Request',
    status: 400,
    detail: 'Artifact request is invalid.',
    instance: request.url,
  }));
}

function rangeNotSatisfiable(
  request: FastifyRequest,
  reply: FastifyReply,
  totalSizeBytes?: number,
) {
  if (totalSizeBytes !== undefined) reply.header('Content-Range', `bytes */${totalSizeBytes}`);
  return reply.status(416).type('application/problem+json').send(problemDetailsSchema.parse({
    type: 'https://cmaster.internal/problems/range-not-satisfiable',
    title: 'Range Not Satisfiable',
    status: 416,
    detail: 'Only one satisfiable byte range is supported.',
    instance: request.url,
  }));
}

/** Registers trusted-identity, read-only Artifact metadata and exact Version content routes. */
export function registerArtifactApi(
  app: FastifyInstance,
  dependencies: ArtifactApiDependencies,
): void {
  const pathSchema = z.object({ artifactId: uuidSchema });
  const versionPathSchema = z.object({ artifactId: uuidSchema, artifactVersionId: uuidSchema });
  const view = async (identity: RequestIdentity, artifactIdValue: string) => (
    dependencies.artifacts.get({ identity, artifactId: artifactId(artifactIdValue) })
  );

  app.get('/api/v1/artifacts/:artifactId', async (request, reply) => {
    try {
      const path = pathSchema.parse(request.params);
      const found = await view(dependencies.identity.resolveRequest(), path.artifactId);
      return reply.send(artifactViewSchema.parse({
        artifact: {
          id: found.artifact.id,
          title: found.artifact.title,
          kind: found.artifact.kind,
          currentVersionNumber: found.artifact.currentVersionNumber,
          createdAt: found.artifact.createdAt.toISOString(),
        },
        versions: found.versions.map(versionContract),
      }));
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) return notFound(request, reply);
      if (error instanceof z.ZodError) return invalidRequest(request, reply);
      throw error;
    }
  });

  app.get('/api/v1/artifacts/:artifactId/versions/:artifactVersionId', async (request, reply) => {
    try {
      const path = versionPathSchema.parse(request.params);
      const found = await view(dependencies.identity.resolveRequest(), path.artifactId);
      const version = found.versions.find((candidate) => candidate.id === path.artifactVersionId);
      if (!version) throw new ArtifactNotFoundError();
      return reply.send(versionContract(version));
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) return notFound(request, reply);
      if (error instanceof z.ZodError) return invalidRequest(request, reply);
      throw error;
    }
  });

  app.get('/api/v1/artifacts/:artifactId/versions/:artifactVersionId/content', async (request, reply) => {
    let totalSizeBytes: number | undefined;
    try {
      const path = versionPathSchema.parse(request.params);
      const identity = dependencies.identity.resolveRequest();
      const found = await view(identity, path.artifactId);
      const version = found.versions.find((candidate) => candidate.id === path.artifactVersionId);
      if (!version) throw new ArtifactNotFoundError();
      totalSizeBytes = version.sizeBytes;
      const range = parseRange(typeof request.headers.range === 'string'
        ? request.headers.range
        : undefined);
      const opened = await dependencies.artifacts.open({
        identity,
        artifactId: artifactId(path.artifactId),
        artifactVersionId: artifactVersionId(path.artifactVersionId),
        ...(range ? { range } : {}),
      });
      const body = await bytes(opened.bytes);
      const headers = artifactContentHeadersSchema.parse({
        'accept-ranges': 'bytes',
        'content-length': String(opened.contentLength),
        'content-type': opened.mediaType,
        ...(opened.range ? {
          'content-range': `bytes ${opened.range.start}-${opened.range.endInclusive}/${opened.totalSizeBytes}`,
        } : {}),
      });
      for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) reply.header(name, value);
      }
      return reply.status(opened.range ? 206 : 200).send(body);
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) return notFound(request, reply);
      if (error instanceof ArtifactRangeNotSatisfiableError) {
        return rangeNotSatisfiable(request, reply, totalSizeBytes);
      }
      if (error instanceof z.ZodError) return invalidRequest(request, reply);
      throw error;
    }
  });
}
