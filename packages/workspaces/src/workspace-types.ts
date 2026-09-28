import type { Brand } from '@cmaster/kernel';

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type WorkspaceOperationMode =
  | 'observe'
  | 'edit_with_confirmation'
  | 'trusted_automation';
export type WorkingRootId = Brand<string, 'WorkingRootId'>;
export type WorkspaceRevisionId = Brand<string, 'WorkspaceRevisionId'>;

export interface WorkspaceFileEntry {
  readonly path: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export class WorkspaceFileNotFoundError extends Error {}

export class WorkspaceRevisionContentError extends Error {
  constructor(readonly code: 'content_unavailable' | 'content_limit_exceeded') {
    super(code);
  }
}

export class WorkspaceIdempotencyConflictError extends Error {}
export class WorkspaceNotFoundError extends Error {}
export class InvalidWorkspaceCursorError extends Error {}
export class InvalidWorkspacePageLimitError extends Error {}
export class InvalidWorkspaceFilePathError extends Error {}
export class InvalidWorkspaceFileQueryError extends Error {}
export class WorkspaceFileLimitError extends Error {}
export class WorkspaceFileContentUnavailableError extends Error {}
