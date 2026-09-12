import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArtifactCardContent } from './artifact-card';
import { MarkdownArtifactRenderer, UnknownArtifactRenderer } from './artifact-renderers';
import { safeArtifactLink, selectArtifactRenderer } from './renderer-registry';

describe('Artifact Renderer Registry', () => {
  it('selects Text and Markdown renderers with an unknown fallback', () => {
    expect(selectArtifactRenderer('text', 'text/plain; charset=utf-8')).toBe('plain_text');
    expect(selectArtifactRenderer('text', 'text/markdown; charset=utf-8')).toBe('markdown');
    for (const unsupported of [
      'application/pdf', 'text/html; charset=utf-8', 'application/json',
      'text/csv; charset=utf-8', 'image/png', 'audio/mpeg', 'application/zip',
      'text/x-arbitrary; charset=utf-8',
    ]) {
      expect(selectArtifactRenderer('text', unsupported)).toBe('fallback');
    }
    expect(selectArtifactRenderer('future-kind', 'application/x-future')).toBe('fallback');
    expect(renderToStaticMarkup(
      <UnknownArtifactRenderer downloadUrl="/api/v1/artifacts/a/versions/v/content" />,
    )).toContain('Download exact Version');
    expect(renderToStaticMarkup(
      <UnknownArtifactRenderer locale="zh-CN"
        downloadUrl="/api/v1/artifacts/a/versions/v/content?disposition=attachment" />,
    )).toContain('此类型不支持内联预览');
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
        content={'# Safe\n<script>alert(1)</script>\n[bad](javascript:alert(1))\n[good](https://example.test)\n![track](https://tracker.example/pixel)\n\n~~done~~\n\n| A | B |\n| - | - |\n| 1 | 2 |'}
      />,
    );
    expect(markup).toContain('<h1>Safe</h1>');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('javascript:');
    expect(markup).toContain('href="https://example.test"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('tracker.example');
    expect(markup).toContain('<del>done</del>');
    expect(markup).toContain('<table>');
    expect(safeArtifactLink('data:text/html,unsafe')).toBeUndefined();
  });
});
