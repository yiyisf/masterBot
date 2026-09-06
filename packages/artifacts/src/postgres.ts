import { createHash, randomUUID } from 'node:crypto';
import type { OrganizationId, PrincipalId } from '@cmaster/identity';
import type { Pool, PoolClient } from 'pg';
import { LocalArtifactContentStore } from './storage.js';
import {
  ArtifactIdempotencyConflictError,
  ArtifactInputInvalidError,
  ArtifactNotFoundError,
  type Artifact,
  type ArtifactContentId,
  type ArtifactCreateResult,
  type ArtifactId,
  type ArtifactModule,
  type ArtifactSourceToolCallId,
  type ArtifactVersion,
  type ArtifactVersionId,
  type ArtifactView,
  type CreateArtifactCommand,
  type CreateArtifactVersionCommand,
  type GetArtifactQuery,
  type OpenArtifactVersionQuery,
  type OpenedArtifactContent,
} from './types.js';

interface ArtifactRow {
  id: string;
  organization_id: string;
  title: string;
  kind: 'text';
  created_for_principal_id: string;
  current_version_number: number;
  created_at: Date;
}

interface VersionRow {
  id: string;
  artifact_id: string;
  content_id: string;
  version_number: number;
  media_type: ArtifactVersion['mediaType'];
  size_bytes: number;
  created_by_invocation_id: string;
  source_tool_call_id: string;
  source_request_hash: string;
  created_at: Date;
}

interface ArtifactViewRow extends ArtifactRow {
  version_id: string;
  version_artifact_id: string;
  content_id: string;
  version_number: number;
  media_type: ArtifactVersion['mediaType'];
  size_bytes: number;
  created_by_invocation_id: string;
  source_tool_call_id: string;
  source_request_hash: string;
  version_created_at: Date;
}

interface OpenRow {
  media_type: ArtifactVersion['mediaType'];
  size_bytes: number;
  storage_adapter: string;
  storage_ref: string;
}

function mapArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id as ArtifactId,
    organizationId: row.organization_id as OrganizationId,
    title: row.title,
    kind: row.kind,
    createdForPrincipalId: row.created_for_principal_id as PrincipalId,
    currentVersionNumber: row.current_version_number,
    createdAt: row.created_at,
  };
}

function mapVersion(row: VersionRow): ArtifactVersion {
  return {
    id: row.id as ArtifactVersionId,
    artifactId: row.artifact_id as ArtifactId,
    contentId: row.content_id as ArtifactContentId,
    versionNumber: row.version_number,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    createdByInvocationId: row.created_by_invocation_id,
    sourceToolCallId: row.source_tool_call_id as ArtifactSourceToolCallId,
    createdAt: row.created_at,
  };
}

function result(artifact: ArtifactRow, version: VersionRow, replayed: boolean): ArtifactCreateResult {
  return {
    artifact: mapArtifact(artifact),
    version: mapVersion(version),
    reference: {
      artifactId: artifact.id as ArtifactId,
      artifactVersionId: version.id as ArtifactVersionId,
    },
    replayed,
  };
}

type PersistArtifactCommand = CreateArtifactCommand | CreateArtifactVersionCommand;

function mediaType(format: PersistArtifactCommand['format']): ArtifactVersion['mediaType'] {
  return format === 'plain_text'
    ? 'text/plain; charset=utf-8'
    : 'text/markdown; charset=utf-8';
}

function validateTitle(title: string): void {
  const characters = Array.from(title).length;
  if (title.trim().length === 0 || characters > 200) {
    throw new ArtifactInputInvalidError('Artifact title must contain 1 to 200 characters');
  }
}

function requestHash(command: PersistArtifactCommand): string {
  return createHash('sha256').update(JSON.stringify({
    principalId: command.identity.principalId,
    operation: 'artifactId' in command ? 'create_version' : 'create',
    ...('artifactId' in command ? { artifactId: command.artifactId } : { title: command.title }),
    format: command.format,
    contentHash: createHash('sha256').update(command.content, 'utf8').digest('hex'),
    createdByInvocationId: command.createdByInvocationId,
  })).digest('hex');
}

async function findBySource(
  client: PoolClient,
  organizationId: OrganizationId,
  sourceToolCallId: ArtifactSourceToolCallId,
): Promise<{ artifact: ArtifactRow; version: VersionRow } | undefined> {
  const found = await client.query<ArtifactRow & VersionRow & { artifact_created_at: Date }>(
    `SELECT a.*, a.created_at AS artifact_created_at,
       v.id, v.artifact_id, v.content_id, v.version_number,
       c.media_type, c.size_bytes, v.created_by_invocation_id,
       v.source_tool_call_id, v.source_request_hash, v.created_at
     FROM artifact_versions v
     JOIN artifacts a ON a.organization_id = v.organization_id AND a.id = v.artifact_id
     JOIN artifact_contents c ON c.organization_id = v.organization_id AND c.id = v.content_id
     WHERE v.organization_id = $1 AND v.source_tool_call_id = $2`,
    [organizationId, sourceToolCallId],
  );
  const row = found.rows[0];
  if (!row) return undefined;
  return {
    artifact: {
      id: row.artifact_id,
      organization_id: row.organization_id,
      title: row.title,
      kind: row.kind,
      created_for_principal_id: row.created_for_principal_id,
      current_version_number: row.current_version_number,
      created_at: row.artifact_created_at,
    },
    version: row,
  };
}

/** PostgreSQL metadata adapter coordinated with formally promoted local Artifact Content. */
export class PostgresArtifactModule implements ArtifactModule {
  private readonly store: LocalArtifactContentStore;

  constructor(private readonly pool: Pool, storageRoot: string) {
    this.store = new LocalArtifactContentStore(storageRoot);
  }

  async create(command: CreateArtifactCommand): Promise<ArtifactCreateResult> {
    return this.persist(command);
  }

  async createVersion(command: CreateArtifactVersionCommand): Promise<ArtifactCreateResult> {
    return this.persist(command, command.artifactId);
  }

  private async persist(
    command: PersistArtifactCommand,
    existingArtifactId?: ArtifactId,
  ): Promise<ArtifactCreateResult> {
    if ('title' in command) validateTitle(command.title);
    const hash = requestHash(command);
    const replayClient = await this.pool.connect();
    try {
      const replay = await findBySource(
        replayClient, command.identity.organizationId, command.sourceToolCallId,
      );
      if (replay) {
        if (replay.version.source_request_hash !== hash) {
          throw new ArtifactIdempotencyConflictError('Artifact ToolCall was reused with another request');
        }
        return result(replay.artifact, replay.version, true);
      }
    } finally {
      replayClient.release();
    }
    const stored = await this.store.write({
      organizationId: command.identity.organizationId,
      invocationId: command.createdByInvocationId,
      content: command.content,
      mediaType: mediaType(command.format),
    });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `artifact:${command.identity.organizationId}:${command.sourceToolCallId}`,
      ]);
      const replay = await findBySource(
        client, command.identity.organizationId, command.sourceToolCallId,
      );
      if (replay) {
        if (replay.version.source_request_hash !== hash) {
          throw new ArtifactIdempotencyConflictError('Artifact ToolCall was reused with another request');
        }
        await client.query('COMMIT');
        return result(replay.artifact, replay.version, true);
      }

      const contentId = randomUUID();
      const insertedContent = await client.query<{ id: string }>(
        `INSERT INTO artifact_contents (
           id, organization_id, storage_adapter, storage_ref, content_hash, media_type, size_bytes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (organization_id, content_hash, media_type) DO NOTHING
         RETURNING id`,
        [contentId, command.identity.organizationId, stored.storageAdapter, stored.storageRef,
          stored.contentHash, stored.mediaType, stored.sizeBytes],
      );
      const actualContentId = insertedContent.rows[0]?.id ?? (await client.query<{ id: string }>(
        `SELECT id FROM artifact_contents
         WHERE organization_id = $1 AND content_hash = $2 AND media_type = $3`,
        [command.identity.organizationId, stored.contentHash, stored.mediaType],
      )).rows[0]?.id;
      if (!actualContentId) throw new Error('Artifact Content could not be persisted');

      let artifact: ArtifactRow;
      let versionNumber: number;
      if (existingArtifactId) {
        const existing = await client.query<ArtifactRow>(
          `SELECT * FROM artifacts
           WHERE organization_id = $1 AND id = $2 AND created_for_principal_id = $3
           FOR UPDATE`,
          [command.identity.organizationId, existingArtifactId, command.identity.principalId],
        );
        const row = existing.rows[0];
        if (!row) throw new ArtifactNotFoundError();
        versionNumber = row.current_version_number + 1;
        const updated = await client.query<ArtifactRow>(
          `UPDATE artifacts SET current_version_number = $3
           WHERE organization_id = $1 AND id = $2 RETURNING *`,
          [command.identity.organizationId, existingArtifactId, versionNumber],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) throw new ArtifactNotFoundError();
        artifact = updatedRow;
      } else {
        if (!('title' in command)) throw new ArtifactInputInvalidError('New Artifact requires a title');
        versionNumber = 1;
        const inserted = await client.query<ArtifactRow>(
          `INSERT INTO artifacts (
             id, organization_id, title, kind, created_for_principal_id, current_version_number
           ) VALUES ($1, $2, $3, 'text', $4, 1) RETURNING *`,
          [randomUUID(), command.identity.organizationId, command.title, command.identity.principalId],
        );
        const row = inserted.rows[0];
        if (!row) throw new Error('Artifact could not be persisted');
        artifact = row;
      }

      const insertedVersion = await client.query<VersionRow>(
        `INSERT INTO artifact_versions (
           id, organization_id, artifact_id, version_number, content_id,
           created_by_invocation_id, source_tool_call_id, source_request_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *,
           (SELECT media_type FROM artifact_contents WHERE id = $5) AS media_type,
           (SELECT size_bytes FROM artifact_contents WHERE id = $5) AS size_bytes`,
        [randomUUID(), command.identity.organizationId, artifact.id, versionNumber,
          actualContentId, command.createdByInvocationId, command.sourceToolCallId, hash],
      );
      const version = insertedVersion.rows[0];
      if (!version) throw new Error('Artifact Version could not be persisted');
      await client.query('COMMIT');
      return result(artifact, version, false);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(query: GetArtifactQuery): Promise<ArtifactView> {
    const found = await this.pool.query<ArtifactViewRow>(
      `SELECT a.*,
         v.id AS version_id, v.artifact_id AS version_artifact_id,
         v.content_id, v.version_number, c.media_type, c.size_bytes,
         v.created_by_invocation_id, v.source_tool_call_id, v.source_request_hash,
         v.created_at AS version_created_at
       FROM artifacts a
       JOIN artifact_versions v
         ON v.organization_id = a.organization_id AND v.artifact_id = a.id
       JOIN artifact_contents c
         ON c.organization_id = v.organization_id AND c.id = v.content_id
       WHERE a.organization_id = $1 AND a.id = $2 AND a.created_for_principal_id = $3
       ORDER BY v.version_number`,
      [query.identity.organizationId, query.artifactId, query.identity.principalId],
    );
    const first = found.rows[0];
    if (!first) throw new ArtifactNotFoundError();
    return {
      artifact: mapArtifact(first),
      versions: found.rows.map((row) => mapVersion({
        id: row.version_id,
        artifact_id: row.version_artifact_id,
        content_id: row.content_id,
        version_number: row.version_number,
        media_type: row.media_type,
        size_bytes: row.size_bytes,
        created_by_invocation_id: row.created_by_invocation_id,
        source_tool_call_id: row.source_tool_call_id,
        source_request_hash: row.source_request_hash,
        created_at: row.version_created_at,
      })),
    };
  }

  async open(query: OpenArtifactVersionQuery): Promise<OpenedArtifactContent> {
    const opened = await this.pool.query<OpenRow>(
      `SELECT c.media_type, c.size_bytes, c.storage_adapter, c.storage_ref
       FROM artifacts a
       JOIN artifact_versions v
         ON v.organization_id = a.organization_id AND v.artifact_id = a.id
       JOIN artifact_contents c
         ON c.organization_id = v.organization_id AND c.id = v.content_id
       WHERE a.organization_id = $1 AND a.id = $2 AND v.id = $3
         AND a.created_for_principal_id = $4`,
      [query.identity.organizationId, query.artifactId,
        query.artifactVersionId, query.identity.principalId],
    );
    const row = opened.rows[0];
    if (!row || row.storage_adapter !== 'local-content-addressed-v1') {
      throw new ArtifactNotFoundError();
    }
    return {
      mediaType: row.media_type,
      sizeBytes: row.size_bytes,
      bytes: this.store.read(row.storage_ref),
    };
  }
}
