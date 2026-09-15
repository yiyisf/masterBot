import { hostname } from 'node:os';
import {
  agentId,
  agentRevisionId,
  type DevelopmentAgentConfig,
} from '@cmaster/agents';
import { serverRoleSchema, type ServerRole } from '@cmaster/contracts';
import {
  deriveEffectiveContextInputLimit,
  slice4BaselineContextPolicy,
  type ContextPolicyRevision,
} from '@cmaster/context';
import type { ModelContextLimits } from '@cmaster/models';
import { z } from 'zod';

const emptyAsUndefined = (value: unknown): unknown => value === '' ? undefined : value;
const optionalNonEmptyString = z.preprocess(emptyAsUndefined, z.string().min(1).optional());
const postgresIntegerMaximum = 2_147_483_647;
const optionalPositiveInteger = z.preprocess(
  emptyAsUndefined,
  z.coerce.number().int().positive().max(postgresIntegerMaximum).optional(),
);
const optionalModelBaseUrl = z.preprocess(
  emptyAsUndefined,
  z.string().url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password && !url.search && !url.hash;
  }, 'Model Base URL must be credential-free HTTP(S)').optional(),
);

const environmentSchema = z.object({
  CMASTER_SERVER_ROLE: serverRoleSchema.default('all'),
  CMASTER_API_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  DATABASE_URL: z.string().min(1),
  CMASTER_WEB_ORIGIN: z.string().url().default('http://localhost:3101'),
  NEXT_ARCHITECTURE_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CMASTER_DEVELOPMENT_IDENTITY_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CMASTER_AI_SDK_RUNTIME_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CMASTER_TOOL_RUNTIME_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CMASTER_CONTEXT_ARTIFACTS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CMASTER_EMPLOYEE_WORKSPACE_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CMASTER_FILESYSTEM_WORKSPACE_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CMASTER_ARTIFACT_STORAGE_ROOT: z.string().min(1).default('data/artifacts'),
  CMASTER_HTTP_FETCH_ALLOWED_HOSTS: z.string().default(''),
  CMASTER_RUNTIME_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CMASTER_DEV_ORGANIZATION_ID: z.uuid().default('00000000-0000-4000-8000-000000000001'),
  CMASTER_DEV_PRINCIPAL_ID: z.uuid().default('00000000-0000-4000-8000-000000000002'),
  CMASTER_DEV_PRINCIPAL_DISPLAY_NAME: z.string().min(1).default('Development Employee'),
  CMASTER_DEV_AGENT_ID: z.uuid().default('00000000-0000-4000-8000-000000000003'),
  CMASTER_DEV_AGENT_REVISION_ID: z.uuid().default('00000000-0000-4000-8000-000000000004'),
  CMASTER_DEV_AI_AGENT_REVISION_ID: z.uuid().default('00000000-0000-4000-8000-000000000005'),
  CMASTER_DEV_TOOL_AGENT_REVISION_ID: z.uuid().default('00000000-0000-4000-8000-000000000012'),
  CMASTER_DEV_CONTEXT_ARTIFACT_AGENT_REVISION_ID: z.uuid().default('00000000-0000-4000-8000-000000000015'),
  CMASTER_PRIMARY_MODEL_PROFILE_ID: z.uuid().default('00000000-0000-4000-8000-000000000006'),
  CMASTER_TOOL_MODEL_PROFILE_ID: z.uuid().default('00000000-0000-4000-8000-000000000013'),
  CMASTER_CONTEXT_PRIMARY_MODEL_PROFILE_ID: z.uuid().default('00000000-0000-4000-8000-000000000016'),
  CMASTER_PRIMARY_MODEL_DISPLAY_NAME: z.string().min(1).default('Development Primary Model'),
  CMASTER_PRIMARY_MODEL_BASE_URL: optionalModelBaseUrl,
  CMASTER_PRIMARY_MODEL_ID: optionalNonEmptyString,
  CMASTER_PRIMARY_MODEL_API_KEY: optionalNonEmptyString,
  CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS: optionalPositiveInteger,
  CMASTER_PRIMARY_MODEL_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive()
    .max(postgresIntegerMaximum).default(16_384),
  CMASTER_FALLBACK_MODEL_PROFILE_ID: z.uuid().default('00000000-0000-4000-8000-000000000007'),
  CMASTER_TOOL_FALLBACK_MODEL_PROFILE_ID: z.uuid().default('00000000-0000-4000-8000-000000000014'),
  CMASTER_CONTEXT_FALLBACK_MODEL_PROFILE_ID: z.uuid().default('00000000-0000-4000-8000-000000000017'),
  CMASTER_FALLBACK_MODEL_DISPLAY_NAME: z.string().min(1).default('Development Fallback Model'),
  CMASTER_FALLBACK_MODEL_BASE_URL: optionalModelBaseUrl,
  CMASTER_FALLBACK_MODEL_ID: optionalNonEmptyString,
  CMASTER_FALLBACK_MODEL_API_KEY: optionalNonEmptyString,
  CMASTER_FALLBACK_MODEL_CONTEXT_WINDOW_TOKENS: optionalPositiveInteger,
  CMASTER_FALLBACK_MODEL_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive()
    .max(postgresIntegerMaximum).default(16_384),
  CMASTER_WORKER_ID: z.string().min(1).optional(),
  CMASTER_WORKER_LEASE_TTL_MS: z.coerce.number().int().min(100).default(30_000),
  CMASTER_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(10).default(500),
  CMASTER_WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  CMASTER_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
});

export interface ServerConfig {
  role: ServerRole;
  apiPort: number;
  databaseUrl: string;
  webOrigin: string;
  features: {
    nextArchitecture: boolean;
    developmentIdentity: boolean;
    aiSdkRuntime: boolean;
    toolRuntime: boolean;
    contextArtifacts: boolean;
    employeeWorkspace: boolean;
    filesystemWorkspace: boolean;
  };
  runtimeEnvironment: 'development' | 'test' | 'production';
  artifactStorageRoot: string;
  developmentIdentity: {
    organizationId: string;
    principalId: string;
    principalDisplayName: string;
    agentId: string;
    echoAgentRevisionId: string;
    aiSdkAgentRevisionId: string;
    toolAgentRevisionId: string;
    contextArtifactAgentRevisionId: string;
    activeAgentRevisionId: string;
    contextPolicyRevision?: ContextPolicyRevision;
  };
  toolRuntime: {
    httpFetchAllowedHosts: readonly string[];
  };
  modelRuntime?: {
    primary: {
      profileId: string;
      displayName: string;
      baseUrl: string;
      modelId: string;
      apiKey: string;
      credentialRef: 'env:CMASTER_PRIMARY_MODEL_API_KEY';
      capabilities: { streamingText: true; toolCalling: boolean };
      contextLimits?: ModelContextLimits;
    };
    fallback?: {
      profileId: string;
      displayName: string;
      baseUrl: string;
      modelId: string;
      apiKey: string;
      credentialRef: 'env:CMASTER_FALLBACK_MODEL_API_KEY';
      capabilities: { streamingText: true; toolCalling: boolean };
      contextLimits?: ModelContextLimits;
    };
  };
  worker: {
    id: string;
    leaseTtlMs: number;
    pollIntervalMs: number;
    maxAttempts: number;
    concurrency: number;
  };
}

function parseAllowedHosts(value: string): string[] {
  const hosts = value.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  for (const host of hosts) {
    const parsed = new URL(`https://${host}`);
    if (parsed.hostname !== host || parsed.port || parsed.pathname !== '/') {
      throw new Error('HTTP fetch allowlist must contain hostnames only');
    }
  }
  return [...new Set(hosts)];
}

function resolveModelContextLimits(
  profileRole: 'Primary' | 'Fallback',
  required: boolean,
  contextWindowTokens: number | undefined,
  maxOutputTokens: number,
): ModelContextLimits | undefined {
  if (!required) return undefined;
  if (contextWindowTokens === undefined) {
    throw new Error(`${profileRole} Model Context Window is required${profileRole === 'Primary'
      ? ' for Context and Artifacts'
      : ' when Fallback is configured'}`);
  }
  if (contextWindowTokens
    <= maxOutputTokens + slice4BaselineContextPolicy.safetyMarginTokens) {
    throw new Error(`${profileRole} Model Context Window must exceed Max Output and safety margin`);
  }
  return { contextWindowTokens, maxOutputTokens };
}

function roleFromArguments(argv: readonly string[]): string | undefined {
  const inline = argv.find((value) => value.startsWith('--role='));
  if (inline !== undefined) return inline.slice('--role='.length);

  const roleIndex = argv.indexOf('--role');
  return roleIndex >= 0 ? (argv[roleIndex + 1] ?? '') : undefined;
}

export function resolveDevelopmentAgentConfig(config: ServerConfig): DevelopmentAgentConfig {
  const contextPolicyRevision = config.developmentIdentity.contextPolicyRevision;
  if (config.features.contextArtifacts && !contextPolicyRevision) {
    throw new Error('Context Policy Revision is required when Context and Artifacts are enabled');
  }
  return {
    agentId: agentId(config.developmentIdentity.agentId),
    echoRevisionId: agentRevisionId(config.developmentIdentity.echoAgentRevisionId),
    ...(config.features.aiSdkRuntime
      ? { aiSdkRevisionId: agentRevisionId(config.developmentIdentity.aiSdkAgentRevisionId) }
      : {}),
    ...(config.features.toolRuntime
      ? { toolRevisionId: agentRevisionId(config.developmentIdentity.toolAgentRevisionId) }
      : {}),
    ...(config.features.contextArtifacts
      ? {
        contextArtifactRevisionId: agentRevisionId(
          config.developmentIdentity.contextArtifactAgentRevisionId,
        ),
        contextPolicyRevision,
      }
      : {}),
    activeRevisionId: agentRevisionId(config.developmentIdentity.activeAgentRevisionId),
    name: 'Development Agent',
  };
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): ServerConfig {
  const argumentRole = roleFromArguments(argv);
  const environmentInput: Record<string, string | undefined> = {
    ...environment,
    ...(argumentRole !== undefined ? { CMASTER_SERVER_ROLE: argumentRole } : {}),
  };
  if (environmentInput.CMASTER_CONTEXT_ARTIFACTS_ENABLED !== 'true') {
    for (const key of [
      'CMASTER_DEV_CONTEXT_ARTIFACT_AGENT_REVISION_ID',
      'CMASTER_CONTEXT_PRIMARY_MODEL_PROFILE_ID',
      'CMASTER_CONTEXT_FALLBACK_MODEL_PROFILE_ID',
      'CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS',
      'CMASTER_PRIMARY_MODEL_MAX_OUTPUT_TOKENS',
      'CMASTER_FALLBACK_MODEL_CONTEXT_WINDOW_TOKENS',
      'CMASTER_FALLBACK_MODEL_MAX_OUTPUT_TOKENS',
    ] as const) delete environmentInput[key];
  }
  const parsed = environmentSchema.parse(environmentInput);

  if (parsed.CMASTER_RUNTIME_ENV === 'production' && parsed.CMASTER_DEVELOPMENT_IDENTITY_ENABLED) {
    throw new Error('Development Identity cannot be enabled in production');
  }
  if (parsed.CMASTER_AI_SDK_RUNTIME_ENABLED && !parsed.NEXT_ARCHITECTURE_ENABLED) {
    throw new Error('AI SDK Runtime requires the next architecture');
  }
  if (parsed.CMASTER_TOOL_RUNTIME_ENABLED && !parsed.CMASTER_AI_SDK_RUNTIME_ENABLED) {
    throw new Error('Tool Runtime requires AI SDK Runtime');
  }
  if (parsed.CMASTER_CONTEXT_ARTIFACTS_ENABLED && !parsed.CMASTER_TOOL_RUNTIME_ENABLED) {
    throw new Error('Context and Artifacts require Tool Runtime');
  }
  if (parsed.CMASTER_EMPLOYEE_WORKSPACE_ENABLED && !parsed.CMASTER_CONTEXT_ARTIFACTS_ENABLED) {
    throw new Error('Employee Workspace requires Context and Artifacts');
  }
  if (parsed.CMASTER_FILESYSTEM_WORKSPACE_ENABLED && !parsed.NEXT_ARCHITECTURE_ENABLED) {
    throw new Error('Filesystem Workspace requires the next architecture');
  }
  const primaryValues = [
    parsed.CMASTER_PRIMARY_MODEL_BASE_URL,
    parsed.CMASTER_PRIMARY_MODEL_ID,
    parsed.CMASTER_PRIMARY_MODEL_API_KEY,
  ];
  if (parsed.CMASTER_AI_SDK_RUNTIME_ENABLED && primaryValues.some((value) => value === undefined)) {
    throw new Error('AI SDK Runtime requires a complete Primary Model Profile');
  }
  const fallbackValues = [
    parsed.CMASTER_FALLBACK_MODEL_BASE_URL,
    parsed.CMASTER_FALLBACK_MODEL_ID,
    parsed.CMASTER_FALLBACK_MODEL_API_KEY,
  ];
  const hasFallback = fallbackValues.some((value) => value !== undefined);
  if (parsed.CMASTER_AI_SDK_RUNTIME_ENABLED
    && hasFallback && fallbackValues.some((value) => value === undefined)) {
    throw new Error('Fallback Model Profile must be configured completely');
  }

  const primaryContextLimits = resolveModelContextLimits(
    'Primary',
    parsed.CMASTER_CONTEXT_ARTIFACTS_ENABLED,
    parsed.CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS,
    parsed.CMASTER_PRIMARY_MODEL_MAX_OUTPUT_TOKENS,
  );
  const fallbackContextLimits = resolveModelContextLimits(
    'Fallback',
    parsed.CMASTER_CONTEXT_ARTIFACTS_ENABLED && hasFallback,
    parsed.CMASTER_FALLBACK_MODEL_CONTEXT_WINDOW_TOKENS,
    parsed.CMASTER_FALLBACK_MODEL_MAX_OUTPUT_TOKENS,
  );
  if (primaryContextLimits) {
    const eligibleLimits = [
      primaryContextLimits,
      ...(fallbackContextLimits ? [fallbackContextLimits] : []),
    ];
    deriveEffectiveContextInputLimit(slice4BaselineContextPolicy, {
      strictestContextWindowTokens: Math.min(
        ...eligibleLimits.map((limits) => limits.contextWindowTokens),
      ),
      maximumOutputTokens: Math.max(
        ...eligibleLimits.map((limits) => limits.maxOutputTokens),
      ),
    });
  }

  if (parsed.CMASTER_CONTEXT_ARTIFACTS_ENABLED) {
    const previousAgentRevisionIds = [
      parsed.CMASTER_DEV_AGENT_REVISION_ID,
      parsed.CMASTER_DEV_AI_AGENT_REVISION_ID,
      parsed.CMASTER_DEV_TOOL_AGENT_REVISION_ID,
    ];
    if (previousAgentRevisionIds.includes(parsed.CMASTER_DEV_CONTEXT_ARTIFACT_AGENT_REVISION_ID)) {
      throw new Error('Context-enabled Agent Revision ID must be distinct from earlier Slices');
    }
    const previousModelProfileIds = [
      parsed.CMASTER_PRIMARY_MODEL_PROFILE_ID,
      parsed.CMASTER_FALLBACK_MODEL_PROFILE_ID,
      parsed.CMASTER_TOOL_MODEL_PROFILE_ID,
      parsed.CMASTER_TOOL_FALLBACK_MODEL_PROFILE_ID,
    ];
    const contextModelProfileIds = [
      parsed.CMASTER_CONTEXT_PRIMARY_MODEL_PROFILE_ID,
      ...(hasFallback ? [parsed.CMASTER_CONTEXT_FALLBACK_MODEL_PROFILE_ID] : []),
    ];
    if (new Set(contextModelProfileIds).size !== contextModelProfileIds.length
      || contextModelProfileIds.some((id) => previousModelProfileIds.includes(id))) {
      throw new Error('Context-enabled Model Profile IDs must be new and distinct');
    }
  }

  const runtimeTier = parsed.CMASTER_CONTEXT_ARTIFACTS_ENABLED
    ? 'context'
    : parsed.CMASTER_TOOL_RUNTIME_ENABLED
      ? 'tools'
      : parsed.CMASTER_AI_SDK_RUNTIME_ENABLED
        ? 'ai-sdk'
        : 'echo';
  const runtimeConfiguration = {
    echo: {
      agentRevisionId: parsed.CMASTER_DEV_AGENT_REVISION_ID,
      primaryModelProfileId: parsed.CMASTER_PRIMARY_MODEL_PROFILE_ID,
      fallbackModelProfileId: parsed.CMASTER_FALLBACK_MODEL_PROFILE_ID,
    },
    'ai-sdk': {
      agentRevisionId: parsed.CMASTER_DEV_AI_AGENT_REVISION_ID,
      primaryModelProfileId: parsed.CMASTER_PRIMARY_MODEL_PROFILE_ID,
      fallbackModelProfileId: parsed.CMASTER_FALLBACK_MODEL_PROFILE_ID,
    },
    tools: {
      agentRevisionId: parsed.CMASTER_DEV_TOOL_AGENT_REVISION_ID,
      primaryModelProfileId: parsed.CMASTER_TOOL_MODEL_PROFILE_ID,
      fallbackModelProfileId: parsed.CMASTER_TOOL_FALLBACK_MODEL_PROFILE_ID,
    },
    context: {
      agentRevisionId: parsed.CMASTER_DEV_CONTEXT_ARTIFACT_AGENT_REVISION_ID,
      primaryModelProfileId: parsed.CMASTER_CONTEXT_PRIMARY_MODEL_PROFILE_ID,
      fallbackModelProfileId: parsed.CMASTER_CONTEXT_FALLBACK_MODEL_PROFILE_ID,
    },
  }[runtimeTier];

  return {
    role: parsed.CMASTER_SERVER_ROLE,
    apiPort: parsed.CMASTER_API_PORT,
    databaseUrl: parsed.DATABASE_URL,
    webOrigin: parsed.CMASTER_WEB_ORIGIN,
    features: {
      nextArchitecture: parsed.NEXT_ARCHITECTURE_ENABLED,
      developmentIdentity: parsed.CMASTER_DEVELOPMENT_IDENTITY_ENABLED,
      aiSdkRuntime: parsed.CMASTER_AI_SDK_RUNTIME_ENABLED,
      toolRuntime: parsed.CMASTER_TOOL_RUNTIME_ENABLED,
      contextArtifacts: parsed.CMASTER_CONTEXT_ARTIFACTS_ENABLED,
      employeeWorkspace: parsed.CMASTER_EMPLOYEE_WORKSPACE_ENABLED,
      filesystemWorkspace: parsed.CMASTER_FILESYSTEM_WORKSPACE_ENABLED,
    },
    runtimeEnvironment: parsed.CMASTER_RUNTIME_ENV,
    artifactStorageRoot: parsed.CMASTER_ARTIFACT_STORAGE_ROOT,
    toolRuntime: {
      httpFetchAllowedHosts: parseAllowedHosts(parsed.CMASTER_HTTP_FETCH_ALLOWED_HOSTS),
    },
    developmentIdentity: {
      organizationId: parsed.CMASTER_DEV_ORGANIZATION_ID,
      principalId: parsed.CMASTER_DEV_PRINCIPAL_ID,
      principalDisplayName: parsed.CMASTER_DEV_PRINCIPAL_DISPLAY_NAME,
      agentId: parsed.CMASTER_DEV_AGENT_ID,
      echoAgentRevisionId: parsed.CMASTER_DEV_AGENT_REVISION_ID,
      aiSdkAgentRevisionId: parsed.CMASTER_DEV_AI_AGENT_REVISION_ID,
      toolAgentRevisionId: parsed.CMASTER_DEV_TOOL_AGENT_REVISION_ID,
      contextArtifactAgentRevisionId: parsed.CMASTER_DEV_CONTEXT_ARTIFACT_AGENT_REVISION_ID,
      activeAgentRevisionId: runtimeConfiguration.agentRevisionId,
      ...(parsed.CMASTER_CONTEXT_ARTIFACTS_ENABLED
        ? { contextPolicyRevision: slice4BaselineContextPolicy.revision }
        : {}),
    },
    ...(parsed.CMASTER_AI_SDK_RUNTIME_ENABLED ? {
      modelRuntime: {
        primary: {
          profileId: runtimeConfiguration.primaryModelProfileId,
          displayName: parsed.CMASTER_PRIMARY_MODEL_DISPLAY_NAME,
          baseUrl: parsed.CMASTER_PRIMARY_MODEL_BASE_URL!,
          modelId: parsed.CMASTER_PRIMARY_MODEL_ID!,
          apiKey: parsed.CMASTER_PRIMARY_MODEL_API_KEY!,
          credentialRef: 'env:CMASTER_PRIMARY_MODEL_API_KEY' as const,
          capabilities: {
            streamingText: true as const,
            toolCalling: parsed.CMASTER_TOOL_RUNTIME_ENABLED,
          },
          ...(primaryContextLimits ? { contextLimits: primaryContextLimits } : {}),
        },
        ...(hasFallback ? {
          fallback: {
            profileId: runtimeConfiguration.fallbackModelProfileId,
            displayName: parsed.CMASTER_FALLBACK_MODEL_DISPLAY_NAME,
            baseUrl: parsed.CMASTER_FALLBACK_MODEL_BASE_URL!,
            modelId: parsed.CMASTER_FALLBACK_MODEL_ID!,
            apiKey: parsed.CMASTER_FALLBACK_MODEL_API_KEY!,
            credentialRef: 'env:CMASTER_FALLBACK_MODEL_API_KEY' as const,
            capabilities: {
              streamingText: true as const,
              toolCalling: parsed.CMASTER_TOOL_RUNTIME_ENABLED,
            },
            ...(fallbackContextLimits ? { contextLimits: fallbackContextLimits } : {}),
          },
        } : {}),
      },
    } : {}),
    worker: {
      id: parsed.CMASTER_WORKER_ID ?? `${hostname()}:${process.pid}`,
      leaseTtlMs: parsed.CMASTER_WORKER_LEASE_TTL_MS,
      pollIntervalMs: parsed.CMASTER_WORKER_POLL_INTERVAL_MS,
      maxAttempts: parsed.CMASTER_WORKER_MAX_ATTEMPTS,
      concurrency: parsed.CMASTER_WORKER_CONCURRENCY,
    },
  };
}
