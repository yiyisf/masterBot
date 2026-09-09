// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { ConversationThread } from './conversation-thread';

afterEach(cleanup);

const messages = [{
  id: '10000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000002',
  conversationId: '10000000-0000-4000-8000-000000000003',
  sequence: 1,
  author: 'employee' as const,
  parts: [{ type: 'text' as const, text: 'Try this work' }],
  createdAt: '2026-01-01T00:00:00.000Z',
}];
const runs = [
  {
    id: '10000000-0000-4000-8000-000000000004',
    triggerMessageId: messages[0]!.id,
    status: 'failed' as const,
    retryable: true,
    createdAt: '2026-01-01T00:01:00.000Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    triggerMessageId: messages[0]!.id,
    status: 'succeeded' as const,
    retryable: false,
    createdAt: '2026-01-01T00:02:00.000Z',
  },
];

describe('Conversation Thread presentation', () => {
  it('groups every Run attempt under its Trigger Message and exposes nested Run links', () => {
    render(<ConversationThread
      conversationId={messages[0]!.conversationId}
      locale="en-US"
      messages={messages}
      runs={runs}
      canLoadOlder={false}
      canLoadOlderRuns={false}
      hasNewContent={false}
      canRunAgain
      commands={{ loadOlder: vi.fn(), loadOlderRuns: vi.fn(), showNewContent: vi.fn(), runAgain: vi.fn() }}
    />);

    expect(screen.getAllByRole('link', { name: /Run/ })).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Failed/ }).getAttribute('href')).toBe(
      `/workspace/conversations/${messages[0]!.conversationId}/runs/${runs[0]!.id}`,
    );
    expect((screen.getByRole('button', { name: 'Run again' }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it('offers keyboard-accessible history and new-content commands without stealing focus', () => {
    const loadOlder = vi.fn();
    const showNewContent = vi.fn();
    render(<ConversationThread
      conversationId={messages[0]!.conversationId}
      locale="en-US"
      messages={messages}
      runs={[]}
      canLoadOlder
      canLoadOlderRuns={false}
      hasNewContent
      canRunAgain
      commands={{ loadOlder, loadOlderRuns: vi.fn(), showNewContent, runAgain: vi.fn() }}
    />);
    const older = screen.getByRole('button', { name: 'Load older messages' });
    older.focus();
    fireEvent.click(older);
    expect(loadOlder).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(older);
    fireEvent.click(screen.getByRole('button', { name: 'Show new content' }));
    expect(showNewContent).toHaveBeenCalledOnce();
  });
});
