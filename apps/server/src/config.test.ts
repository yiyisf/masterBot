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
});
