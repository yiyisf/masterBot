"use client";

import { useState, useCallback, Suspense } from "react";
import { makeMarkdownText } from "@assistant-ui/react-ui";
import { makeLightAsyncSyntaxHighlighter } from "@assistant-ui/react-syntax-highlighter";
import { Check, Copy } from "lucide-react";
import { Mermaid } from "@/components/mermaid";
import remarkGfm from "remark-gfm";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const atomOneDark = require("react-syntax-highlighter/dist/esm/styles/hljs/atom-one-dark").default;

const SyntaxHighlighter = makeLightAsyncSyntaxHighlighter({ style: atomOneDark });

/** Mermaid wrapper adapted to SyntaxHighlighterProps interface */
const MermaidHighlighter = ({ code }: { code: string }) => (
    <div className="my-4">
        <Mermaid code={code} />
    </div>
);

type SHProps = React.ComponentPropsWithoutRef<typeof SyntaxHighlighter>;

/** Code block with language label and copy button header. */
export const CodeBlock = (props: SHProps) => {
    const { code, language } = props;
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [code]);

    return (
        <div className="not-prose my-4 rounded-lg overflow-hidden border border-zinc-700/60">
            <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800 border-b border-zinc-700/60">
                <span className="text-[11px] text-zinc-400 font-mono">
                    {language && language !== 'text' ? language : 'code'}
                </span>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                    {copied
                        ? <><Check className="h-3 w-3 text-green-400" /><span>已复制</span></>
                        : <><Copy className="h-3 w-3" /><span>复制</span></>
                    }
                </button>
            </div>
            <Suspense fallback={<pre className="bg-zinc-900 p-4 text-zinc-300 font-mono text-sm overflow-x-auto">{code}</pre>}>
                <SyntaxHighlighter {...props} />
            </Suspense>
        </div>
    );
};

/** Custom Markdown renderer with Mermaid support and syntax highlighting */
export const MarkdownText = makeMarkdownText({
    remarkPlugins: [remarkGfm],
    components: { SyntaxHighlighter: CodeBlock },
    componentsByLanguage: { mermaid: { SyntaxHighlighter: MermaidHighlighter } },
});
