import { describe, expect, it } from 'vitest';
import {
  conversationRunPageSchema,
  operationCommandParamsSchema,
} from './composer.js';

const id = '00000000-0000-4000-8000-000000000101';

describe('recoverable Composer contracts', () => {
  it('uses an operation UUID to reconcile each separate Command', () => {
    expect(operationCommandParamsSchema.parse({ commandId: id })).toEqual({ commandId: id });
  });

  it('keeps concurrent Run attempts visible as bounded summaries', () => {
    expect(conversationRunPageSchema.parse({
      items: [{
        id,
        triggerMessageId: '00000000-0000-4000-8000-000000000102',
        status: 'running',
        retryable: false,
        createdAt: '2026-09-09T00:00:00.000Z',
      }],
    }).items).toHaveLength(1);
  });
});
