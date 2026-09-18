import type { Brand } from '@cmaster/kernel';

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type WorkingRootId = Brand<string, 'WorkingRootId'>;
export type WorkspaceRevisionId = Brand<string, 'WorkspaceRevisionId'>;

export class WorkspaceNotFoundError extends Error {}
export class InvalidWorkspaceCursorError extends Error {}
export class InvalidWorkspacePageLimitError extends Error {}
export class InvalidWorkspaceFilePathError extends Error {}
export class InvalidWorkspaceFileQueryError extends Error {}
export class WorkspaceFileLimitError extends Error {}
export class WorkspaceFileContentUnavailableError extends Error {}
