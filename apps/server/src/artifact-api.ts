import {
  artifactContentHeadersSchema,
  artifactPageSchema,
  artifactVersionPageSchema,
  artifactVersionSchema,
  artifactViewSchema,
  problemDetailsSchema,
  uuidSchema,
} from '@cmaster/contracts';
import {
  ArtifactNotFoundError,
  ArtifactRangeNotSatisfiableError,
  InvalidArtifactCursorError,
  artifactId,
  artifactVersionId,
  type Artifact,
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
  artifacts: Pick<ArtifactModule, 'get' | 'getVersion' | 'list' | 'listVersions' | 'open'>;
}

function artifactContract(artifact: Artifact) {
  return {
    id: artifact.id,
    title: artifact.title,
    kind: artifact.kind,
    currentVersionNumber: artifact.currentVersionNumber,
    createdAt: artifact.createdAt.toISOString(),
  };
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

function downloadExtension(mediaType: string): string {
  const normalized = mediaType.split(';', 1)[0]?.trim().toLowerCase();
  const known: Readonly<Record<string, string>> = {
    'text/plain': '.txt', 'text/markdown': '.md', 'application/pdf': '.pdf',
    'application/json': '.json', 'text/csv': '.csv', 'text/html': '.html',
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
    'audio/mpeg': '.mp3', 'video/mp4': '.mp4', 'application/zip': '.zip',
  };
  return normalized ? known[normalized] ?? '.bin' : '.bin';
}

function downloadDisposition(title: string, mediaType: string): string {
  const extension = downloadExtension(mediaType);
  const unicodeBase = Array.from(title.normalize('NFC').replace(/[\u0000-\u001f\u007f/\\]/gu, '_'))
    .slice(0, 32).join('').replace(/^[.\s]+|[.\s]+$/gu, '') || 'artifact';
  const asciiBase = unicodeBase.normalize('NFKD').replace(/[^\x20-\x7e]/gu, '')
    .replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^[.-]+|[.-]+$/gu, '') || 'artifact';
  const unicodeName = `${unicodeBase}${extension}`;
  const asciiName = `${asciiBase}${extension}`;
  const encodedName = encodeURIComponent(unicodeName).replace(/[!'()*]/gu, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
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

  app.get('/api/v1/artifacts', async (request, reply) => {
    try {
      const query = z.object({
        cursor: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }).parse(request.query);
      const page = await dependencies.artifacts.list({
        identity: dependencies.identity.resolveRequest(), limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
      return reply.send(artifactPageSchema.parse({
        items: page.items.map((item) => ({
          artifact: artifactContract(item.artifact),
          currentVersion: versionContract(item.currentVersion),
        })),
        nextCursor: page.nextCursor ?? null,
      }));
    } catch (error) {
      if (error instanceof InvalidArtifactCursorError || error instanceof z.ZodError) {
        return invalidRequest(request, reply);
      }
      throw error;
    }
  });

  app.get('/api/v1/artifacts/:artifactId', async (request, reply) => {
    try {
      const path = pathSchema.parse(request.params);
      const found = await view(dependencies.identity.resolveRequest(), path.artifactId);
      return reply.send(artifactViewSchema.parse({
        artifact: artifactContract(found.artifact),
        versions: found.versions.map(versionContract),
      }));
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) return notFound(request, reply);
      if (error instanceof z.ZodError) return invalidRequest(request, reply);
      throw error;
    }
  });

  app.get('/api/v1/artifacts/:artifactId/versions', async (request, reply) => {
    try {
      const path = pathSchema.parse(request.params);
      const query = z.object({
        beforeVersionNumber: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(50),
      }).parse(request.query);
      const page = await dependencies.artifacts.listVersions({
        identity: dependencies.identity.resolveRequest(),
        artifactId: artifactId(path.artifactId), limit: query.limit,
        ...(query.beforeVersionNumber === undefined
          ? {} : { beforeVersionNumber: query.beforeVersionNumber }),
      });
      return reply.send(artifactVersionPageSchema.parse({
        artifact: artifactContract(page.artifact),
        items: page.items.map(versionContract),
        beforeVersionNumber: page.beforeVersionNumber ?? null,
      }));
    } catch (error) {
      if (error instanceof ArtifactNotFoundError) return notFound(request, reply);
      if (error instanceof InvalidArtifactCursorError || error instanceof z.ZodError) {
        return invalidRequest(request, reply);
      }
      throw error;
    }
  });

  app.get('/api/v1/artifacts/:artifactId/versions/:artifactVersionId', async (request, reply) => {
    try {
      const path = versionPathSchema.parse(request.params);
      const found = await dependencies.artifacts.getVersion({
        identity: dependencies.identity.resolveRequest(),
        artifactId: artifactId(path.artifactId),
        artifactVersionId: artifactVersionId(path.artifactVersionId),
      });
      return reply.send(versionContract(found.version));
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
      const query = z.object({
        disposition: z.enum(['inline', 'attachment']).default('inline'),
      }).parse(request.query);
      const identity = dependencies.identity.resolveRequest();
      const found = await dependencies.artifacts.getVersion({
        identity,
        artifactId: artifactId(path.artifactId),
        artifactVersionId: artifactVersionId(path.artifactVersionId),
      });
      totalSizeBytes = found.version.sizeBytes;
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
        ...(query.disposition === 'attachment' ? {
          'content-disposition': downloadDisposition(found.artifact.title, opened.mediaType),
        } : {}),
        'x-content-type-options': 'nosniff',
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
