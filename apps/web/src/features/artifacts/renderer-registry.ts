export type ArtifactRendererKind = 'plain_text' | 'markdown' | 'fallback';

/** Selects a safe renderer without assuming every future Artifact kind or media type is known. */
export function selectArtifactRenderer(
  kind: string,
  mediaType: string,
): ArtifactRendererKind {
  if (kind === 'text' && mediaType === 'text/plain; charset=utf-8') return 'plain_text';
  if (kind === 'text' && mediaType === 'text/markdown; charset=utf-8') return 'markdown';
  return 'fallback';
}

export function safeArtifactLink(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, 'https://cmaster.invalid');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return value;
  } catch {
    return undefined;
  }
}
