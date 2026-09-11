// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingInterruptContract } from '@cmaster/contracts';
import { GovernedInterruptCard } from './governed-interrupt-card';

const base = {
  conversationId: '10000000-0000-4000-8000-000000000001',
  triggerMessageId: '10000000-0000-4000-8000-000000000002',
  runId: '10000000-0000-4000-8000-000000000003',
  interruptId: '10000000-0000-4000-8000-000000000004',
  createdAt: '2026-01-01T00:00:00.000Z',
};

afterEach(cleanup);

describe('governed Interrupt decision surface', () => {
  it('presents one immutable Employee Confirmation surface without an extra dialog or reusable grant', async () => {
    const item: PendingInterruptContract = {
      ...base,
      kind: 'employee_confirmation',
      decisionStatus: 'pending',
      allowedResponses: ['confirm', 'reject'],
      approvalSubject: {
        approvalId: '10000000-0000-4000-8000-000000000005',
        title: 'Fetch documentation', details: { host: 'docs.example.test' },
      },
    };
    const resolve = vi.fn(async () => ({ kind: 'still_pending' as const }));
    render(<GovernedInterruptCard item={item} locale="en-US" resolve={resolve} />);

    expect(screen.getByRole('heading', { name: 'Employee confirmation' })).toBeTruthy();
    expect(screen.getByText('Fetch documentation')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.textContent).not.toMatch(/always allow|edit parameters/i);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm once' }));
    expect(resolve).toHaveBeenCalledWith('confirm');
    const status = await screen.findByRole('status');
    await waitFor(() => expect(document.activeElement).toBe(status));
  });

  it('renders the governed decision in zh-CN without changing allowed actions', () => {
    const item: PendingInterruptContract = {
      ...base,
      kind: 'employee_confirmation', decisionStatus: 'pending',
      allowedResponses: ['confirm', 'reject'],
      approvalSubject: {
        approvalId: '10000000-0000-4000-8000-000000000005',
        title: '读取文档', details: {},
      },
    };
    render(<GovernedInterruptCard item={item} locale="zh-CN"
      resolve={vi.fn(async () => ({ kind: 'handled' }))} />);
    expect(screen.getByRole('heading', { name: 'Employee Confirmation' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '仅确认本次' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeTruthy();
  });

  it('does not call uncertain Tool Outcome Review an Approval or offer relabel/retry controls', () => {
    const item: PendingInterruptContract = {
      ...base,
      kind: 'uncertain_tool_outcome_review',
      allowedResponses: ['continue_with_uncertainty'],
      subject: { title: 'Review delivery', details: {} },
    };
    render(<GovernedInterruptCard item={item} locale="en-US"
      resolve={vi.fn(async () => ({ kind: 'handled' }))} />);
    expect(screen.getByRole('heading', { name: 'Uncertain tool outcome review' })).toBeTruthy();
    expect(screen.getByText(/does not retry the original ToolCall/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/approval|mark.*success|mark.*failed/i);
    expect(screen.getAllByRole('button').map((button) => button.textContent))
      .toEqual(['Continue with uncertainty']);
    expect(screen.getByRole('link', { name: /open run context/i }).getAttribute('href'))
      .toBe(`/workspace/conversations/${base.conversationId}/runs/${base.runId}`);
  });
});
