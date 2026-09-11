import { describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn(async () => ({
  data: { items: [], nextCursor: null },
})));
vi.mock('@cmaster/contracts', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('@cmaster/contracts')>();
  return { ...original, createContractClient: () => ({ GET: get }) };
});

import { createPendingBrowserApi } from './pending-browser-api';

describe('Pending Browser API', () => {
  it('uses the generated Contract client for stable Pending pagination', async () => {
    const api = createPendingBrowserApi('');
    await expect(api.list('opaque-cursor', 20)).resolves.toEqual({ items: [], nextCursor: null });
    expect(get).toHaveBeenCalledWith('/api/v1/workspace/interrupts', {
      params: { query: { cursor: 'opaque-cursor', limit: 20 } },
    });
  });
});
