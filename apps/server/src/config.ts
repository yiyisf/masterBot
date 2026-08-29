import { serverRoleSchema, type ServerRole } from '@cmaster/contracts';
import { z } from 'zod';

const environmentSchema = z.object({
  CMASTER_SERVER_ROLE: serverRoleSchema.default('all'),
  CMASTER_API_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  DATABASE_URL: z.string().min(1),
  CMASTER_WEB_ORIGIN: z.string().url().default('http://localhost:3101'),
  NEXT_ARCHITECTURE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export interface ServerConfig {
  role: ServerRole;
  apiPort: number;
  databaseUrl: string;
  webOrigin: string;
  features: {
    nextArchitecture: boolean;
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

  return {
    role: parsed.CMASTER_SERVER_ROLE,
    apiPort: parsed.CMASTER_API_PORT,
    databaseUrl: parsed.DATABASE_URL,
    webOrigin: parsed.CMASTER_WEB_ORIGIN,
    features: {
      nextArchitecture: parsed.NEXT_ARCHITECTURE_ENABLED,
    },
  };
}
