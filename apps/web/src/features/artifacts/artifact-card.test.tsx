// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const readContent = vi.hoisted(() => vi.fn(async () => 'Exact Version body'));
const get = vi.hoisted(() => vi.fn(async (path: string) => path.endsWith('/versions')
  ? { data: { artifact: {
      id: '10000000-0000-4000-8000-000000000001', title: 'Saved result', kind: 'text',
      currentVersionNumber: 2, createdAt: '2026-01-01T00:00:00.000Z',
    }, items: [], beforeVersionNumber: null } }
  : { data: {
      id: '10000000-0000-4000-8000-000000000002',
      artifactId: '10000000-0000-4000-8000-000000000001', versionNumber: 1,
      mediaType: 'text/plain; charset=utf-8', sizeBytes: 18,
      createdAt: '2026-01-01T00:00:00.000Z',
    } }));
vi.mock('@cmaster/contracts', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('@cmaster/contracts')>();
  return {
    ...original,
    createContractClient: () => ({ GET: get }),
    readArtifactVersionContent: readContent,
  };
});

import { ArtifactCard } from './artifact-card';

afterEach(() => {
  cleanup(); sessionStorage.clear(); window.history.replaceState({}, '', '/'); vi.clearAllMocks();
});

describe('Message Artifact Reference card', () => {
  it('localizes bounded Artifact metadata', async () => {
    render(<ArtifactCard locale="zh-CN" apiUrl=""
      artifactId="10000000-0000-4000-8000-000000000001"
      artifactVersionId="10000000-0000-4000-8000-000000000002" />);
    expect(await screen.findByText('历史 Version 1')).toBeTruthy();
    expect(screen.getByText(/18 字节/u)).toBeTruthy();
  });

  it('loads only compact metadata until preview is explicitly requested', async () => {
    render(<ArtifactCard locale="en-US" apiUrl="" artifactId="10000000-0000-4000-8000-000000000001"
      artifactVersionId="10000000-0000-4000-8000-000000000002" />);
    expect(await screen.findByText('Saved result')).toBeTruthy();
    expect(screen.getByText('Historical Version 1')).toBeTruthy();
    expect(readContent).not.toHaveBeenCalled();
    const download = screen.getByRole('link', { name: 'Download exact Version' });
    expect(download.getAttribute('href')).toBe(
      '/api/v1/artifacts/10000000-0000-4000-8000-000000000001/versions/10000000-0000-4000-8000-000000000002/content?disposition=attachment',
    );

    const preview = screen.getByRole('link', { name: 'Preview exact Version' });
    expect(preview.getAttribute('href')).toBe(
      '/workspace/artifacts/10000000-0000-4000-8000-000000000001/versions/10000000-0000-4000-8000-000000000002',
    );
    window.history.replaceState({}, '', '/workspace/conversations/10000000-0000-4000-8000-000000000009');
    preview.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(preview);
    expect(JSON.parse(sessionStorage.getItem('cmaster.artifact-preview-origin') ?? 'null'))
      .toEqual({
        artifactId: '10000000-0000-4000-8000-000000000001',
        returnUrl: '/workspace/conversations/10000000-0000-4000-8000-000000000009',
        focusId: '10000000-0000-4000-8000-000000000002',
      });
    expect(readContent).not.toHaveBeenCalled();
  });
});
