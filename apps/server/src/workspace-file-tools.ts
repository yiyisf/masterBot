import { createHash } from 'node:crypto';
import type { AgentRevisionId } from '@cmaster/agents';
import type { WorkspaceFileContextRecorder } from '@cmaster/context';
import type { EngineInvocation } from '@cmaster/execution';
import type { OrganizationId, RequestIdentity } from '@cmaster/identity';
import {
  toolGrantId,
  toolRevisionId,
  type ToolCatalogProvisioning,
  type ToolProvider,
  type ToolProviderRequest,
  type ToolDescriptor,
  type ToolOutcome,
  type ToolPolicyResourceRequest,
  type ToolProviderResult,
} from '@cmaster/tools';
import {
  WorkspaceChangeConflictError,
  workspaceChangeCommandId,
  workspaceInvocationId,
  workspaceOverlayCommandId,
  type WorkspaceChangeSet,
  type WorkspaceChangeSetId,
  type WorkspaceChanges,
  type WorkspaceFileContent,
  type WorkspaceRunEnvironments,
} from '@cmaster/workspaces';
import type { GovernedToolOutcomeObserver } from './governed-agent-tools.js';

export const LIST_WORKSPACE_FILES_CAPABILITY_ID = 'cmaster.workspace.list_files:v1';
export const SEARCH_WORKSPACE_FILES_CAPABILITY_ID = 'cmaster.workspace.search_files:v1';
export const OPEN_WORKSPACE_FILE_CAPABILITY_ID = 'cmaster.workspace.open_file:v1';
export const WRITE_WORKSPACE_FILE_CAPABILITY_ID = 'cmaster.workspace.write_file:v1';
export const DELETE_WORKSPACE_FILE_CAPABILITY_ID = 'cmaster.workspace.delete_file:v1';
export const PROPOSE_WORKSPACE_CHANGES_CAPABILITY_ID = 'cmaster.workspace.propose_changes:v1';
export const APPLY_WORKSPACE_CHANGES_CAPABILITY_ID = 'cmaster.workspace.apply_changes:v1';
export const WORKSPACE_FILE_TOOL_PROVIDER_KEY = 'builtin:workspace-files';
export const WORKSPACE_CHANGE_APPLY_TOOL_PROVIDER_KEY = 'builtin:workspace-change-apply';
const maximumToolOpenBytes = 8 * 1024;
const maximumToolWriteCharacters = 16 * 1024;

const workspacePathJsonSchema = {
  type: 'string', minLength: 1, maxLength: 1024,
  pattern: '^(?!/)(?!.*//)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*\\\\)(?!.*[\\u0000-\\u001f\\u007f]).+$',
} as const;
const workspaceFileEntryProperties = {
  path: workspacePathJsonSchema,
  mediaType: { type: 'string', minLength: 1, maxLength: 100 },
  sizeBytes: { type: 'integer', minimum: 0, maximum: 1_048_576 },
  sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
} as const;
const workspaceFileEntryJsonSchema = {
  type: 'object', required: ['path', 'mediaType', 'sizeBytes', 'sha256'],
  additionalProperties: false,
  properties: workspaceFileEntryProperties,
} as const;

function catalogId(organizationId: OrganizationId, value: string): string {
  const hex = createHash('sha256').update(`${organizationId}:${value}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function workspaceFileToolCatalog(
  organizationId: OrganizationId,
  agentRevisionId: AgentRevisionId,
): ToolCatalogProvisioning {
  return {
    revisions: [
      {
        id: toolRevisionId(catalogId(organizationId, LIST_WORKSPACE_FILES_CAPABILITY_ID)),
        capabilityId: LIST_WORKSPACE_FILES_CAPABILITY_ID,
        name: 'workspace_list_files',
        description: 'Lists bounded visible files in this Invocation’s fixed Workspace Revision.',
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: {
            cursor: { type: 'string', minLength: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 20 },
          },
        },
        outputSchema: {
          type: 'object', required: ['items'], additionalProperties: false,
          properties: {
            items: { type: 'array', maxItems: 20, items: workspaceFileEntryJsonSchema },
            nextCursor: { type: 'string', minLength: 1 },
          },
        },
        effect: 'read_only', recovery: 'retry_same_call', risks: ['handles_sensitive_data'],
        providerKey: WORKSPACE_FILE_TOOL_PROVIDER_KEY,
      },
      {
        id: toolRevisionId(catalogId(organizationId, SEARCH_WORKSPACE_FILES_CAPABILITY_ID)),
        capabilityId: SEARCH_WORKSPACE_FILES_CAPABILITY_ID,
        name: 'workspace_search_files',
        description: 'Searches bounded visible text in this Invocation’s fixed Workspace Revision.',
        inputSchema: {
          type: 'object', required: ['query'], additionalProperties: false,
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 200 },
            cursor: { type: 'string', minLength: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 10 },
          },
        },
        outputSchema: {
          type: 'object', required: ['items'], additionalProperties: false,
          properties: {
            items: {
              type: 'array', maxItems: 10,
              items: {
                type: 'object', required: ['path', 'line', 'column', 'preview'],
                additionalProperties: false,
                properties: {
                  path: workspacePathJsonSchema,
                  line: { type: 'integer', minimum: 1 },
                  column: { type: 'integer', minimum: 1 },
                  preview: { type: 'string', maxLength: 500 },
                },
              },
            },
            nextCursor: { type: 'string', minLength: 1 },
          },
        },
        effect: 'read_only', recovery: 'retry_same_call', risks: ['handles_sensitive_data'],
        providerKey: WORKSPACE_FILE_TOOL_PROVIDER_KEY,
      },
      {
        id: toolRevisionId(catalogId(organizationId, OPEN_WORKSPACE_FILE_CAPABILITY_ID)),
        capabilityId: OPEN_WORKSPACE_FILE_CAPABILITY_ID,
        name: 'workspace_open_file',
        description: 'Opens one visible text file from this Invocation’s fixed Workspace Revision.',
        inputSchema: {
          type: 'object', required: ['path'], additionalProperties: false,
          properties: { path: workspacePathJsonSchema },
        },
        outputSchema: {
          type: 'object',
          required: ['path', 'mediaType', 'sizeBytes', 'sha256', 'encoding', 'content'],
          additionalProperties: false,
          properties: {
            ...workspaceFileEntryProperties,
            encoding: { const: 'utf8' },
            content: { type: 'string', maxLength: maximumToolOpenBytes },
          },
        },
        effect: 'read_only', recovery: 'retry_same_call', risks: ['handles_sensitive_data'],
        providerKey: WORKSPACE_FILE_TOOL_PROVIDER_KEY,
      },
      {
        id: toolRevisionId(catalogId(organizationId, WRITE_WORKSPACE_FILE_CAPABILITY_ID)),
        capabilityId: WRITE_WORKSPACE_FILE_CAPABILITY_ID,
        name: 'workspace_write_file',
        description: 'Writes bounded UTF-8 text only to this Invocation’s private overlay.',
        inputSchema: {
          type: 'object', required: ['path', 'content'], additionalProperties: false,
          properties: {
            path: workspacePathJsonSchema,
            content: { type: 'string', maxLength: maximumToolWriteCharacters },
          },
        },
        outputSchema: {
          type: 'object', required: ['kind', 'path', 'changed'],
          additionalProperties: false,
          properties: {
            kind: { enum: ['write', 'delete', 'none'] },
            path: workspacePathJsonSchema,
            changed: { type: 'boolean' },
            mediaType: { type: 'string', minLength: 1, maxLength: 100 },
            sizeBytes: { type: 'integer', minimum: 0, maximum: 1_048_576 },
            sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          },
        },
        effect: 'idempotent_write', recovery: 'retry_same_call', risks: ['handles_sensitive_data'],
        providerKey: WORKSPACE_FILE_TOOL_PROVIDER_KEY,
      },
      {
        id: toolRevisionId(catalogId(organizationId, DELETE_WORKSPACE_FILE_CAPABILITY_ID)),
        capabilityId: DELETE_WORKSPACE_FILE_CAPABILITY_ID,
        name: 'workspace_delete_file',
        description: 'Marks one visible file deleted only in this Invocation’s private overlay.',
        inputSchema: {
          type: 'object', required: ['path'], additionalProperties: false,
          properties: { path: workspacePathJsonSchema },
        },
        outputSchema: {
          type: 'object', required: ['kind', 'path', 'changed'],
          additionalProperties: false,
          properties: {
            kind: { enum: ['write', 'delete', 'none'] },
            path: workspacePathJsonSchema,
            changed: { type: 'boolean' },
          },
        },
        effect: 'idempotent_write', recovery: 'retry_same_call', risks: ['handles_sensitive_data'],
        providerKey: WORKSPACE_FILE_TOOL_PROVIDER_KEY,
      },
      {
        id: toolRevisionId(catalogId(organizationId, PROPOSE_WORKSPACE_CHANGES_CAPABILITY_ID)),
        capabilityId: PROPOSE_WORKSPACE_CHANGES_CAPABILITY_ID,
        name: 'workspace_propose_changes',
        description: 'Finalizes the private overlay as one immutable Workspace Change Set.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        outputSchema: {
          type: 'object',
          required: ['changeSetId', 'workspaceId', 'workingRootId', 'baseRevisionId',
            'status', 'entries'],
          additionalProperties: false,
          properties: {
            changeSetId: { type: 'string' },
            workspaceId: { type: 'string' },
            workingRootId: { type: 'string' },
            baseRevisionId: { type: 'string' },
            status: { enum: ['preparing', 'proposed', 'applying', 'applied', 'conflicted'] },
            entries: {
              type: 'array', minItems: 1, maxItems: 100,
              items: {
                type: 'object', required: ['kind', 'path'], additionalProperties: false,
                properties: {
                  kind: { enum: ['add', 'modify', 'delete'] },
                  ...workspaceFileEntryProperties,
                },
              },
            },
          },
        },
        effect: 'idempotent_write', recovery: 'retry_same_call', risks: ['handles_sensitive_data'],
        providerKey: WORKSPACE_FILE_TOOL_PROVIDER_KEY,
      },
      {
        id: toolRevisionId(catalogId(organizationId, APPLY_WORKSPACE_CHANGES_CAPABILITY_ID)),
        capabilityId: APPLY_WORKSPACE_CHANGES_CAPABILITY_ID,
        name: 'workspace_apply_changes',
        description: 'Applies one exact immutable Workspace Change Set through the centralized write path.',
        inputSchema: {
          type: 'object', required: ['changeSetId'], additionalProperties: false,
          properties: { changeSetId: { type: 'string', minLength: 1 } },
        },
        outputSchema: {
          type: 'object',
          required: ['changeSetId', 'workspaceId', 'workingRootId', 'baseRevisionId',
            'status', 'entries'],
          additionalProperties: false,
          properties: {
            changeSetId: { type: 'string' },
            workspaceId: { type: 'string' },
            workingRootId: { type: 'string' },
            baseRevisionId: { type: 'string' },
            status: { enum: ['applied', 'conflicted'] },
            resultingRevisionId: { type: 'string' },
            entries: {
              type: 'array', minItems: 1, maxItems: 100,
              items: {
                type: 'object', required: ['kind', 'path'], additionalProperties: false,
                properties: {
                  kind: { enum: ['add', 'modify', 'delete'] },
                  ...workspaceFileEntryProperties,
                },
              },
            },
          },
        },
        effect: 'idempotent_write', recovery: 'retry_same_call',
        risks: ['destructive', 'handles_sensitive_data'],
        providerKey: WORKSPACE_CHANGE_APPLY_TOOL_PROVIDER_KEY,
      },
    ],
    grants: [{
      id: toolGrantId(catalogId(organizationId, 'workspace-file-tool-grant-apply-v1')),
      agentRevisionId,
      capabilityIds: [
        LIST_WORKSPACE_FILES_CAPABILITY_ID,
        SEARCH_WORKSPACE_FILES_CAPABILITY_ID,
        OPEN_WORKSPACE_FILE_CAPABILITY_ID,
        WRITE_WORKSPACE_FILE_CAPABILITY_ID,
        DELETE_WORKSPACE_FILE_CAPABILITY_ID,
        PROPOSE_WORKSPACE_CHANGES_CAPABILITY_ID,
        APPLY_WORKSPACE_CHANGES_CAPABILITY_ID,
      ],
    }],
  };
}

function identityFrom(request: ToolProviderRequest): RequestIdentity {
  return {
    organizationId: request.credentialLease.organizationId,
    principalId: request.credentialLease.principalId,
    principalType: 'employee',
    displayName: 'Authorized Workspace Employee',
  };
}

function objectInput(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Workspace file Tool input');
  }
  return value as Readonly<Record<string, unknown>>;
}

function optionalLimit(
  input: Readonly<Record<string, unknown>>,
  fallback: number,
  maximum: number,
): number {
  const value = input.limit ?? fallback;
  if (typeof value !== 'number' || !Number.isInteger(value)
    || value < 1 || value > maximum) {
    throw new Error('Invalid Workspace file Tool limit');
  }
  return value;
}

function optionalCursor(input: Readonly<Record<string, unknown>>): string | undefined {
  if (input.cursor === undefined) return undefined;
  if (typeof input.cursor !== 'string' || input.cursor.length === 0) {
    throw new Error('Invalid Workspace file Tool cursor');
  }
  return input.cursor;
}

export class WorkspaceFileToolProvenanceObserver implements GovernedToolOutcomeObserver {
  constructor(
    private readonly environments: Pick<WorkspaceRunEnvironments, 'get'>,
    private readonly context: WorkspaceFileContextRecorder,
  ) {}

  async observe(
    identity: RequestIdentity,
    input: EngineInvocation,
    descriptor: ToolDescriptor,
    outcome: ToolOutcome,
  ): Promise<void> {
    if (descriptor.capabilityId !== OPEN_WORKSPACE_FILE_CAPABILITY_ID
      || outcome.kind !== 'success') return;
    const file = openedFile(outcome.value);
    const invocationId = workspaceInvocationId(input.invocationId);
    const environment = await this.environments.get(identity, invocationId);
    await this.context.recordOpenedFile({
      organizationId: identity.organizationId,
      invocationId,
      workspaceId: environment.workspaceId,
      workingRootId: environment.workingRootId,
      revisionId: environment.revisionId,
      path: file.path,
      mediaType: file.mediaType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    });
  }
}

function openedFile(value: unknown): WorkspaceFileContent {
  if (!value || typeof value !== 'object'
    || !('path' in value) || typeof value.path !== 'string'
    || !('mediaType' in value) || typeof value.mediaType !== 'string'
    || !('sizeBytes' in value) || typeof value.sizeBytes !== 'number'
    || !('sha256' in value) || typeof value.sha256 !== 'string'
    || !('encoding' in value) || value.encoding !== 'utf8'
    || !('content' in value) || typeof value.content !== 'string') {
    throw new Error('Workspace open Tool outcome is invalid');
  }
  const bytes = Buffer.from(value.content, 'utf8');
  if (bytes.byteLength !== value.sizeBytes
    || createHash('sha256').update(bytes).digest('hex') !== value.sha256) {
    throw new Error('Workspace open Tool provenance does not match its content');
  }
  return {
    path: value.path,
    mediaType: value.mediaType,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
    encoding: 'utf8',
    content: value.content,
  };
}

export class WorkspaceChangeApplyToolProvider implements ToolProvider {
  readonly key = WORKSPACE_CHANGE_APPLY_TOOL_PROVIDER_KEY;

  constructor(
    private readonly changes: Pick<WorkspaceChanges, 'apply' | 'get' | 'getApplyAuthority'>,
  ) {}

  summarize(input: unknown) {
    const value = objectInput(input);
    return {
      title: 'Apply Workspace changes',
      details: {
        changeSetId: typeof value.changeSetId === 'string' ? value.changeSetId : 'invalid',
      },
    };
  }

  async resolvePolicyResource(request: ToolPolicyResourceRequest) {
    const input = objectInput(request.input);
    if (typeof input.changeSetId !== 'string') {
      throw new Error('Workspace Change Set ID is required');
    }
    const authority = await this.changes.getApplyAuthority(
      request.identity,
      workspaceInvocationId(request.invocationId),
      input.changeSetId as WorkspaceChangeSetId,
    );
    return {
      kind: 'workspace_change_apply' as const,
      currentOperationMode: authority.currentOperationMode,
      maximumOperationMode: authority.maximumOperationMode,
    };
  }

  async execute(request: ToolProviderRequest): Promise<ToolProviderResult> {
    const input = objectInput(request.input);
    if (typeof input.changeSetId !== 'string') {
      throw new Error('Workspace Change Set ID is required');
    }
    const identity = identityFrom(request);
    const changeSetId = input.changeSetId as WorkspaceChangeSetId;
    let changeSet: WorkspaceChangeSet;
    try {
      changeSet = (await this.changes.apply(identity, {
        commandId: workspaceChangeCommandId(request.toolCallId),
        changeSetId,
      })).value;
    } catch (error) {
      if (!(error instanceof WorkspaceChangeConflictError)) throw error;
      changeSet = await this.changes.get(identity, changeSetId);
    }
    const value = {
      changeSetId: changeSet.id,
      workspaceId: changeSet.workspaceId,
      workingRootId: changeSet.workingRootId,
      baseRevisionId: changeSet.baseRevisionId,
      status: changeSet.status,
      entries: changeSet.entries,
      ...(changeSet.resultingRevisionId
        ? { resultingRevisionId: changeSet.resultingRevisionId }
        : {}),
    };
    return {
      kind: 'success',
      value,
      safeSummary: {
        title: changeSet.status === 'conflicted'
          ? 'Workspace changes conflicted'
          : 'Workspace changes applied',
        details: {
          changeSetId: changeSet.id,
          status: changeSet.status,
          files: String(changeSet.entries.length),
        },
      },
    };
  }
}

export class WorkspaceFileToolProvider implements ToolProvider {
  readonly key = WORKSPACE_FILE_TOOL_PROVIDER_KEY;

  constructor(
    private readonly environments: Pick<WorkspaceRunEnvironments,
      'listFiles' | 'searchFiles' | 'openFile' | 'writeFile' | 'deleteFile' | 'proposeChanges'>,
  ) {}

  summarize(_input: unknown) {
    return { title: 'Workspace file read', details: { scope: 'fixed revision' } };
  }

  async execute(request: ToolProviderRequest): Promise<ToolProviderResult> {
    const identity = identityFrom(request);
    const invocationId = workspaceInvocationId(request.invocationId);
    const input = objectInput(request.input);
    switch (request.revision.capabilityId) {
      case LIST_WORKSPACE_FILES_CAPABILITY_ID: {
        const cursor = optionalCursor(input);
        const page = await this.environments.listFiles(identity, invocationId, {
          limit: optionalLimit(input, 20, 20),
          ...(cursor ? { cursor } : {}),
        });
        return {
          kind: 'success', value: page,
          safeSummary: {
            title: 'Workspace files listed',
            details: { count: String(page.items.length) },
          },
        };
      }
      case SEARCH_WORKSPACE_FILES_CAPABILITY_ID: {
        if (typeof input.query !== 'string') throw new Error('Workspace search query is required');
        const cursor = optionalCursor(input);
        const page = await this.environments.searchFiles(identity, invocationId, {
          query: input.query,
          limit: optionalLimit(input, 10, 10),
          ...(cursor ? { cursor } : {}),
        });
        return {
          kind: 'success', value: page,
          safeSummary: {
            title: 'Workspace files searched',
            details: { matches: String(page.items.length) },
          },
        };
      }
      case OPEN_WORKSPACE_FILE_CAPABILITY_ID: {
        if (typeof input.path !== 'string') throw new Error('Workspace file path is required');
        const file = await this.environments.openFile(identity, invocationId, input.path);
        if (file.sizeBytes > maximumToolOpenBytes) {
          throw new Error('Workspace file exceeds the governed Tool output limit');
        }
        return {
          kind: 'success', value: file,
          safeSummary: {
            title: 'Workspace file opened',
            details: { path: file.path, bytes: String(file.sizeBytes) },
          },
        };
      }
      case WRITE_WORKSPACE_FILE_CAPABILITY_ID: {
        if (typeof input.path !== 'string' || typeof input.content !== 'string'
          || input.content.length > maximumToolWriteCharacters) {
          throw new Error('Workspace write input is invalid');
        }
        const result = await this.environments.writeFile(identity, invocationId, {
          commandId: workspaceOverlayCommandId(request.toolCallId),
          path: input.path,
          content: input.content,
        });
        const value = {
          kind: result.value?.kind ?? 'none',
          path: result.value?.path ?? input.path,
          changed: result.value !== null,
          ...(result.value?.kind === 'write' ? {
            mediaType: result.value.mediaType,
            sizeBytes: result.value.sizeBytes,
            sha256: result.value.sha256,
          } : {}),
        };
        return {
          kind: 'success', value,
          safeSummary: {
            title: 'Workspace overlay file written',
            details: { path: value.path, changed: String(value.changed) },
          },
        };
      }
      case DELETE_WORKSPACE_FILE_CAPABILITY_ID: {
        if (typeof input.path !== 'string') throw new Error('Workspace file path is required');
        const result = await this.environments.deleteFile(identity, invocationId, {
          commandId: workspaceOverlayCommandId(request.toolCallId),
          path: input.path,
        });
        const value = {
          kind: result.value?.kind ?? 'none',
          path: result.value?.path ?? input.path,
          changed: result.value !== null,
        };
        return {
          kind: 'success', value,
          safeSummary: {
            title: 'Workspace overlay file deleted',
            details: { path: value.path, changed: String(value.changed) },
          },
        };
      }
      case PROPOSE_WORKSPACE_CHANGES_CAPABILITY_ID: {
        const result = await this.environments.proposeChanges(identity, invocationId, {
          commandId: workspaceChangeCommandId(request.toolCallId),
        });
        const value = {
          changeSetId: result.value.id,
          workspaceId: result.value.workspaceId,
          workingRootId: result.value.workingRootId,
          baseRevisionId: result.value.baseRevisionId,
          status: result.value.status,
          entries: result.value.entries,
        };
        return {
          kind: 'success', value,
          safeSummary: {
            title: 'Workspace changes proposed',
            details: { files: String(value.entries.length) },
          },
        };
      }
      default:
        throw new Error('Unsupported Workspace file capability');
    }
  }
}
