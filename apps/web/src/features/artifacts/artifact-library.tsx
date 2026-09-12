'use client';

import type { ArtifactSummaryContract } from '@cmaster/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspacePreferences } from '../workspace/workspace-providers';
import { createArtifactBrowserApi, type ArtifactBrowserApi } from './artifact-browser-api';
import {
  consumeArtifactPreviewOrigin,
  readArtifactPreviewOrigin,
  rememberArtifactPreviewOrigin,
} from './artifact-focus';
import {
  MarkdownArtifactRenderer,
  PlainTextArtifactRenderer,
  UnknownArtifactRenderer,
} from './artifact-renderers';
import { selectArtifactRenderer } from './renderer-registry';

const apiUrl = process.env.NEXT_PUBLIC_CMASTER_API_URL ?? '';
const copy = {
  'zh-CN': {
    eyebrow: 'Artifact Library', title: '工作产出', description: '每个入口固定到一个不可变 Version。',
    empty: '当前没有 Artifact。', unavailable: '暂时无法读取 Artifact Library。',
    loading: '正在加载 Artifact…', loadMore: '加载更早的 Artifact', version: 'Version', historical: '历史 Version', current: '当前 Version',
    preview: '预览确切 Version', download: '下载确切 Version', close: '关闭详情',
    loadVersions: '加载更早的 Version', metadataOnly: '此类型只提供 metadata 与下载。',
  },
  'en-US': {
    eyebrow: 'Artifact Library', title: 'Work outputs', description: 'Every entry is pinned to one immutable Version.',
    empty: 'There are no Artifacts yet.', unavailable: 'The Artifact Library is unavailable right now.',
    loading: 'Loading Artifact…', loadMore: 'Load older Artifacts', version: 'Version', historical: 'Historical Version', current: 'Current Version',
    preview: 'Preview exact Version', download: 'Download exact Version', close: 'Close details',
    loadVersions: 'Load older Versions', metadataOnly: 'This type provides metadata and download only.',
  },
} as const;

function contentUrl(artifactId: string, artifactVersionId: string): string {
  return `${apiUrl}/api/v1/artifacts/${artifactId}/versions/${artifactVersionId}/content`;
}

function ArtifactVersionDetail({
  artifactId,
  artifactVersionId,
  api,
}: Readonly<{
  artifactId: string;
  artifactVersionId: string;
  api: ArtifactBrowserApi;
}>) {
  const { locale } = useWorkspacePreferences();
  const text = copy[locale];
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [content, setContent] = useState<string>();
  const [previewError, setPreviewError] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const exact = useQuery({
    queryKey: ['artifacts', artifactId, 'versions', artifactVersionId],
    queryFn: () => api.getVersion(artifactId, artifactVersionId),
  });
  const versions = useInfiniteQuery({
    queryKey: ['artifacts', artifactId, 'versions'],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api.listVersions(artifactId, pageParam, 20),
    getNextPageParam: (page) => page.beforeVersionNumber ?? undefined,
  });
  const artifact = versions.data?.pages[0]?.artifact;
  const loadedVersions = versions.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = exact.data;

  useEffect(() => {
    if (selected) headingRef.current?.focus();
  }, [selected]);

  async function preview(): Promise<void> {
    if (!selected || previewing) return;
    setPreviewing(true);
    setPreviewError(false);
    try {
      setContent(await api.readContent(artifactId, artifactVersionId));
    } catch {
      setPreviewError(true);
    } finally {
      setPreviewing(false);
    }
  }

  if (exact.isError || versions.isError) return <aside className="artifact-detail"><p role="alert">{text.unavailable}</p></aside>;
  if (!selected || !artifact) return <aside className="artifact-detail"><p role="status">{text.loading}</p></aside>;
  const renderer = selectArtifactRenderer(artifact.kind, selected.mediaType);
  const historical = selected.versionNumber < artifact.currentVersionNumber;
  const downloadUrl = `${contentUrl(artifactId, artifactVersionId)}?disposition=attachment`;
  const options = loadedVersions.some((version) => version.id === selected.id)
    ? loadedVersions : [selected, ...loadedVersions];
  return (
    <aside className="artifact-detail" aria-labelledby="artifact-detail-title">
      <Link href="/workspace/artifacts" className="workspace-back"
        onClick={(event) => {
          event.preventDefault();
          const origin = readArtifactPreviewOrigin();
          if (origin?.artifactId === artifactId) {
            router.push(origin.returnUrl);
          } else {
            rememberArtifactPreviewOrigin({
              artifactId, returnUrl: '/workspace/artifacts', focusId: artifactId,
            });
            router.push('/workspace/artifacts');
          }
        }}>← {text.close}</Link>
      <p className="status-pill">{historical ? `${text.historical} ${selected.versionNumber}`
        : `${text.current} ${selected.versionNumber}`}</p>
      <h2 id="artifact-detail-title" ref={headingRef} tabIndex={-1}>{artifact.title}</h2>
      <label>{text.version}
        <select value={selected.id} onChange={(event) => router.push(
          `/workspace/artifacts/${artifactId}/versions/${event.target.value}`,
        )}>
          {options.map((version) => (
            <option key={version.id} value={version.id}>Version {version.versionNumber}</option>
          ))}
        </select>
      </label>
      <dl>
        <div><dt>Media type</dt><dd>{selected.mediaType}</dd></div>
        <div><dt>Size</dt><dd>{new Intl.NumberFormat(locale).format(selected.sizeBytes)} bytes</dd></div>
      </dl>
      {renderer === 'fallback' ? (
        <><p>{text.metadataOnly}</p><UnknownArtifactRenderer downloadUrl={downloadUrl} locale={locale} /></>
      ) : (
        <button className="button" type="button" disabled={previewing}
          onClick={() => void preview()}>{text.preview}</button>
      )}
      {previewError ? <p role="alert">{text.unavailable}</p> : null}
      {content !== undefined && renderer === 'plain_text'
        ? <PlainTextArtifactRenderer content={content} /> : null}
      {content !== undefined && renderer === 'markdown'
        ? <MarkdownArtifactRenderer content={content} /> : null}
      {renderer !== 'fallback' ? <p><a href={downloadUrl}>{text.download}</a></p> : null}
      {versions.hasNextPage ? (
        <button className="button secondary" disabled={versions.isFetchingNextPage}
          onClick={() => void versions.fetchNextPage()}>{text.loadVersions}</button>
      ) : null}
    </aside>
  );
}

function ArtifactSummary({
  summary,
  locale,
  registerFocus,
}: Readonly<{
  summary: ArtifactSummaryContract;
  locale: keyof typeof copy;
  registerFocus: (artifactId: string, element: HTMLAnchorElement | null) => void;
}>) {
  const { artifact, currentVersion } = summary;
  return (
    <article className="artifact-summary">
      <h2><Link ref={(element) => registerFocus(artifact.id, element)}
        data-artifact-id={artifact.id}
        href={`/workspace/artifacts/${artifact.id}/versions/${currentVersion.id}`}
        onClick={() => rememberArtifactPreviewOrigin({
          artifactId: artifact.id, returnUrl: '/workspace/artifacts', focusId: artifact.id,
        })}>
        {artifact.title}
      </Link></h2>
      <p>Version {currentVersion.versionNumber} · {currentVersion.mediaType}</p>
      <p>{new Intl.NumberFormat(locale).format(currentVersion.sizeBytes)} bytes</p>
    </article>
  );
}

export function ArtifactLibrary({
  selected,
}: Readonly<{
  selected?: { readonly artifactId: string; readonly artifactVersionId: string };
}>) {
  const { locale } = useWorkspacePreferences();
  const text = copy[locale];
  const api = useMemo(() => createArtifactBrowserApi(apiUrl), []);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusTargets = useRef(new Map<string, HTMLAnchorElement>());
  const artifacts = useInfiniteQuery({
    queryKey: ['artifacts', 'library'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.list(pageParam, 20),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = artifacts.data?.pages.flatMap((page) => page.items) ?? [];

  useEffect(() => {
    if (selected || items.length === 0) return;
    try {
      const origin = consumeArtifactPreviewOrigin('/workspace/artifacts');
      if (!origin) return;
      (focusTargets.current.get(origin.focusId) ?? headingRef.current)?.focus();
    } catch {
      // Browser storage can be unavailable; normal route Focus remains usable.
    }
  }, [items.length, selected]);

  function registerFocus(artifactId: string, element: HTMLAnchorElement | null): void {
    if (element) focusTargets.current.set(artifactId, element);
    else focusTargets.current.delete(artifactId);
  }

  return (
    <main className={`artifact-library-shell${selected ? ' selected' : ''}`}>
      <section className="artifact-library-list" aria-labelledby="artifact-library-title">
        <p className="eyebrow">{text.eyebrow}</p>
        <h1 id="artifact-library-title" ref={headingRef} tabIndex={-1}>{text.title}</h1>
        <p>{text.description}</p>
        {artifacts.isError ? <p role="alert">{text.unavailable}</p> : null}
        {!artifacts.isPending && !artifacts.isError && items.length === 0
          ? <p className="workspace-empty" role="status">{text.empty}</p> : null}
        <div className="artifact-summary-list">
          {items.map((summary) => <ArtifactSummary key={summary.artifact.id}
            summary={summary} locale={locale} registerFocus={registerFocus} />)}
        </div>
        {artifacts.hasNextPage ? (
          <button className="button secondary" disabled={artifacts.isFetchingNextPage}
            onClick={() => void artifacts.fetchNextPage()}>{text.loadMore}</button>
        ) : null}
      </section>
      {selected ? <ArtifactVersionDetail key={selected.artifactVersionId}
        artifactId={selected.artifactId} artifactVersionId={selected.artifactVersionId} api={api} /> : null}
    </main>
  );
}
