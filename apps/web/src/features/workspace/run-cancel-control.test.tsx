// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunCancelControl } from './run-cancel-control';

afterEach(cleanup);

describe('Run cancellation decision surface', () => {
  it('uses one accessible dialog, explains no rollback, and returns Focus on Escape', async () => {
    render(<RunCancelControl locale="en-US" cancellable
      cancel={vi.fn(async () => ({ kind: 'cancelled' }))} refresh={vi.fn(async () => {})} />);
    const trigger = screen.getByRole('button', { name: 'Cancel run' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Cancel this run?' });
    expect(dialog.textContent).toMatch(/does not undo completed tool effects/i);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const goBack = screen.getByRole('button', { name: 'Go back' });
    const confirm = screen.getByRole('button', { name: 'Confirm cancellation' });
    expect(document.activeElement).toBe(goBack);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(goBack);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('refreshes authority and explains an in-flight or too-late result without implying rollback', async () => {
    const refresh = vi.fn(async () => {});
    render(<RunCancelControl locale="en-US" cancellable
      cancel={vi.fn(async () => ({ kind: 'tool_effect_in_flight' }))} refresh={refresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/tool effect is still in flight/i);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(status);
  });
});
