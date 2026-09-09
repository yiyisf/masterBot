import { describe, expect, it } from 'vitest';
import {
  workspaceConversationPageSchema,
  workspaceSummarySchema,
} from './workspace.js';

const conversation = {
  id: '00000000-0000-4000-8000-000000000101',
  title: 'Quarterly planning',
  preview: { kind: 'text' as const, text: 'Prepare the agenda' },
  updatedAt: '2026-09-08T12:00:00.000Z',
  activity: { activeRunCount: 1, pendingActionCount: 0, latestRunStatus: 'running' as const },
};

describe('Employee Workspace contracts', () => {
  it('accepts a bounded creator-private Conversation page with an opaque cursor', () => {
    expect(workspaceConversationPageSchema.parse({
      items: [conversation],
      nextCursor: 'opaque-cursor',
    })).toEqual({ items: [conversation], nextCursor: 'opaque-cursor' });
  });

  it('represents Artifact-only preview without server-localized content', () => {
    const parsed = workspaceConversationPageSchema.parse({
      items: [{ ...conversation, title: null, preview: { kind: 'artifact' } }],
      nextCursor: null,
    });
    expect(parsed.items[0]?.preview).toEqual({ kind: 'artifact' });
  });

  it('keeps the home summary bounded and content-free', () => {
    expect(workspaceSummarySchema.parse({
      conversationCount: 3,
      activeRunCount: 1,
      pendingActionCount: 0,
    })).toEqual({ conversationCount: 3, activeRunCount: 1, pendingActionCount: 0 });
  });
});
