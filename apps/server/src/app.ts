import { systemStatusSchema } from '@cmaster/contracts';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ServerConfig } from './config.js';
import { EnvironmentFeatureFlags, type FeatureFlags } from './feature-flags.js';
import type { DatabaseHealth } from './postgres.js';
import { registerRunApi, type RunApiDependencies } from './run-api.js';

export interface ApiDependencies {
  config: ServerConfig;
  database: DatabaseHealth;
  featureFlags?: FeatureFlags;
  runApi?: RunApiDependencies;
}

export function buildApi(dependencies: ApiDependencies): FastifyInstance {
  const app = Fastify({ logger: dependencies.config.runtimeEnvironment !== 'test' });
  const featureFlags = dependencies.featureFlags ?? new EnvironmentFeatureFlags({
    nextArchitecture: dependencies.config.features.nextArchitecture,
  });

  void app.register(cors, {
    origin: dependencies.config.webOrigin,
    credentials: true,
  });

  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_request, reply) => {
    const available = await dependencies.database.check();
    if (!available) reply.status(503);
    return { status: available ? 'ready' : 'not-ready' };
  });

  if (featureFlags.isEnabled('nextArchitecture')) {
    if (dependencies.runApi) registerRunApi(app, dependencies.runApi);

    app.get('/api/v1/system/status', async () => {
      const postgresAvailable = await dependencies.database.check();
      return systemStatusSchema.parse({
        contractVersion: 'v1',
        service: 'cmaster-next',
        role: dependencies.config.role,
        status: postgresAvailable ? 'ok' : 'degraded',
        postgres: postgresAvailable ? 'available' : 'unavailable',
        nextArchitectureEnabled: true,
      });
    });
  }

  return app;
}
