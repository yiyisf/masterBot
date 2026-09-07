import type { OrganizationId, PrincipalId, RequestIdentity } from '@cmaster/identity';
import type { Brand } from '@cmaster/kernel';

export type ArtifactId = Brand<string, 'ArtifactId'>;
export type ArtifactVersionId = Brand<string, 'ArtifactVersionId'>;
export type ArtifactContentId = Brand<string, 'ArtifactContentId'>;
export type ArtifactSourceToolCallId = Brand<string, 'ArtifactSourceToolCallId'>;
export type ArtifactFormat = 'plain_text' | 'markdown';

export interface ArtifactReference {
  readonly artifactId: ArtifactId;
  readonly artifactVersionId: ArtifactVersionId;
}

export interface Artifact {
  readonly id: ArtifactId;
  readonly organizationId: OrganizationId;
  readonly title: string;
  readonly kind: 'text';
  readonly createdForPrincipalId: PrincipalId;
  readonly currentVersionNumber: number;
  readonly createdAt: Date;
}

export interface ArtifactVersion {
  readonly id: ArtifactVersionId;
  readonly artifactId: ArtifactId;
  readonly contentId: ArtifactContentId;
  readonly versionNumber: number;
  readonly mediaType: 'text/plain; charset=utf-8' | 'text/markdown; charset=utf-8';
  readonly sizeBytes: number;
  readonly createdByInvocationId: string;
  readonly sourceToolCallId: ArtifactSourceToolCallId;
  readonly createdAt: Date;
}

export interface ArtifactCreateResult {
  readonly artifact: Artifact;
  readonly version: ArtifactVersion;
  readonly reference: ArtifactReference;
  readonly replayed: boolean;
}

export interface CreateArtifactCommand {
  readonly identity: RequestIdentity;
  readonly title: string;
  readonly format: ArtifactFormat;
  readonly content: string;
  readonly createdByInvocationId: string;
  readonly sourceToolCallId: ArtifactSourceToolCallId;
}

export interface CreateArtifactVersionCommand {
  readonly identity: RequestIdentity;
  readonly artifactId: ArtifactId;
  readonly format: ArtifactFormat;
  readonly content: string;
  readonly createdByInvocationId: string;
  readonly sourceToolCallId: ArtifactSourceToolCallId;
}

export interface GetArtifactQuery {
  readonly identity: RequestIdentity;
  readonly artifactId: ArtifactId;
}

export interface ArtifactView {
  readonly artifact: Artifact;
  readonly versions: readonly ArtifactVersion[];
}

export type ArtifactByteRangeRequest =
  | { readonly kind: 'closed'; readonly start: number; readonly endInclusive: number }
  | { readonly kind: 'open_ended'; readonly start: number }
  | { readonly kind: 'suffix'; readonly length: number };

export interface OpenArtifactVersionQuery {
  readonly identity: RequestIdentity;
  readonly artifactId: ArtifactId;
  readonly artifactVersionId: ArtifactVersionId;
  readonly range?: ArtifactByteRangeRequest;
}

export interface OpenedArtifactContent {
  readonly mediaType: ArtifactVersion['mediaType'];
  readonly totalSizeBytes: number;
  readonly contentLength: number;
  readonly range?: { readonly start: number; readonly endInclusive: number };
  readonly bytes: AsyncIterable<Uint8Array>;
}

/** Owns private Artifact metadata, immutable Versions, content reuse, and authorized reads. */
export interface ArtifactModule {
  create(command: CreateArtifactCommand): Promise<ArtifactCreateResult>;
  createVersion(command: CreateArtifactVersionCommand): Promise<ArtifactCreateResult>;
  get(query: GetArtifactQuery): Promise<ArtifactView>;
  open(query: OpenArtifactVersionQuery): Promise<OpenedArtifactContent>;
}

export class ArtifactInputInvalidError extends Error {}
export class ArtifactIdempotencyConflictError extends Error {}
export class ArtifactNotFoundError extends Error {}
export class ArtifactRangeNotSatisfiableError extends Error {}

export function artifactId(value: string): ArtifactId {
  return value as ArtifactId;
}

export function artifactVersionId(value: string): ArtifactVersionId {
  return value as ArtifactVersionId;
}

export function artifactSourceToolCallId(value: string): ArtifactSourceToolCallId {
  return value as ArtifactSourceToolCallId;
}
