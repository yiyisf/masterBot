import { describe, expect, it } from 'vitest';
import { pendingInterruptPageSchema } from './pending-interactions.js';

const ids = {
  conversation: '10000000-0000-4000-8000-000000000001',
  message: '10000000-0000-4000-8000-000000000002',
  run: '10000000-0000-4000-8000-000000000003',
  interrupt: '10000000-0000-4000-8000-000000000004',
  approval: '10000000-0000-4000-8000-000000000005',
};

describe('Pending Interrupt presentation contract', () => {
  it('separates immutable Employee Confirmation from Uncertain Tool Outcome Review', () => {
    const page = pendingInterruptPageSchema.parse({
      items: [
        {
          kind: 'employee_confirmation',
          conversationId: ids.conversation,
          triggerMessageId: ids.message,
          runId: ids.run,
          interruptId: ids.interrupt,
          createdAt: '2026-01-01T00:00:00.000Z',
          decisionStatus: 'pending',
          allowedResponses: ['confirm', 'reject'],
          approvalSubject: {
            approvalId: ids.approval,
            title: 'Fetch documentation',
            details: { host: 'docs.example.test' },
          },
        },
        {
          kind: 'uncertain_tool_outcome_review',
          conversationId: ids.conversation,
          triggerMessageId: ids.message,
          runId: ids.run,
          interruptId: '10000000-0000-4000-8000-000000000006',
          createdAt: '2026-01-01T00:01:00.000Z',
          allowedResponses: ['continue_with_uncertainty'],
          subject: { title: 'Review uncertain delivery', details: {} },
        },
      ],
      nextCursor: null,
    });
    expect(page.items.map((item) => item.kind)).toEqual([
      'employee_confirmation', 'uncertain_tool_outcome_review',
    ]);
    expect(JSON.stringify(page)).not.toContain('requestHash');
    expect(JSON.stringify(page)).not.toContain('toolRevisionRef');
  });

  it('can represent a recorded immutable decision while its Run is still resuming', () => {
    const page = pendingInterruptPageSchema.parse({
      items: [{
        kind: 'employee_confirmation',
        conversationId: ids.conversation,
        triggerMessageId: ids.message,
        runId: ids.run,
        interruptId: ids.interrupt,
        createdAt: '2026-01-01T00:00:00.000Z',
        decisionStatus: 'confirmed',
        allowedResponses: [],
        approvalSubject: { approvalId: ids.approval, title: 'Fetch documentation', details: {} },
      }],
      nextCursor: null,
    });
    expect(page.items[0]?.allowedResponses).toEqual([]);
  });

  it('rejects editable or reusable permission responses', () => {
    expect(() => pendingInterruptPageSchema.parse({
      items: [{
        kind: 'employee_confirmation',
        conversationId: ids.conversation,
        triggerMessageId: ids.message,
        runId: ids.run,
        interruptId: ids.interrupt,
        createdAt: '2026-01-01T00:00:00.000Z',
        decisionStatus: 'pending',
        allowedResponses: ['always_allow'],
        approvalSubject: {
          approvalId: ids.approval, title: 'Fetch documentation', details: {},
        },
      }],
      nextCursor: null,
    })).toThrow();
  });
});
