// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ids = {
  conversation: '10000000-0000-4000-8000-000000000001',
  run: '10000000-0000-4000-8000-000000000002',
};
const get = vi.hoisted(() => vi.fn(async (path: string) => path === '/api/v1/runs/{runId}'
  ? {
      data: {
        id: '10000000-0000-4000-8000-000000000002',
        conversationId: '10000000-0000-4000-8000-000000000001',
        trigger: { type: 'message', messageId: '10000000-0000-4000-8000-000000000003' },
        status: 'succeeded', lastSequence: 2,
      },
    }
  : { data: { items: [], nextSequence: 0 } }));
vi.mock('./workspace-providers', () => ({
  useWorkspacePreferences: () => ({ locale: 'en-US' }),
}));
vi.mock('@cmaster/contracts', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('@cmaster/contracts')>();
  return { ...original, createContractClient: () => ({ GET: get }) };
});

import { RunDetail } from './run-detail';

afterEach(() => {
  cleanup();
  get.mockClear();
});

describe('nested Conversation Run detail', () => {
  it('restores the Run in its Conversation and moves focus to the loaded heading', async () => {
    render(<RunDetail conversationId={ids.conversation} runId={ids.run} />);

    const heading = await screen.findByRole('heading', { name: 'succeeded' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByRole('link', { name: /conversation/i }).getAttribute('href'))
      .toBe(`/workspace/conversations/${ids.conversation}`);
    expect(get).toHaveBeenCalledWith('/api/v1/runs/{runId}', {
      params: { path: { runId: ids.run } },
    });
  });
});
