import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeArtifactLink } from './renderer-registry';

export function PlainTextArtifactRenderer({ content }: { content: string }) {
  return <pre className="artifact-content artifact-content-plain">{content}</pre>;
}

export function MarkdownArtifactRenderer({ content }: { content: string }) {
  return (
    <div className="artifact-content artifact-content-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a({ href, children }) {
            const safeHref = safeArtifactLink(href);
            if (!safeHref) return <span>{children}</span>;
            const external = /^(?:https?:)?\/\//iu.test(safeHref);
            return external
              ? <a href={safeHref} target="_blank" rel="noopener noreferrer">
                  {children} <span className="sr-only">(opens in a new tab)</span>
                </a>
              : <a href={safeHref}>{children}</a>;
          },
          img({ alt }) {
            return <span>{alt ?? 'Image omitted'}</span>;
          },
        }}
      >{content}</ReactMarkdown>
    </div>
  );
}

export function UnknownArtifactRenderer({
  downloadUrl,
  locale = 'en-US',
}: {
  downloadUrl: string;
  locale?: 'zh-CN' | 'en-US';
}) {
  return (
    <p className="artifact-content artifact-content-fallback">
      {locale === 'zh-CN' ? '此类型不支持内联预览。' : 'Inline preview is unavailable for this type.'}{' '}
      <a href={downloadUrl}>{locale === 'zh-CN' ? '下载确切 Version' : 'Download exact Version'}</a>
    </p>
  );
}
