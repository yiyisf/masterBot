// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunProjection } from '../../lib/run-projection';
import { RunActivity } from './run-activity';

const runId = '10000000-0000-4000-8000-000000000001';
const base: RunProjection = {
  runId,
  conversationId: '10000000-0000-4000-8000-000000000002',
  triggerMessageId: '10000000-0000-4000-8000-000000000003',
  status: 'working',
  cancellable: true,
  lastAppliedSequence: 8,
  draft: { generation: 2, text: 'Temporary output', state: 'streaming' },
  timeline: [{
    id: '10000000-0000-4000-8000-000000000004',
    sequence: 7,
    category: 'tool',
    presentation: 'tool_succeeded',
    occurredAt: '2026-01-01T00:00:00.000Z',
    tool: {
      capability: 'cmaster.lookup', status: 'succeeded',
      title: 'Lookup completed', details: { records: '3' },
    },
  }],
  hasEarlierTimeline: false,
  technical: { correlationId: runId, modelDisplayName: 'Internal model' },
  artifacts: [],
  hasGap: false,
  calibrationRequired: false,
};

afterEach(cleanup);

describe('employee-facing Run activity', () => {
  it('renders temporary Draft and generic Tool activity from CMaster View Models', () => {
    render(<RunActivity projection={base} locale="en-US" unknownActivity={false}
      commands={{ loadOlder: vi.fn() }} />);
    expect(screen.getByText('Temporary output')).toBeTruthy();
    expect(screen.getByText('Temporary response')).toBeTruthy();
    expect(screen.getByText('Lookup completed')).toBeTruthy();
    expect(screen.getByText('records')).toBeTruthy();
    expect(document.body.textContent).not.toContain('tool.succeeded');
  });

  it('uses a localized fallback for unknown Projection and Tool types', () => {
    render(<RunActivity projection={{
      ...base,
      timeline: [{
        ...base.timeline[0]!,
        tool: { capability: 'future.tool', status: 'unknown' },
      }],
    }} locale="en-US" unknownActivity commands={{ loadOlder: vi.fn() }} />);
    expect(screen.getByText('Tool activity')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Activity changed');
  });
});
