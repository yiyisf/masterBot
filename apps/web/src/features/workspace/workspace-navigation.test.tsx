// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cmaster/contracts', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('@cmaster/contracts')>();
  return {
    ...original,
    createContractClient: () => ({
      GET: vi.fn(async () => ({ data: { activeRunCount: 4, pendingActionCount: 3 } })),
    }),
  };
});

import { WorkspaceNavigation } from './workspace-navigation';
import { WorkspaceProviders } from './workspace-providers';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) });
  localStorage.setItem('cmaster.workspace.locale', 'en-US');
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe('Employee Workspace navigation', () => {
  it('shows a localized Pending entry with the active Interrupt count', async () => {
    render(<WorkspaceProviders><WorkspaceNavigation /></WorkspaceProviders>);
    const pending = await screen.findByRole('link', { name: 'Pending 3' });
    expect(pending.getAttribute('href')).toBe('/workspace/pending');
    expect(screen.getByRole('link', { name: 'Artifact Library' }).getAttribute('href'))
      .toBe('/workspace/artifacts');
    const toggle = screen.getByRole('button', { name: 'Open navigation' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('workspace-navigation-links');
    toggle.focus();
    fireEvent.keyDown(screen.getByRole('navigation'), { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });
});
