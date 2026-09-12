// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../features/workspace/conversation-overview', () => ({
  ConversationOverview: ({ conversationId }: { conversationId: string }) => (
    <section aria-label="Conversation Thread">Conversation {conversationId}</section>
  ),
}));
vi.mock('../../../../../../features/workspace/run-detail', () => ({
  RunDetail: ({ runId }: { runId: string }) => (
    <aside aria-label="Run Detail">Run {runId}</aside>
  ),
}));

import ConversationRunPage from './page';

beforeEach(() => { process.env.CMASTER_EMPLOYEE_WORKSPACE_ENABLED = 'true'; });
afterEach(() => { cleanup(); delete process.env.CMASTER_EMPLOYEE_WORKSPACE_ENABLED; });

describe('Conversation Run Workspace route', () => {
  it('keeps Conversation context and exact Run Detail together for responsive presentation', async () => {
    render(await ConversationRunPage({ params: Promise.resolve({
      conversationId: '10000000-0000-4000-8000-000000000001',
      runId: '10000000-0000-4000-8000-000000000002',
    }) }));
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Conversation Thread' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Run Detail' })).toBeTruthy();
  });
});
