import { describe, expect, it } from 'vitest';
import { systemStatusSchema } from './system-status.js';

describe('systemStatusSchema', () => {
  it('accepts the versioned minimal status contract', () => {
    const status = systemStatusSchema.parse({
      contractVersion: 'v1',
      service: 'cmaster-next',
      role: 'api',
      status: 'ok',
      postgres: 'available',
      nextArchitectureEnabled: true,
    });

    expect(status.status).toBe('ok');
  });

  it('rejects details outside the public contract', () => {
    const result = systemStatusSchema.safeParse({
      contractVersion: 'v1',
      service: 'cmaster-next',
      role: 'api',
      status: 'ok',
      postgres: 'available',
      nextArchitectureEnabled: true,
      databaseUrl: 'postgresql://secret',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('databaseUrl');
    }
  });
});
