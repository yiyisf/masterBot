import { describe, expect, it } from 'vitest';
import { loadServerConfig, resolveDevelopmentAgentConfig } from './config.js';

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
      developmentIdentity: {
        activeAgentRevisionId: '00000000-0000-4000-8000-000000000004',
      },
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

  it('selects immutable Tool-enabled Agent and Model revisions only when Tool Runtime is enabled', () => {
    const base = {
      DATABASE_URL: 'postgresql://localhost/cmaster',
      NEXT_ARCHITECTURE_ENABLED: 'true',
      CMASTER_AI_SDK_RUNTIME_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_BASE_URL: 'https://models.example.test/v1',
      CMASTER_PRIMARY_MODEL_ID: 'primary-model',
      CMASTER_PRIMARY_MODEL_API_KEY: 'secret',
    };
    const textOnly = loadServerConfig(base, []);
    expect(textOnly.developmentIdentity.activeAgentRevisionId)
      .toBe('00000000-0000-4000-8000-000000000005');
    expect(textOnly.modelRuntime?.primary).toMatchObject({
      profileId: '00000000-0000-4000-8000-000000000006',
      capabilities: { streamingText: true, toolCalling: false },
    });

    const toolsEnabled = loadServerConfig({
      ...base,
      CMASTER_TOOL_RUNTIME_ENABLED: 'true',
    }, []);
    expect(toolsEnabled.developmentIdentity.activeAgentRevisionId)
      .toBe('00000000-0000-4000-8000-000000000012');
    expect(toolsEnabled.modelRuntime?.primary).toMatchObject({
      profileId: '00000000-0000-4000-8000-000000000013',
      capabilities: { streamingText: true, toolCalling: true },
    });
  });

  it('selects immutable Context-enabled Agent and Model revisions only when Slice 4 is enabled', () => {
    const base = {
      DATABASE_URL: 'postgresql://localhost/cmaster',
      NEXT_ARCHITECTURE_ENABLED: 'true',
      CMASTER_AI_SDK_RUNTIME_ENABLED: 'true',
      CMASTER_TOOL_RUNTIME_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_BASE_URL: 'https://models.example.test/v1',
      CMASTER_PRIMARY_MODEL_ID: 'primary-model',
      CMASTER_PRIMARY_MODEL_API_KEY: 'secret',
    };

    expect(() => loadServerConfig({
      ...base,
      CMASTER_CONTEXT_ARTIFACTS_ENABLED: 'true',
    }, [])).toThrow('Primary Model Context Window');

    const enabled = loadServerConfig({
      ...base,
      CMASTER_CONTEXT_ARTIFACTS_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS: '131072',
    }, []);
    expect(enabled.features.contextArtifacts).toBe(true);
    expect(enabled.developmentIdentity).toMatchObject({
      activeAgentRevisionId: '00000000-0000-4000-8000-000000000015',
      contextPolicyRevision: 'slice4-context-v1',
    });
    expect(enabled.modelRuntime?.primary).toMatchObject({
      profileId: '00000000-0000-4000-8000-000000000016',
      contextLimits: { contextWindowTokens: 131072, maxOutputTokens: 16384 },
    });

    expect(() => loadServerConfig({
      ...base,
      CMASTER_CONTEXT_ARTIFACTS_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS: '131072',
      CMASTER_CONTEXT_PRIMARY_MODEL_PROFILE_ID: '00000000-0000-4000-8000-000000000013',
    }, [])).toThrow('Model Profile IDs must be new and distinct');
    expect(() => loadServerConfig({
      ...base,
      CMASTER_CONTEXT_ARTIFACTS_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS: '131072',
      CMASTER_DEV_CONTEXT_ARTIFACT_AGENT_REVISION_ID: '00000000-0000-4000-8000-000000000012',
    }, [])).toThrow('Agent Revision ID must be distinct');
  });

  it('keeps Context and Artifacts disabled by default and requires Tool Runtime', () => {
    expect(loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      CMASTER_DEV_CONTEXT_ARTIFACT_AGENT_REVISION_ID: 'dormant-invalid-id',
      CMASTER_CONTEXT_PRIMARY_MODEL_PROFILE_ID: 'dormant-invalid-id',
      CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS: 'dormant-invalid-limit',
      CMASTER_PRIMARY_MODEL_MAX_OUTPUT_TOKENS: '-1',
    }, []).features.contextArtifacts).toBe(false);

    const aiSdkOnly = loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      NEXT_ARCHITECTURE_ENABLED: 'true',
      CMASTER_AI_SDK_RUNTIME_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_BASE_URL: 'https://models.example.test/v1',
      CMASTER_PRIMARY_MODEL_ID: 'primary-model',
      CMASTER_PRIMARY_MODEL_API_KEY: 'secret',
    }, []);
    const agentConfiguration = resolveDevelopmentAgentConfig(aiSdkOnly);
    expect(agentConfiguration).toMatchObject({
      activeRevisionId: '00000000-0000-4000-8000-000000000005',
      aiSdkRevisionId: '00000000-0000-4000-8000-000000000005',
    });
    expect(agentConfiguration).not.toHaveProperty('contextArtifactRevisionId');
    expect(agentConfiguration).not.toHaveProperty('toolRevisionId');

    expect(() => loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      NEXT_ARCHITECTURE_ENABLED: 'true',
      CMASTER_AI_SDK_RUNTIME_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_BASE_URL: 'https://models.example.test/v1',
      CMASTER_PRIMARY_MODEL_ID: 'primary-model',
      CMASTER_PRIMARY_MODEL_API_KEY: 'secret',
      CMASTER_CONTEXT_ARTIFACTS_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS: '131072',
    }, [])).toThrow('Context and Artifacts require Tool Runtime');
  });

  it('requires and selects immutable Fallback Context limits when configured', () => {
    const environment = {
      DATABASE_URL: 'postgresql://localhost/cmaster',
      NEXT_ARCHITECTURE_ENABLED: 'true',
      CMASTER_AI_SDK_RUNTIME_ENABLED: 'true',
      CMASTER_TOOL_RUNTIME_ENABLED: 'true',
      CMASTER_CONTEXT_ARTIFACTS_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_BASE_URL: 'https://primary.example.test/v1',
      CMASTER_PRIMARY_MODEL_ID: 'primary-model',
      CMASTER_PRIMARY_MODEL_API_KEY: 'primary-secret',
      CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS: '131072',
      CMASTER_FALLBACK_MODEL_BASE_URL: 'https://fallback.example.test/v1',
      CMASTER_FALLBACK_MODEL_ID: 'fallback-model',
      CMASTER_FALLBACK_MODEL_API_KEY: 'fallback-secret',
    };
    expect(() => loadServerConfig(environment, []))
      .toThrow('Fallback Model Context Window');

    const configured = loadServerConfig({
      ...environment,
      CMASTER_FALLBACK_MODEL_CONTEXT_WINDOW_TOKENS: '65536',
      CMASTER_FALLBACK_MODEL_MAX_OUTPUT_TOKENS: '8192',
    }, []);
    expect(configured.modelRuntime?.fallback).toMatchObject({
      profileId: '00000000-0000-4000-8000-000000000017',
      contextLimits: { contextWindowTokens: 65536, maxOutputTokens: 8192 },
    });
  });

  it('rejects Context limits that leave no safe model input capacity', () => {
    expect(() => loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      NEXT_ARCHITECTURE_ENABLED: 'true',
      CMASTER_AI_SDK_RUNTIME_ENABLED: 'true',
      CMASTER_TOOL_RUNTIME_ENABLED: 'true',
      CMASTER_CONTEXT_ARTIFACTS_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_BASE_URL: 'https://models.example.test/v1',
      CMASTER_PRIMARY_MODEL_ID: 'primary-model',
      CMASTER_PRIMARY_MODEL_API_KEY: 'secret',
      CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS: '20000',
      CMASTER_PRIMARY_MODEL_MAX_OUTPUT_TOKENS: '16384',
    }, [])).toThrow('must exceed Max Output and safety margin');

    expect(() => loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      NEXT_ARCHITECTURE_ENABLED: 'true',
      CMASTER_AI_SDK_RUNTIME_ENABLED: 'true',
      CMASTER_TOOL_RUNTIME_ENABLED: 'true',
      CMASTER_CONTEXT_ARTIFACTS_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_BASE_URL: 'https://models.example.test/v1',
      CMASTER_PRIMARY_MODEL_ID: 'primary-model',
      CMASTER_PRIMARY_MODEL_API_KEY: 'secret',
      CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS: '2147483648',
    }, [])).toThrow();

    expect(() => loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      NEXT_ARCHITECTURE_ENABLED: 'true',
      CMASTER_AI_SDK_RUNTIME_ENABLED: 'true',
      CMASTER_TOOL_RUNTIME_ENABLED: 'true',
      CMASTER_CONTEXT_ARTIFACTS_ENABLED: 'true',
      CMASTER_PRIMARY_MODEL_BASE_URL: 'https://primary.example.test/v1',
      CMASTER_PRIMARY_MODEL_ID: 'primary-model',
      CMASTER_PRIMARY_MODEL_API_KEY: 'primary-secret',
      CMASTER_PRIMARY_MODEL_CONTEXT_WINDOW_TOKENS: '100000',
      CMASTER_PRIMARY_MODEL_MAX_OUTPUT_TOKENS: '60000',
      CMASTER_FALLBACK_MODEL_BASE_URL: 'https://fallback.example.test/v1',
      CMASTER_FALLBACK_MODEL_ID: 'fallback-model',
      CMASTER_FALLBACK_MODEL_API_KEY: 'fallback-secret',
      CMASTER_FALLBACK_MODEL_CONTEXT_WINDOW_TOKENS: '10000',
      CMASTER_FALLBACK_MODEL_MAX_OUTPUT_TOKENS: '1000',
    }, [])).toThrow('safety margin');
  });

  it('parses an explicit hostname-only HTTPS fetch allowlist', () => {
    expect(loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      CMASTER_HTTP_FETCH_ALLOWED_HOSTS: 'docs.example.test, API.example.test',
    }, []).toolRuntime.httpFetchAllowedHosts).toEqual([
      'docs.example.test', 'api.example.test',
    ]);
    expect(() => loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/cmaster',
      CMASTER_HTTP_FETCH_ALLOWED_HOSTS: 'https://docs.example.test/path',
    }, [])).toThrow('hostnames only');
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
