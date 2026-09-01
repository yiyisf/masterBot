import { describe, expect, it } from 'vitest';
import { loadServerConfig } from './config.js';

describe('loadServerConfig', () => {
  it('uses explicit arguments over environment role', () => {
    const config = loadServerConfig(
      {
        DATABASE_URL: 'postgresql://localhost/cmaster',
        CMASTER_SERVER_ROLE: 'worker',
        NEXT_ARCHITECTURE_ENABLED: 'true',
      },
      ['--role=api'],
    );

    expect(config).toMatchObject({
      role: 'api',
      apiPort: 3100,
      features: { nextArchitecture: true },
    });
  });

  it('fails fast when DATABASE_URL is absent', () => {
    expect(() => loadServerConfig({}, [])).toThrow();
  });

  it.each([['--role'], ['--role=']])('fails fast when %s has no value', (...argv) => {
    expect(() => loadServerConfig(
      { DATABASE_URL: 'postgresql://localhost/cmaster' },
      argv,
    )).toThrow();
  });

  it('requires complete Primary Model configuration when AI SDK Runtime is enabled', () => {
    expect(() => loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      NEXT_ARCHITECTURE_ENABLED: 'true',
      CMASTER_AI_SDK_RUNTIME_ENABLED: 'true',
    }, [])).toThrow('complete Primary Model Profile');

    const config = loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      NEXT_ARCHITECTURE_ENABLED: 'true',
      CMASTER_AI_SDK_RUNTIME_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_BASE_URL: 'https://models.example.test/v1',
      CMASTER_PRIMARY_MODEL_ID: 'primary-model',
      CMASTER_PRIMARY_MODEL_API_KEY: 'secret',
    }, []);
    expect(config.modelRuntime?.primary).toMatchObject({
      modelId: 'primary-model',
      credentialRef: 'env:CMASTER_PRIMARY_MODEL_API_KEY',
    });
  });

  it('keeps Tool Runtime disabled by default and requires AI SDK Runtime', () => {
    expect(loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
    }, []).features.toolRuntime).toBe(false);

    expect(() => loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      NEXT_ARCHITECTURE_ENABLED: 'true',
      CMASTER_TOOL_RUNTIME_ENABLED: 'true',
    }, [])).toThrow('Tool Runtime requires AI SDK Runtime');
  });

  it('treats empty optional model variables from a copied env file as absent', () => {
    const config = loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      CMASTER_PRIMARY_MODEL_API_KEY: '',
      CMASTER_FALLBACK_MODEL_BASE_URL: '',
      CMASTER_FALLBACK_MODEL_ID: '',
      CMASTER_FALLBACK_MODEL_API_KEY: '',
    }, []);
    expect(config.modelRuntime).toBeUndefined();
  });

  it('ignores incomplete routing configuration while AI SDK Runtime is disabled', () => {
    const config = loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      CMASTER_FALLBACK_MODEL_ID: 'unused-fallback',
    }, []);
    expect(config.modelRuntime).toBeUndefined();
  });

  it('rejects credentials embedded in a Model Base URL', () => {
    expect(() => loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      CMASTER_PRIMARY_MODEL_BASE_URL: 'https://key@models.example.test/v1',
    }, [])).toThrow();
  });

  it('rejects partial Fallback Model configuration', () => {
    expect(() => loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      NEXT_ARCHITECTURE_ENABLED: 'true',
      CMASTER_AI_SDK_RUNTIME_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_BASE_URL: 'https://models.example.test/v1',
      CMASTER_PRIMARY_MODEL_ID: 'primary-model',
      CMASTER_PRIMARY_MODEL_API_KEY: 'secret',
      CMASTER_FALLBACK_MODEL_ID: 'fallback-model',
    }, [])).toThrow('configured completely');
  });

  it('rejects Development Identity in production', () => {
    expect(() => loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      CMASTER_RUNTIME_ENV: 'production',
      CMASTER_DEVELOPMENT_IDENTITY_ENABLED: 'true',
    }, [])).toThrow('Development Identity cannot be enabled in production');
  });
});
