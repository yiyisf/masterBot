import { describe, expect, it } from 'vitest';
import {
  artifactContentHeadersSchema,
  artifactPageSchema,
  artifactVersionPageSchema,
} from './artifacts.js';

const artifact = {
  id: '10000000-0000-4000-8000-000000000001',
  title: 'Quarterly report', kind: 'text', currentVersionNumber: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const version = {
  id: '10000000-0000-4000-8000-000000000002',
  artifactId: artifact.id, versionNumber: 2,
  mediaType: 'text/markdown; charset=utf-8', sizeBytes: 42,
  createdAt: '2026-01-02T00:00:00.000Z',
};

describe('Artifact Library contracts', () => {
  it('pins every list summary to an exact current Version', () => {
    expect(artifactPageSchema.parse({
      items: [{ artifact, currentVersion: version }], nextCursor: null,
    })).toEqual({ items: [{ artifact, currentVersion: version }], nextCursor: null });
  });

  it('rejects a floating or mismatched current Version summary', () => {
    expect(() => artifactPageSchema.parse({
      items: [{
        artifact,
        currentVersion: { ...version, versionNumber: 1 },
      }],
      nextCursor: null,
    })).toThrow();
  });

  it('provides bounded Version switching metadata without content internals', () => {
    const page = artifactVersionPageSchema.parse({
      artifact, items: [version], beforeVersionNumber: null,
    });
    expect(page.items[0]?.id).toBe(version.id);
    expect(JSON.stringify(page)).not.toMatch(/hash|storage|path|contentId/i);
  });

  it('contracts safe exact-content response headers', () => {
    expect(artifactContentHeadersSchema.parse({
      'accept-ranges': 'bytes', 'content-length': '42',
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': 'attachment; filename="Quarterly-report.md"',
      'x-content-type-options': 'nosniff',
    })).toMatchObject({ 'x-content-type-options': 'nosniff' });
  });
});
