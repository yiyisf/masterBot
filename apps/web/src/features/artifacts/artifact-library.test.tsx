// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());
const readContent = vi.hoisted(() => vi.fn(async () => '# Historical body'));
const getVersion = vi.hoisted(() => vi.fn());
const ids = {
  artifact: '10000000-0000-4000-8000-000000000001',
  current: '10000000-0000-4000-8000-000000000002',
  historical: '10000000-0000-4000-8000-000000000003',
};
const artifact = {
  id: ids.artifact, title: 'Quarterly report', kind: 'text', currentVersionNumber: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const current = {
  id: ids.current, artifactId: ids.artifact, versionNumber: 2,
  mediaType: 'text/markdown; charset=utf-8', sizeBytes: 20,
  createdAt: '2026-01-02T00:00:00.000Z',
};
const historical = { ...current, id: ids.historical, versionNumber: 1 };

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('./artifact-browser-api', () => ({
  createArtifactBrowserApi: () => ({
    list: vi.fn(async () => ({
      items: [{ artifact, currentVersion: current }], nextCursor: null,
    })),
    listVersions: vi.fn(async () => ({
      artifact, items: [current, historical], beforeVersionNumber: null,
    })),
    getVersion,
    readContent,
  }),
}));

import { ArtifactLibrary } from './artifact-library';
import { WorkspaceProviders } from '../workspace/workspace-providers';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) });
  localStorage.setItem('cmaster.workspace.locale', 'en-US');
  getVersion.mockResolvedValue(historical);
});
afterEach(() => {
  cleanup(); localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
});

describe('Artifact Library exact-Version experience', () => {
  it('marks history, previews only on request, and switches the exact URL', async () => {
    render(<WorkspaceProviders><ArtifactLibrary selected={{
      artifactId: ids.artifact, artifactVersionId: ids.historical,
    }} /></WorkspaceProviders>);
    expect(await screen.findByText('Historical Version 1')).toBeTruthy();
    expect(readContent).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Version'), { target: { value: ids.current } });
    expect(push).toHaveBeenCalledWith(
      `/workspace/artifacts/${ids.artifact}/versions/${ids.current}`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview exact Version' }));
    expect(await screen.findByRole('heading', { name: 'Historical body' })).toBeTruthy();
    expect(readContent).toHaveBeenCalledWith(ids.artifact, ids.historical);
  });

  it('uses metadata/download fallback without reading unsupported content', async () => {
    getVersion.mockResolvedValueOnce({ ...historical, mediaType: 'application/pdf' });
    render(<WorkspaceProviders><ArtifactLibrary selected={{
      artifactId: ids.artifact, artifactVersionId: ids.historical,
    }} /></WorkspaceProviders>);
    expect(await screen.findByText('This type provides metadata and download only.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Preview exact Version' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Download exact Version' }).getAttribute('href'))
      .toContain(`${ids.historical}/content?disposition=attachment`);
    expect(readContent).not.toHaveBeenCalled();
  });

  it('closes a Message preview back to its exact Workspace origin', async () => {
    const returnUrl = '/workspace/conversations/20000000-0000-4000-8000-000000000001';
    sessionStorage.setItem('cmaster.artifact-preview-origin', JSON.stringify({
      artifactId: ids.artifact, returnUrl, focusId: ids.historical,
    }));
    render(<WorkspaceProviders><ArtifactLibrary selected={{
      artifactId: ids.artifact, artifactVersionId: ids.historical,
    }} /></WorkspaceProviders>);
    fireEvent.click(await screen.findByRole('link', { name: /Close details/i }));
    expect(push).toHaveBeenCalledWith(returnUrl);
  });

  it('restores Focus to the originating Artifact after closing the detail route', async () => {
    sessionStorage.setItem('cmaster.artifact-preview-origin', JSON.stringify({
      artifactId: ids.artifact, returnUrl: '/workspace/artifacts', focusId: ids.artifact,
    }));
    render(<WorkspaceProviders><ArtifactLibrary /></WorkspaceProviders>);
    const artifactLink = await screen.findByRole('link', { name: /Quarterly report/i });
    expect(artifactLink.getAttribute('href')).toBe(
      `/workspace/artifacts/${ids.artifact}/versions/${ids.current}`,
    );
    await waitFor(() => expect(document.activeElement).toBe(artifactLink));
    expect(sessionStorage.getItem('cmaster.artifact-preview-origin')).toBeNull();
  });
});
