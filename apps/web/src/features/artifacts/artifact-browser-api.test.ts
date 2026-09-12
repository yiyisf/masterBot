import { describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn(async (path: string) => path === '/api/v1/artifacts'
  ? { data: { items: [], nextCursor: null } }
  : { data: { artifact: {}, items: [], beforeVersionNumber: null } }));
vi.mock('@cmaster/contracts', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('@cmaster/contracts')>();
  return { ...original, createContractClient: () => ({ GET: get }) };
});

import { createArtifactBrowserApi } from './artifact-browser-api';

describe('Artifact Browser API', () => {
  it('uses generated Contracts for Artifact, Version, and exact metadata reads', async () => {
    const api = createArtifactBrowserApi('');
    await api.list('opaque', 20);
    await api.listVersions('10000000-0000-4000-8000-000000000001', 4, 20);
    await api.getVersion(
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
    );
    expect(get).toHaveBeenNthCalledWith(1, '/api/v1/artifacts', {
      params: { query: { cursor: 'opaque', limit: 20 } },
    });
    expect(get).toHaveBeenNthCalledWith(2, '/api/v1/artifacts/{artifactId}/versions', {
      params: {
        path: { artifactId: '10000000-0000-4000-8000-000000000001' },
        query: { beforeVersionNumber: 4, limit: 20 },
      },
    });
    expect(get).toHaveBeenNthCalledWith(
      3, '/api/v1/artifacts/{artifactId}/versions/{artifactVersionId}', {
        params: { path: {
          artifactId: '10000000-0000-4000-8000-000000000001',
          artifactVersionId: '10000000-0000-4000-8000-000000000002',
        } },
      },
    );
  });

  it('reads preview content through the exact generated Contract path', async () => {
    const fetchImplementation = vi.fn(async (input: string | URL | Request) => {
      const request = input instanceof Request ? input : new Request(input);
      expect(request.url).toBe('https://app.test/api/v1/artifacts/10000000-0000-4000-8000-000000000001/versions/10000000-0000-4000-8000-000000000002/content?disposition=inline');
      expect(request.credentials).toBe('include');
      return new Response('exact body', {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-content-type-options': 'nosniff',
        },
      });
    });
    const api = createArtifactBrowserApi(
      'https://app.test', fetchImplementation as typeof globalThis.fetch,
    );
    await expect(api.readContent(
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
    )).resolves.toBe('exact body');
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});
