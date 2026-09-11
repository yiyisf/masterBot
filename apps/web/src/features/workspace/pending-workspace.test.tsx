// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingInterruptPageContract } from '@cmaster/contracts';

const list = vi.hoisted(() => vi.fn());
const resolveConfirmation = vi.hoisted(() => vi.fn());
vi.mock('./pending-browser-api', () => ({
  createPendingBrowserApi: () => ({ list }),
}));
vi.mock('./run-ui-browser-api', () => ({
  createRunUiBrowserApi: () => ({
    resolveConfirmation, continueWithUncertainty: vi.fn(),
  }),
}));

import { PendingWorkspace } from './pending-workspace';
import { WorkspaceProviders } from './workspace-providers';

const first: PendingInterruptPageContract = {
  items: [{
    kind: 'employee_confirmation', decisionStatus: 'pending',
    conversationId: '10000000-0000-4000-8000-000000000001',
    triggerMessageId: '10000000-0000-4000-8000-000000000002',
    runId: '10000000-0000-4000-8000-000000000003',
    interruptId: '10000000-0000-4000-8000-000000000004',
    createdAt: '2026-01-01T00:01:00.000Z', allowedResponses: ['confirm', 'reject'],
    approvalSubject: {
      approvalId: '10000000-0000-4000-8000-000000000005',
      title: 'Newest confirmation', details: {},
    },
  }],
  nextCursor: 'opaque-older',
};
const second: PendingInterruptPageContract = {
  items: [{
    kind: 'uncertain_tool_outcome_review',
    conversationId: '20000000-0000-4000-8000-000000000001',
    triggerMessageId: '20000000-0000-4000-8000-000000000002',
    runId: '20000000-0000-4000-8000-000000000003',
    interruptId: '20000000-0000-4000-8000-000000000004',
    createdAt: '2026-01-01T00:00:00.000Z', allowedResponses: ['continue_with_uncertainty'],
    subject: { title: 'Older review', details: {} },
  }],
  nextCursor: null,
};

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) });
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true, value: () => '30000000-0000-4000-8000-000000000001',
  });
  localStorage.setItem('cmaster.workspace.locale', 'en-US');
  list.mockImplementation(async (cursor?: string) => cursor ? second : first);
  resolveConfirmation.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

describe('Pending Workspace', () => {
  it('refreshes stale or concurrently handled work into natural current-state copy', async () => {
    list.mockResolvedValueOnce(first).mockResolvedValue({ items: [], nextCursor: null });
    resolveConfirmation.mockRejectedValueOnce(new Error('concurrent resolution'));
    render(<WorkspaceProviders><PendingWorkspace /></WorkspaceProviders>);
    await screen.findByText('Newest confirmation');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm once' }));
    expect(await screen.findByText(
      'This item was already handled. Current server state is shown.',
    )).toBeTruthy();
  });

  it('shows exact Run links and loads stable older pages', async () => {
    render(<WorkspaceProviders><PendingWorkspace /></WorkspaceProviders>);
    expect(await screen.findByText('Newest confirmation')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open run context' });
    expect(link.getAttribute('href')).toBe(
      '/workspace/conversations/10000000-0000-4000-8000-000000000001/runs/10000000-0000-4000-8000-000000000003',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load older pending work' }));
    expect(await screen.findByText('Older review')).toBeTruthy();
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('opaque-older', 20));
  });
});
