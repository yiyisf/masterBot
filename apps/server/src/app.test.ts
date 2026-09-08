import { describe, expect, it } from 'vitest';
import { buildApi } from './app.js';
import { loadServerConfig } from './config.js';
import { InMemoryFeatureFlags } from './feature-flags.js';
import type { DatabaseHealth } from './postgres.js';

const config = loadServerConfig({
  DATABASE_URL: 'postgresql://unused-in-unit-test',
  CMASTER_SERVER_ROLE: 'api',
  CMASTER_RUNTIME_ENV: 'test',
  NEXT_ARCHITECTURE_ENABLED: 'true',
  CMASTER_DEVELOPMENT_IDENTITY_ENABLED: 'true',
}, []);

function database(available: boolean): DatabaseHealth {
  return { check: async () => available };
}

describe('next API skeleton', () => {
  it('keeps liveness independent from PostgreSQL', async () => {
    const app = buildApi({ config, database: database(false) });

    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'http://localhost:3101' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3101');
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('reports readiness failure when PostgreSQL is unavailable', async () => {
    const app = buildApi({ config, database: database(false) });

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not-ready' });
    await app.close();
  });

  it('fails closed when Tool Runtime is enabled without its Coordinator', () => {
    expect(() => buildApi({
      config,
      database: database(true),
      featureFlags: new InMemoryFeatureFlags({
        nextArchitecture: true, toolRuntime: true, contextArtifacts: false,
      }),
    })).toThrow('Tool Runtime requires a Tool Confirmation Coordinator');
  });

  it('keeps Workspace Projection routes unmounted while its Slice flag is disabled', async () => {
    const app = buildApi({ config, database: database(true) });
    expect((await app.inject({
      method: 'GET', url: '/api/v1/workspace/conversations',
    })).statusCode).toBe(404);
    await app.close();
  });

  it('fails closed when Employee Workspace is enabled without its Experience Adapter', () => {
    expect(() => buildApi({
      config,
      database: database(true),
      featureFlags: new InMemoryFeatureFlags({
        nextArchitecture: true, employeeWorkspace: true,
      }),
    })).toThrow('Employee Workspace requires a Workspace API');
  });

  it('mounts the versioned status contract only when enabled', async () => {
    const disabled = buildApi({
      config,
      database: database(true),
      featureFlags: new InMemoryFeatureFlags({
        nextArchitecture: false, toolRuntime: false, contextArtifacts: false,
      }),
    });
    expect((await disabled.inject({ method: 'GET', url: '/api/v1/system/status' })).statusCode).toBe(404);
    await disabled.close();

    const enabled = buildApi({
      config,
      database: database(true),
      featureFlags: new InMemoryFeatureFlags({
        nextArchitecture: true, toolRuntime: false, contextArtifacts: false,
      }),
    });
    const response = await enabled.inject({ method: 'GET', url: '/api/v1/system/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      contractVersion: 'v1',
      role: 'api',
      status: 'ok',
      postgres: 'available',
    });
    await enabled.close();
  });
});
