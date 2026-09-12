import { isBrowserUuid } from '../workspace/browser-state-validation';

const key = 'cmaster.artifact-preview-origin';

export interface ArtifactPreviewOrigin {
  readonly artifactId: string;
  readonly returnUrl: string;
  readonly focusId: string;
}

function isWorkspaceUrl(value: string): boolean {
  return value === '/workspace' || value.startsWith('/workspace/');
}

export function rememberArtifactPreviewOrigin(origin: ArtifactPreviewOrigin): void {
  if (!isBrowserUuid(origin.artifactId)
    || !isWorkspaceUrl(origin.returnUrl) || !isBrowserUuid(origin.focusId)) return;
  try { sessionStorage.setItem(key, JSON.stringify(origin)); } catch { /* Focus falls back to route heading. */ }
}

export function readArtifactPreviewOrigin(): ArtifactPreviewOrigin | undefined {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!value || typeof value !== 'object'
      || !('artifactId' in value) || !isBrowserUuid(value.artifactId)
      || !('returnUrl' in value) || typeof value.returnUrl !== 'string'
      || !isWorkspaceUrl(value.returnUrl)
      || !('focusId' in value) || !isBrowserUuid(value.focusId)) return undefined;
    return {
      artifactId: value.artifactId,
      returnUrl: value.returnUrl,
      focusId: value.focusId,
    };
  } catch {
    return undefined;
  }
}

export function consumeArtifactPreviewOrigin(returnUrl: string): ArtifactPreviewOrigin | undefined {
  const origin = readArtifactPreviewOrigin();
  if (!origin || origin.returnUrl !== returnUrl) return undefined;
  try { sessionStorage.removeItem(key); } catch { /* Storage cleanup is optional. */ }
  return origin;
}
