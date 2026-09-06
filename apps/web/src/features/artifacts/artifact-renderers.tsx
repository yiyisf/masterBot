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
            return safeHref
              ? <a href={safeHref} rel="noopener noreferrer">{children}</a>
              : <span>{children}</span>;
          },
          img({ alt }) {
            return <span>{alt ?? 'Image omitted'}</span>;
          },
        }}
      >{content}</ReactMarkdown>
    </div>
  );
}

export function UnknownArtifactRenderer({ downloadUrl }: { downloadUrl: string }) {
  return (
    <p className="artifact-content artifact-content-fallback">
      Preview unavailable. <a href={downloadUrl} download>Download exact Version</a>
    </p>
  );
}
