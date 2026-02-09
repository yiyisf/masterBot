"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { Terminal, FileText, Globe, Loader2, CheckCircle2, XCircle } from "lucide-react";

function StatusBadge({ status }: { status: { type: string } }) {
    if (status.type === "running") {
        return <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />;
    }
    if (status.type === "complete") {
        return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
    }
    if (status.type === "error") {
        return <XCircle className="w-3.5 h-3.5 text-red-500" />;
    }
    return null;
}

export const ShellToolUI = makeAssistantToolUI<{ command: string }, unknown>({
    toolName: "shell.execute",
    render: ({ args, result, status }) => (
        <div className="border rounded-lg p-3 text-xs font-mono my-2 bg-card">
            <div className="flex items-center gap-2 mb-2 text-primary">
                <Terminal className="w-4 h-4" />
                <span className="font-semibold text-sm font-sans">Shell</span>
                <StatusBadge status={status} />
            </div>
            {args?.command && (
                <pre className="bg-muted/50 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all">
                    $ {args.command}
                </pre>
            )}
            {result !== undefined && (
                <pre className="mt-2 text-muted-foreground text-xs overflow-x-auto max-h-[150px] whitespace-pre-wrap break-all">
                    {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
                </pre>
            )}
        </div>
    ),
});

export const FileManagerReadToolUI = makeAssistantToolUI<{ path: string }, unknown>({
    toolName: "file-manager.read",
    render: ({ args, result, status }) => (
        <div className="border rounded-lg p-3 text-xs font-mono my-2 bg-card">
            <div className="flex items-center gap-2 mb-2 text-blue-500">
                <FileText className="w-4 h-4" />
                <span className="font-semibold text-sm font-sans">Read File</span>
                <StatusBadge status={status} />
            </div>
            {args?.path && (
                <div className="bg-muted/50 p-2 rounded text-xs overflow-x-auto">{args.path}</div>
            )}
            {result !== undefined && (
                <pre className="mt-2 text-muted-foreground text-xs overflow-x-auto max-h-[150px] whitespace-pre-wrap break-all">
                    {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
                </pre>
            )}
        </div>
    ),
});

export const FileManagerWriteToolUI = makeAssistantToolUI<{ path: string; content?: string }, unknown>({
    toolName: "file-manager.write",
    render: ({ args, result, status }) => (
        <div className="border rounded-lg p-3 text-xs font-mono my-2 bg-card">
            <div className="flex items-center gap-2 mb-2 text-blue-500">
                <FileText className="w-4 h-4" />
                <span className="font-semibold text-sm font-sans">Write File</span>
                <StatusBadge status={status} />
            </div>
            {args?.path && (
                <div className="bg-muted/50 p-2 rounded text-xs overflow-x-auto">{args.path}</div>
            )}
            {result !== undefined && (
                <div className="mt-2 text-muted-foreground text-xs">
                    {typeof result === "string" ? result : JSON.stringify(result)}
                </div>
            )}
        </div>
    ),
});

export const HttpClientToolUI = makeAssistantToolUI<{ url: string; method?: string }, unknown>({
    toolName: "http-client.request",
    render: ({ args, result, status }) => (
        <div className="border rounded-lg p-3 text-xs font-mono my-2 bg-card">
            <div className="flex items-center gap-2 mb-2 text-emerald-500">
                <Globe className="w-4 h-4" />
                <span className="font-semibold text-sm font-sans">HTTP Request</span>
                <StatusBadge status={status} />
            </div>
            {args?.url && (
                <div className="bg-muted/50 p-2 rounded text-xs overflow-x-auto">
                    <span className="text-primary font-semibold">{args.method || "GET"}</span>{" "}
                    {args.url}
                </div>
            )}
            {result !== undefined && (
                <pre className="mt-2 text-muted-foreground text-xs overflow-x-auto max-h-[150px] whitespace-pre-wrap break-all">
                    {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
                </pre>
            )}
        </div>
    ),
});

export const allToolUIs = [
    ShellToolUI,
    FileManagerReadToolUI,
    FileManagerWriteToolUI,
    HttpClientToolUI,
];
