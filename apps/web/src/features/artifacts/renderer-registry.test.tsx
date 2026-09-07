import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArtifactCardContent } from './artifact-card';
import { MarkdownArtifactRenderer, UnknownArtifactRenderer } from './artifact-renderers';
import { safeArtifactLink, selectArtifactRenderer } from './renderer-registry';

describe('Artifact Renderer Registry', () => {
  it('selects Text and Markdown renderers with an unknown fallback', () => {
    expect(selectArtifactRenderer('text', 'text/plain; charset=utf-8')).toBe('plain_text');
    expect(selectArtifactRenderer('text', 'text/markdown; charset=utf-8')).toBe('markdown');
    expect(selectArtifactRenderer('future-kind', 'application/x-future')).toBe('fallback');
    expect(renderToStaticMarkup(
      <UnknownArtifactRenderer downloadUrl="/api/v1/artifacts/a/versions/v/content" />,
    )).toContain('Download exact Version');
    const fallbackCard = renderToStaticMarkup(<ArtifactCardContent
      state={{
        title: 'Future Artifact',
        kind: 'future-kind',
        versionNumber: 3,
        mediaType: 'application/x-future',
      }}
      contentUrl="/api/v1/artifacts/a/versions/v/content"
    />);
    expect(fallbackCard).toContain('Future Artifact');
    expect(fallbackCard).toContain('Version 3');
    expect(fallbackCard).toContain('/api/v1/artifacts/a/versions/v/content');
  });

  it('does not render raw HTML, scripts, or dangerous Markdown links', () => {
    const markup = renderToStaticMarkup(
      <MarkdownArtifactRenderer
        content={'# Safe\n<script>alert(1)</script>\n[bad](javascript:alert(1))\n[good](https://example.test)\n![track](https://tracker.example/pixel)'}
      />,
    );
    expect(markup).toContain('<h1>Safe</h1>');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('javascript:');
    expect(markup).toContain('https://example.test');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('tracker.example');
    expect(safeArtifactLink('data:text/html,unsafe')).toBeUndefined();
  });
});
