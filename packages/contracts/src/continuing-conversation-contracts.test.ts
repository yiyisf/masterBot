import { describe, expect, it } from 'vitest';
import {
  messagePageSchema,
  renameConversationRequestSchema,
} from './conversations.js';
import {
  conversationRunSummarySchema,
} from './composer.js';

describe('continuing Conversation contracts', () => {
  it('carries the exclusive cursor for the preceding Message page', () => {
    expect(messagePageSchema.parse({
      items: [], nextSequence: 0, beforeSequence: 51,
    })).toEqual({ items: [], nextSequence: 0, beforeSequence: 51 });
    expect(() => messagePageSchema.parse({
      items: [], nextSequence: 0, beforeSequence: 0,
    })).toThrow();
  });

  it('marks only eligible Run attempts as retryable', () => {
    expect(conversationRunSummarySchema.parse({
      id: '10000000-0000-4000-8000-000000000001',
      triggerMessageId: '10000000-0000-4000-8000-000000000002',
      status: 'failed', retryable: true, createdAt: '2026-01-01T00:00:00.000Z',
    }).retryable).toBe(true);
  });

  it('normalizes a bounded explicit Conversation title', () => {
    expect(renameConversationRequestSchema.parse({ title: '  Release plan  ' }))
      .toEqual({ title: 'Release plan' });
    expect(() => renameConversationRequestSchema.parse({ title: '   ' })).toThrow();
    expect(() => renameConversationRequestSchema.parse({ title: 'x'.repeat(201) })).toThrow();
  });
});
