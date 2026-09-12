// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('keeps a 2,000-item Timeline DOM bounded in semantic order', () => {
    const timeline = Array.from({ length: 2_000 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      sequence: index + 1,
      category: 'run' as const,
      presentation: 'run_started' as const,
      occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    }));
    const view = render(<RunActivity projection={{ ...base, timeline }} locale="en-US"
      unknownActivity={false} commands={{ loadOlder: vi.fn() }} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.length).toBeLessThanOrEqual(120);
    expect(rows.at(-1)?.textContent).toContain('Run started');
    expect(rows.at(-1)?.querySelector('time')?.dateTime).toBe(timeline.at(-1)?.occurredAt);
    expect(screen.getByRole('button', { name: 'Show earlier loaded activity' })).toBeTruthy();
    rows[0]?.focus();
    const focusedSequence = rows[0]?.dataset.timelineSequence;
    const appended = [...timeline, ...Array.from({ length: 500 }, (_, index) => ({
      ...timeline[0]!,
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      sequence: timeline.length + index + 1,
    }))];
    view.rerender(<RunActivity projection={{ ...base, timeline: appended }} locale="en-US"
      unknownActivity={false} commands={{ loadOlder: vi.fn() }} />);
    expect((document.activeElement as HTMLElement).dataset.timelineSequence).toBe(focusedSequence);
    expect(screen.getAllByRole('listitem').length).toBeLessThanOrEqual(120);
    const earlier = screen.getByRole('button', { name: 'Show earlier loaded activity' });
    fireEvent.blur(document.activeElement, { relatedTarget: earlier });
    fireEvent.click(earlier);
    expect(screen.getAllByRole('listitem')[0]?.dataset.timelineSequence).toBe('2301');
  });

  it('announces semantic Run state without exposing token-by-token Draft text', () => {
    const view = render(<RunActivity projection={base} locale="en-US"
      unknownActivity={false} commands={{ loadOlder: vi.fn() }} />);
    const live = screen.getByRole('status');
    expect(live.textContent).toBe('Run active. Response is being generated.');
    view.rerender(<RunActivity projection={{
      ...base, draft: { ...base.draft!, text: 'Temporary output plus another token' },
    }} locale="en-US" unknownActivity={false} commands={{ loadOlder: vi.fn() }} />);
    expect(live.textContent).toBe('Run active. Response is being generated.');
    expect(live.textContent).not.toContain('another token');
  });

  it('localizes technical labels, numbers, and usage', () => {
    render(<RunActivity projection={{
      ...base,
      technical: {
        correlationId: runId,
        agentRevisionId: '20000000-0000-4000-8000-000000000001',
        modelDisplayName: 'Internal model', fallback: true,
        usage: { inputTokens: 10_000, outputTokens: 2_345, totalTokens: 12_345 },
        safeErrorCode: 'model_timeout',
      },
    }} locale="zh-CN" unknownActivity={false} commands={{ loadOlder: vi.fn() }} />);
    expect(screen.getByText('关联 ID')).toBeTruthy();
    expect(screen.getByText('Agent Revision ID')).toBeTruthy();
    expect(screen.getByText('汇总用量')).toBeTruthy();
    expect(screen.getByText('12,345 个 token')).toBeTruthy();
    expect(screen.getByText('错误代码')).toBeTruthy();
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
