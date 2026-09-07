import type { OrganizationId, PrincipalId, RequestIdentity } from '@cmaster/identity';
import {
  artifactSourceToolCallId,
  ArtifactInputInvalidError,
  type ArtifactFormat,
  type ArtifactModule,
} from './types.js';

export const CREATE_TEXT_ARTIFACT_CAPABILITY_ID = 'cmaster.artifact.create_text:v1';
export const CREATE_TEXT_ARTIFACT_REVISION_ID = '00000000-0000-4000-8000-000000000018';
export const SLICE4_ARTIFACT_TOOL_GRANT_ID = '00000000-0000-4000-8000-000000000019';

interface CreateTextInput {
  title: string;
  format: ArtifactFormat;
  content: string;
}

export interface ArtifactToolProviderRequest {
  readonly toolCallId: string;
  readonly invocationId: string;
  readonly input: unknown;
  readonly credentialLease: {
    readonly organizationId: OrganizationId;
    readonly principalId: PrincipalId;
  };
}

export interface ArtifactToolProviderResult {
  readonly kind: 'success';
  readonly value: unknown;
  readonly safeSummary: {
    readonly title: string;
    readonly details: Readonly<Record<string, string>>;
  };
}

function input(value: unknown): CreateTextInput {
  if (!value || typeof value !== 'object'
    || !('title' in value) || typeof value.title !== 'string'
    || !('format' in value) || (value.format !== 'plain_text' && value.format !== 'markdown')
    || !('content' in value) || typeof value.content !== 'string') {
    throw new Error('Artifact title, format, and content are required');
  }
  const bytes = Buffer.from(value.content, 'utf8');
  if (value.title.trim().length === 0 || Array.from(value.title).length > 200) {
    throw new ArtifactInputInvalidError('Artifact title must contain 1 to 200 characters');
  }
  if (bytes.toString('utf8') !== value.content || bytes.byteLength > 48 * 1024) {
    throw new ArtifactInputInvalidError('Artifact content must be valid UTF-8 and at most 48 KiB');
  }
  return { title: value.title, format: value.format, content: value.content };
}

/** Artifact-owned Provider Adapter for the governed create-text Capability. */
export class CreateTextArtifactToolProvider {
  readonly key = 'artifact:create-text-v1';

  constructor(private readonly artifacts: Pick<ArtifactModule, 'create'>) {}

  summarize(value: unknown) {
    const parsed = input(value);
    return {
      title: 'Create a private Text Artifact',
      details: { format: parsed.format },
    };
  }

  async execute(request: ArtifactToolProviderRequest): Promise<ArtifactToolProviderResult> {
    const parsed = input(request.input);
    const identity: RequestIdentity = {
      organizationId: request.credentialLease.organizationId,
      principalId: request.credentialLease.principalId,
      principalType: 'employee',
      displayName: 'Tool initiator',
    };
    const created = await this.artifacts.create({
      identity,
      title: parsed.title,
      format: parsed.format,
      content: parsed.content,
      createdByInvocationId: request.invocationId,
      sourceToolCallId: artifactSourceToolCallId(request.toolCallId),
    });
    const value = {
      artifactId: created.reference.artifactId,
      artifactVersionId: created.reference.artifactVersionId,
      kind: created.artifact.kind,
      versionNumber: created.version.versionNumber,
      mediaType: created.version.mediaType,
    };
    return {
      kind: 'success',
      value,
      safeSummary: {
        title: 'Private Text Artifact created',
        details: {
          kind: created.artifact.kind,
          mediaType: created.version.mediaType,
        },
      },
    };
  }

  reconcile(request: ArtifactToolProviderRequest): Promise<ArtifactToolProviderResult> {
    return this.execute(request);
  }
}

/** Immutable Tool Revision descriptor composed into the Slice 4 Catalog by Server. */
export const createTextArtifactToolRevision = {
  id: CREATE_TEXT_ARTIFACT_REVISION_ID,
  capabilityId: CREATE_TEXT_ARTIFACT_CAPABILITY_ID,
  name: 'create_text_artifact',
  description: 'Creates a durable private plain-text or Markdown Artifact.',
  inputSchema: {
    type: 'object',
    required: ['title', 'format', 'content'],
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      format: { type: 'string', enum: ['plain_text', 'markdown'] },
      content: { type: 'string', maxLength: 48 * 1024 },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['artifactId', 'artifactVersionId', 'kind', 'versionNumber', 'mediaType'],
    additionalProperties: false,
    properties: {
      artifactId: {
        type: 'string',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      },
      artifactVersionId: {
        type: 'string',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      },
      kind: { const: 'text' },
      versionNumber: { const: 1 },
      mediaType: {
        enum: ['text/plain; charset=utf-8', 'text/markdown; charset=utf-8'],
      },
    },
  },
  effect: 'idempotent_write',
  recovery: 'reconcile',
  risks: [],
  providerKey: 'artifact:create-text-v1',
} as const;
