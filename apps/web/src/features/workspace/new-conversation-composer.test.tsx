// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewConversationComposer } from './new-conversation-composer';

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
const { replace } = navigation;
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('./workspace-providers', () => ({
  useWorkspacePreferences: () => ({ locale: 'en-US' }),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  replace.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_CMASTER_API_URL;
});

describe('new Conversation route', () => {
  it('does not persist or call Server before first submit', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<NewConversationComposer />);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    fetchSpy.mockRestore();
  });

  it('provides accessible feedback when input exceeds the Contract limit', () => {
    render(<NewConversationComposer />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x'.repeat(32 * 1024 + 1) } });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('alert').textContent).toContain('cannot exceed');
  });

  it('completes the Browser happy path through three separate generated-client Commands', async () => {
    const conversationId = '00000000-0000-4000-8000-000000000101';
    const messageId = '00000000-0000-4000-8000-000000000102';
    const runId = '00000000-0000-4000-8000-000000000103';
    const calls: string[] = [];
    const response = (status: number, body?: unknown) => new Response(
      body === undefined ? undefined : JSON.stringify(body),
      { status, headers: { 'content-type': 'application/json' } },
    );
    process.env.NEXT_PUBLIC_CMASTER_API_URL = 'http://localhost';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
      const url = request?.url ?? String(input);
      const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
      calls.push(`${method} ${url}`);
      if (method === 'GET' && url.includes('/conversations/by-command/')) return response(404, {});
      if (method === 'POST' && url.endsWith('/api/v1/conversations')) return response(201, {
        id: conversationId,
        organizationId: '00000000-0000-4000-8000-000000000001',
        createdByPrincipalId: '00000000-0000-4000-8000-000000000002',
        lastMessageSequence: 0,
        createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z',
      });
      if (method === 'GET' && url.includes('/messages/by-command/')) return response(404, {});
      if (method === 'POST' && url.includes(`/conversations/${conversationId}/messages`)) return response(201, {
        id: messageId,
        organizationId: '00000000-0000-4000-8000-000000000001',
        conversationId,
        sequence: 1,
        author: 'employee',
        parts: [{ type: 'text', text: 'Prepare the brief' }],
        createdAt: '2026-09-09T00:00:01.000Z',
      });
      if (method === 'GET' && url.includes('/runs/by-command/')) return response(404, {});
      if (method === 'POST' && url.endsWith('/api/v1/runs')) return response(202, {
        runId, eventsUrl: `/api/v1/runs/${runId}/events`,
      });
      return response(500, {});
    }));
    render(<NewConversationComposer />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Prepare the brief' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith(
      `/workspace/conversations/${conversationId}/runs/${runId}`,
    ));
    expect(calls.filter((call) => call.startsWith('POST'))).toHaveLength(3);
    expect(calls.some((call) => call.includes('/chat'))).toBe(false);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('restores a per-tab Draft without putting it in operation metadata', async () => {
    window.sessionStorage.setItem(
      'cmaster.workspace.new-conversation.draft.v1',
      'Draft restored after refresh',
    );
    render(<NewConversationComposer />);
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty(
      'value', 'Draft restored after refresh',
    ));
    expect(window.sessionStorage.getItem(
      'cmaster.workspace.new-conversation.operation.v1',
    )).toBeNull();
  });
});
