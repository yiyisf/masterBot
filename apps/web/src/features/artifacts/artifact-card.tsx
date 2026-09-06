'use client';

import { createContractClient, readArtifactVersionContent } from '@cmaster/contracts';
import { useEffect, useState } from 'react';
import {
  MarkdownArtifactRenderer,
  PlainTextArtifactRenderer,
  UnknownArtifactRenderer,
} from './artifact-renderers';
import { selectArtifactRenderer } from './renderer-registry';

export interface ArtifactCardProps {
  artifactId: string;
  artifactVersionId: string;
  apiUrl: string;
}

export interface ArtifactCardState {
  title: string;
  kind: string;
  versionNumber: number;
  mediaType: string;
  content?: string;
}

export function ArtifactCardContent({
  state,
  contentUrl,
}: {
  state: ArtifactCardState;
  contentUrl: string;
}) {
  const renderer = selectArtifactRenderer(state.kind, state.mediaType);
  return (
    <article className="artifact-card" aria-label={`${state.title}, Version ${state.versionNumber}`}>
      <h3>{state.title}</h3>
      <p>Version {state.versionNumber}</p>
      {renderer === 'plain_text'
        ? <PlainTextArtifactRenderer content={state.content ?? ''} />
        : renderer === 'markdown'
          ? <MarkdownArtifactRenderer content={state.content ?? ''} />
          : <UnknownArtifactRenderer downloadUrl={contentUrl} />}
    </article>
  );
}

export function ArtifactCard({ artifactId, artifactVersionId, apiUrl }: ArtifactCardProps) {
  const [state, setState] = useState<ArtifactCardState>();
  const [error, setError] = useState<string>();
  const contentUrl = `${apiUrl}/api/v1/artifacts/${artifactId}/versions/${artifactVersionId}/content`;

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const client = createContractClient(apiUrl);
      const [artifactResult, versionResult] = await Promise.all([
        client.GET('/api/v1/artifacts/{artifactId}', {
          params: { path: { artifactId } },
        }),
        client.GET('/api/v1/artifacts/{artifactId}/versions/{artifactVersionId}', {
          params: { path: { artifactId, artifactVersionId } },
        }),
      ]);
      if (!artifactResult.data || !versionResult.data) throw new Error('Artifact was not found');
      const renderer = selectArtifactRenderer(
        artifactResult.data.artifact.kind,
        versionResult.data.mediaType,
      );
      let content: string | undefined;
      if (renderer !== 'fallback') {
        content = await readArtifactVersionContent(apiUrl, { artifactId, artifactVersionId });
      }
      if (!disposed) {
        setState({
          title: artifactResult.data.artifact.title,
          kind: artifactResult.data.artifact.kind,
          versionNumber: versionResult.data.versionNumber,
          mediaType: versionResult.data.mediaType,
          ...(content === undefined ? {} : { content }),
        });
      }
    };
    void load().catch((cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'Artifact could not be read');
    });
    return () => { disposed = true; };
  }, [apiUrl, artifactId, artifactVersionId, contentUrl]);

  if (error) return <article className="artifact-card"><p role="alert">{error}</p></article>;
  if (!state) return <article className="artifact-card"><p>Loading Artifact…</p></article>;
  return <ArtifactCardContent state={state} contentUrl={contentUrl} />;
}
