import { hostname } from 'node:os';
import { serverRoleSchema, type ServerRole } from '@cmaster/contracts';
import { z } from 'zod';

const emptyAsUndefined = (value: unknown): unknown => value === '' ? undefined : value;
const optionalNonEmptyString = z.preprocess(emptyAsUndefined, z.string().min(1).optional());
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
  CMASTER_RUNTIME_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CMASTER_DEV_ORGANIZATION_ID: z.uuid().default('00000000-0000-4000-8000-000000000001'),
  CMASTER_DEV_PRINCIPAL_ID: z.uuid().default('00000000-0000-4000-8000-000000000002'),
  CMASTER_DEV_PRINCIPAL_DISPLAY_NAME: z.string().min(1).default('Development Employee'),
  CMASTER_DEV_AGENT_ID: z.uuid().default('00000000-0000-4000-8000-000000000003'),
  CMASTER_DEV_AGENT_REVISION_ID: z.uuid().default('00000000-0000-4000-8000-000000000004'),
  CMASTER_DEV_AI_AGENT_REVISION_ID: z.uuid().default('00000000-0000-4000-8000-000000000005'),
  CMASTER_PRIMARY_MODEL_PROFILE_ID: z.uuid().default('00000000-0000-4000-8000-000000000006'),
  CMASTER_PRIMARY_MODEL_DISPLAY_NAME: z.string().min(1).default('Development Primary Model'),
  CMASTER_PRIMARY_MODEL_BASE_URL: optionalModelBaseUrl,
  CMASTER_PRIMARY_MODEL_ID: optionalNonEmptyString,
  CMASTER_PRIMARY_MODEL_API_KEY: optionalNonEmptyString,
  CMASTER_FALLBACK_MODEL_PROFILE_ID: z.uuid().default('00000000-0000-4000-8000-000000000007'),
  CMASTER_FALLBACK_MODEL_DISPLAY_NAME: z.string().min(1).default('Development Fallback Model'),
  CMASTER_FALLBACK_MODEL_BASE_URL: optionalModelBaseUrl,
  CMASTER_FALLBACK_MODEL_ID: optionalNonEmptyString,
  CMASTER_FALLBACK_MODEL_API_KEY: optionalNonEmptyString,
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
  };
  runtimeEnvironment: 'development' | 'test' | 'production';
  developmentIdentity: {
    organizationId: string;
    principalId: string;
    principalDisplayName: string;
    agentId: string;
    echoAgentRevisionId: string;
    aiSdkAgentRevisionId: string;
  };
  modelRuntime?: {
    primary: {
      profileId: string;
      displayName: string;
      baseUrl: string;
      modelId: string;
      apiKey: string;
      credentialRef: 'env:CMASTER_PRIMARY_MODEL_API_KEY';
    };
    fallback?: {
      profileId: string;
      displayName: string;
      baseUrl: string;
      modelId: string;
      apiKey: string;
      credentialRef: 'env:CMASTER_FALLBACK_MODEL_API_KEY';
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

function roleFromArguments(argv: readonly string[]): string | undefined {
  const inline = argv.find((value) => value.startsWith('--role='));
  if (inline !== undefined) return inline.slice('--role='.length);

  const roleIndex = argv.indexOf('--role');
  return roleIndex >= 0 ? (argv[roleIndex + 1] ?? '') : undefined;
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): ServerConfig {
  const argumentRole = roleFromArguments(argv);
  const parsed = environmentSchema.parse({
    ...environment,
    ...(argumentRole !== undefined ? { CMASTER_SERVER_ROLE: argumentRole } : {}),
  });

  if (parsed.CMASTER_RUNTIME_ENV === 'production' && parsed.CMASTER_DEVELOPMENT_IDENTITY_ENABLED) {
    throw new Error('Development Identity cannot be enabled in production');
  }
  if (parsed.CMASTER_AI_SDK_RUNTIME_ENABLED && !parsed.NEXT_ARCHITECTURE_ENABLED) {
    throw new Error('AI SDK Runtime requires the next architecture');
  }
  if (parsed.CMASTER_TOOL_RUNTIME_ENABLED && !parsed.CMASTER_AI_SDK_RUNTIME_ENABLED) {
    throw new Error('Tool Runtime requires AI SDK Runtime');
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
    },
    runtimeEnvironment: parsed.CMASTER_RUNTIME_ENV,
    developmentIdentity: {
      organizationId: parsed.CMASTER_DEV_ORGANIZATION_ID,
      principalId: parsed.CMASTER_DEV_PRINCIPAL_ID,
      principalDisplayName: parsed.CMASTER_DEV_PRINCIPAL_DISPLAY_NAME,
      agentId: parsed.CMASTER_DEV_AGENT_ID,
      echoAgentRevisionId: parsed.CMASTER_DEV_AGENT_REVISION_ID,
      aiSdkAgentRevisionId: parsed.CMASTER_DEV_AI_AGENT_REVISION_ID,
    },
    ...(parsed.CMASTER_AI_SDK_RUNTIME_ENABLED ? {
      modelRuntime: {
        primary: {
          profileId: parsed.CMASTER_PRIMARY_MODEL_PROFILE_ID,
          displayName: parsed.CMASTER_PRIMARY_MODEL_DISPLAY_NAME,
          baseUrl: parsed.CMASTER_PRIMARY_MODEL_BASE_URL!,
          modelId: parsed.CMASTER_PRIMARY_MODEL_ID!,
          apiKey: parsed.CMASTER_PRIMARY_MODEL_API_KEY!,
          credentialRef: 'env:CMASTER_PRIMARY_MODEL_API_KEY' as const,
        },
        ...(hasFallback ? {
          fallback: {
            profileId: parsed.CMASTER_FALLBACK_MODEL_PROFILE_ID,
            displayName: parsed.CMASTER_FALLBACK_MODEL_DISPLAY_NAME,
            baseUrl: parsed.CMASTER_FALLBACK_MODEL_BASE_URL!,
            modelId: parsed.CMASTER_FALLBACK_MODEL_ID!,
            apiKey: parsed.CMASTER_FALLBACK_MODEL_API_KEY!,
            credentialRef: 'env:CMASTER_FALLBACK_MODEL_API_KEY' as const,
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
