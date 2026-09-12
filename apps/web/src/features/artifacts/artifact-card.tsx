'use client';

import { createContractClient } from '@cmaster/contracts';
import Link from 'next/link';
import { type Ref, useEffect, useRef, useState } from 'react';
import {
  MarkdownArtifactRenderer,
  PlainTextArtifactRenderer,
  UnknownArtifactRenderer,
} from './artifact-renderers';
import {
  consumeArtifactPreviewOrigin,
  readArtifactPreviewOrigin,
  rememberArtifactPreviewOrigin,
} from './artifact-focus';
import { selectArtifactRenderer } from './renderer-registry';

export interface ArtifactCardProps {
  artifactId: string;
  artifactVersionId: string;
  apiUrl: string;
  locale?: 'zh-CN' | 'en-US';
}

export interface ArtifactCardState {
  title: string;
  kind: string;
  currentVersionNumber?: number;
  versionNumber: number;
  mediaType: string;
  sizeBytes?: number;
  content?: string;
}

const copy = {
  'zh-CN': {
    version: 'Version', historical: '历史 Version', preview: '预览确切 Version',
    download: '下载确切 Version', loading: '正在加载 Artifact…', error: '无法读取这个 Artifact。',
  },
  'en-US': {
    version: 'Version', historical: 'Historical Version', preview: 'Preview exact Version',
    download: 'Download exact Version', loading: 'Loading Artifact…',
    error: 'This Artifact could not be read.',
  },
} as const;

export function ArtifactCardContent({
  state,
  contentUrl,
  locale = 'en-US',
  onPreview,
  detailUrl,
  detailLinkRef,
  onOpenDetail,
}: {
  state: ArtifactCardState;
  contentUrl: string;
  locale?: keyof typeof copy;
  onPreview?: () => void;
  detailUrl?: string;
  detailLinkRef?: Ref<HTMLAnchorElement>;
  onOpenDetail?: () => void;
}) {
  const text = copy[locale];
  const renderer = selectArtifactRenderer(state.kind, state.mediaType);
  const historical = state.currentVersionNumber !== undefined
    && state.versionNumber < state.currentVersionNumber;
  return (
    <article className="artifact-card" aria-label={`${state.title}, Version ${state.versionNumber}`}>
      <h3>{state.title}</h3>
      <p>{historical ? text.historical : text.version} {state.versionNumber}</p>
      <p>{state.mediaType}{state.sizeBytes === undefined ? ''
        : ` · ${new Intl.NumberFormat(locale).format(state.sizeBytes)} bytes`}</p>
      {renderer !== 'fallback' && state.content === undefined && onPreview ? (
        <button className="button secondary" type="button" onClick={onPreview}>{text.preview}</button>
      ) : null}
      {renderer === 'plain_text' && state.content !== undefined
        ? <PlainTextArtifactRenderer content={state.content} />
        : renderer === 'markdown' && state.content !== undefined
          ? <MarkdownArtifactRenderer content={state.content} />
          : renderer === 'fallback'
            ? <UnknownArtifactRenderer downloadUrl={`${contentUrl}?disposition=attachment`}
                locale={locale} />
            : null}
      <p className="artifact-card-actions">
        {detailUrl ? <Link ref={detailLinkRef} href={detailUrl} onClick={onOpenDetail}>
          {text.preview}
        </Link> : null}
        {renderer !== 'fallback'
          ? <a href={`${contentUrl}?disposition=attachment`}>{text.download}</a> : null}
      </p>
    </article>
  );
}

export function ArtifactCard({
  artifactId,
  artifactVersionId,
  apiUrl,
  locale = 'en-US',
}: ArtifactCardProps) {
  const detailLinkRef = useRef<HTMLAnchorElement>(null);
  const [state, setState] = useState<ArtifactCardState>();
  const [error, setError] = useState(false);
  const contentUrl = `${apiUrl}/api/v1/artifacts/${artifactId}/versions/${artifactVersionId}/content`;

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const client = createContractClient(apiUrl);
      const [artifactResult, versionResult] = await Promise.all([
        client.GET('/api/v1/artifacts/{artifactId}/versions', {
          params: { path: { artifactId }, query: { limit: 1 } },
        }),
        client.GET('/api/v1/artifacts/{artifactId}/versions/{artifactVersionId}', {
          params: { path: { artifactId, artifactVersionId } },
        }),
      ]);
      if (!artifactResult.data || !versionResult.data) throw new Error('artifact_not_found');
      if (!disposed) {
        setState({
          title: artifactResult.data.artifact.title,
          kind: artifactResult.data.artifact.kind,
          currentVersionNumber: artifactResult.data.artifact.currentVersionNumber,
          versionNumber: versionResult.data.versionNumber,
          mediaType: versionResult.data.mediaType,
          sizeBytes: versionResult.data.sizeBytes,
        });
      }
    };
    void load().catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; };
  }, [apiUrl, artifactId, artifactVersionId]);

  useEffect(() => {
    if (!state) return;
    const origin = readArtifactPreviewOrigin();
    if (origin?.artifactId !== artifactId || origin.returnUrl !== window.location.pathname
      || origin.focusId !== artifactVersionId) return;
    consumeArtifactPreviewOrigin(window.location.pathname);
    detailLinkRef.current?.focus();
  }, [artifactId, artifactVersionId, state]);

  if (error) return <article className="artifact-card"><p role="alert">{copy[locale].error}</p></article>;
  if (!state) return <article className="artifact-card"><p>{copy[locale].loading}</p></article>;
  const detailUrl = `/workspace/artifacts/${artifactId}/versions/${artifactVersionId}`;
  return <ArtifactCardContent state={state} contentUrl={contentUrl} locale={locale}
    detailUrl={detailUrl} detailLinkRef={detailLinkRef}
    onOpenDetail={() => rememberArtifactPreviewOrigin({
      artifactId,
      returnUrl: window.location.pathname,
      focusId: artifactVersionId,
    })} />;
}
