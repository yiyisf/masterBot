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
  type ToolProviderResult,
} from '@cmaster/tools';
import {
  workspaceInvocationId,
  type WorkspaceFileContent,
  type WorkspaceRunEnvironments,
} from '@cmaster/workspaces';
import type { GovernedToolOutcomeObserver } from './governed-agent-tools.js';

export const LIST_WORKSPACE_FILES_CAPABILITY_ID = 'cmaster.workspace.list_files:v1';
export const SEARCH_WORKSPACE_FILES_CAPABILITY_ID = 'cmaster.workspace.search_files:v1';
export const OPEN_WORKSPACE_FILE_CAPABILITY_ID = 'cmaster.workspace.open_file:v1';
export const WORKSPACE_FILE_TOOL_PROVIDER_KEY = 'builtin:workspace-files';
const maximumToolOpenBytes = 8 * 1024;

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
    ],
    grants: [{
      id: toolGrantId(catalogId(organizationId, 'workspace-file-tool-grant')),
      agentRevisionId,
      capabilityIds: [
        LIST_WORKSPACE_FILES_CAPABILITY_ID,
        SEARCH_WORKSPACE_FILES_CAPABILITY_ID,
        OPEN_WORKSPACE_FILE_CAPABILITY_ID,
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

export class WorkspaceFileToolProvider implements ToolProvider {
  readonly key = WORKSPACE_FILE_TOOL_PROVIDER_KEY;

  constructor(
    private readonly environments: Pick<WorkspaceRunEnvironments,
      'listFiles' | 'searchFiles' | 'openFile'>,
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
      default:
        throw new Error('Unsupported Workspace file capability');
    }
  }
}
