import { hostname } from 'node:os';
import { serverRoleSchema, type ServerRole } from '@cmaster/contracts';
import { z } from 'zod';

const environmentSchema = z.object({
  CMASTER_SERVER_ROLE: serverRoleSchema.default('all'),
  CMASTER_API_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  DATABASE_URL: z.string().min(1),
  CMASTER_WEB_ORIGIN: z.string().url().default('http://localhost:3101'),
  NEXT_ARCHITECTURE_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CMASTER_DEVELOPMENT_IDENTITY_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  CMASTER_RUNTIME_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CMASTER_DEV_ORGANIZATION_ID: z.uuid().default('00000000-0000-4000-8000-000000000001'),
  CMASTER_DEV_PRINCIPAL_ID: z.uuid().default('00000000-0000-4000-8000-000000000002'),
  CMASTER_DEV_PRINCIPAL_DISPLAY_NAME: z.string().min(1).default('Development Employee'),
  CMASTER_DEV_AGENT_ID: z.uuid().default('00000000-0000-4000-8000-000000000003'),
  CMASTER_DEV_AGENT_REVISION_ID: z.uuid().default('00000000-0000-4000-8000-000000000004'),
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
  };
  runtimeEnvironment: 'development' | 'test' | 'production';
  developmentIdentity: {
    organizationId: string;
    principalId: string;
    principalDisplayName: string;
    agentId: string;
    agentRevisionId: string;
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

  return {
    role: parsed.CMASTER_SERVER_ROLE,
    apiPort: parsed.CMASTER_API_PORT,
    databaseUrl: parsed.DATABASE_URL,
    webOrigin: parsed.CMASTER_WEB_ORIGIN,
    features: {
      nextArchitecture: parsed.NEXT_ARCHITECTURE_ENABLED,
      developmentIdentity: parsed.CMASTER_DEVELOPMENT_IDENTITY_ENABLED,
    },
    runtimeEnvironment: parsed.CMASTER_RUNTIME_ENV,
    developmentIdentity: {
      organizationId: parsed.CMASTER_DEV_ORGANIZATION_ID,
      principalId: parsed.CMASTER_DEV_PRINCIPAL_ID,
      principalDisplayName: parsed.CMASTER_DEV_PRINCIPAL_DISPLAY_NAME,
      agentId: parsed.CMASTER_DEV_AGENT_ID,
      agentRevisionId: parsed.CMASTER_DEV_AGENT_REVISION_ID,
    },
    worker: {
      id: parsed.CMASTER_WORKER_ID ?? `${hostname()}:${process.pid}`,
      leaseTtlMs: parsed.CMASTER_WORKER_LEASE_TTL_MS,
      pollIntervalMs: parsed.CMASTER_WORKER_POLL_INTERVAL_MS,
      maxAttempts: parsed.CMASTER_WORKER_MAX_ATTEMPTS,
      concurrency: parsed.CMASTER_WORKER_CONCURRENCY,
    },
  };
}
