// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  consumeArtifactPreviewOrigin,
  readArtifactPreviewOrigin,
  rememberArtifactPreviewOrigin,
} from './artifact-focus';

const focusId = '10000000-0000-4000-8000-000000000001';
afterEach(() => sessionStorage.clear());

describe('Artifact preview Focus recovery', () => {
  it('retains a Workspace-only origin until the matching route consumes it', () => {
    rememberArtifactPreviewOrigin({
      artifactId: focusId,
      returnUrl: '/workspace/conversations/10000000-0000-4000-8000-000000000002', focusId,
    });
    expect(consumeArtifactPreviewOrigin('/workspace/artifacts')).toBeUndefined();
    expect(readArtifactPreviewOrigin()).toEqual({
      artifactId: focusId,
      returnUrl: '/workspace/conversations/10000000-0000-4000-8000-000000000002', focusId,
    });
    expect(consumeArtifactPreviewOrigin(
      '/workspace/conversations/10000000-0000-4000-8000-000000000002',
    )).toBeDefined();
    expect(readArtifactPreviewOrigin()).toBeUndefined();
  });

  it('rejects an external or lookalike return URL', () => {
    rememberArtifactPreviewOrigin({
      artifactId: focusId, returnUrl: '/workspace.example/steal', focusId,
    });
    expect(readArtifactPreviewOrigin()).toBeUndefined();
  });
});
