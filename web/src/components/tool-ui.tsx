"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { Terminal, FileText, Globe, Loader2, CheckCircle2, XCircle, Table2, Camera, Eye, Search, ListTree, GitFork, ClipboardList, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

// ─── Shell ──────────────────────────────────────────────────────────────────

export const ShellToolUI = makeAssistantToolUI<{ command: string }, unknown>({
    toolName: "shell.execute",
    render: ({ args, result, status }) => {
        const isDangerous = /\b(rm|drop|truncate|format|mkfs|del\s+\/[sf])\b/i.test(args?.command ?? "");
        return (
            <div className="border rounded-lg p-3 text-xs font-mono my-2 bg-card">
                <div className="flex items-center gap-2 mb-2 text-primary">
                    <Terminal className="w-4 h-4" />
                    <span className="font-semibold text-sm font-sans">Shell</span>
                    <StatusBadge status={status} />
                    {isDangerous && (
                        <Badge variant="destructive" className="text-[10px] h-4 px-1">危险命令</Badge>
                    )}
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
        );
    },
});

// ─── File Manager: Read ──────────────────────────────────────────────────────

export const FileManagerReadToolUI = makeAssistantToolUI<{ path: string }, unknown>({
    toolName: "file-manager.read",
    render: ({ args, result, status }) => {
        const [collapsed, setCollapsed] = useState(true);
        const content = result !== undefined ? (typeof result === "string" ? result : JSON.stringify(result, null, 2)) : null;
        const isLong = content && content.length > 800;

        return (
            <div className="border rounded-lg p-3 text-xs font-mono my-2 bg-card">
                <div className="flex items-center gap-2 mb-2 text-blue-500">
                    <FileText className="w-4 h-4" />
                    <span className="font-semibold text-sm font-sans">Read File</span>
                    <StatusBadge status={status} />
                </div>
                {args?.path && (
                    <div className="bg-muted/50 p-2 rounded text-xs overflow-x-auto text-muted-foreground">{args.path}</div>
                )}
                {content !== null && (
                    <div className="mt-2">
                        <pre className={`text-muted-foreground text-xs overflow-x-auto whitespace-pre-wrap break-all ${isLong && collapsed ? "max-h-[150px] overflow-hidden" : ""}`}>
                            {content}
                        </pre>
                        {isLong && (
                            <button
                                className="mt-1 text-[11px] text-primary hover:underline"
                                onClick={() => setCollapsed(c => !c)}
                            >
                                {collapsed ? "展开全部 ↓" : "折叠 ↑"}
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    },
});

// ─── File Manager: Write ─────────────────────────────────────────────────────

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

// ─── File Manager: List Directory ────────────────────────────────────────────

export const FileManagerListToolUI = makeAssistantToolUI<{ path: string }, unknown>({
    toolName: "file-manager.list",
    render: ({ args, result, status }) => {
        const items: string[] = Array.isArray(result) ? result : (typeof result === "string" ? result.split("\n").filter(Boolean) : []);
        return (
            <div className="border rounded-lg p-3 text-xs font-mono my-2 bg-card">
                <div className="flex items-center gap-2 mb-2 text-blue-500">
                    <ListTree className="w-4 h-4" />
                    <span className="font-semibold text-sm font-sans">List Directory</span>
                    <StatusBadge status={status} />
                    {items.length > 0 && <Badge variant="secondary" className="text-[10px]">{items.length} 项</Badge>}
                </div>
                {args?.path && (
                    <div className="bg-muted/50 p-2 rounded mb-2 text-muted-foreground">{args.path}</div>
                )}
                {items.length > 0 && (
                    <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                        {items.slice(0, 50).map((item, i) => (
                            <div key={i} className="px-2 py-0.5 rounded hover:bg-muted/50 truncate text-muted-foreground">
                                {item}
                            </div>
                        ))}
                        {items.length > 50 && <div className="px-2 text-muted-foreground">...还有 {items.length - 50} 项</div>}
                    </div>
                )}
            </div>
        );
    },
});

// ─── HTTP Client ─────────────────────────────────────────────────────────────

export const HttpClientToolUI = makeAssistantToolUI<{ url: string; method?: string }, unknown>({
    toolName: "http-client.request",
    render: ({ args, result, status }) => {
        const [collapsed, setCollapsed] = useState(true);
        const method = args?.method || "GET";
        const methodColors: Record<string, string> = {
            GET: "text-green-600", POST: "text-blue-600", PUT: "text-amber-600",
            DELETE: "text-red-600", PATCH: "text-purple-600",
        };
        const statusCode = (result as any)?.status ?? (result as any)?.statusCode;
        const isSuccess = statusCode ? statusCode < 400 : true;

        const body = result !== undefined ? (typeof result === "string" ? result : JSON.stringify(result, null, 2)) : null;
        const isLong = body && body.length > 500;

        return (
            <div className="border rounded-lg p-3 text-xs font-mono my-2 bg-card">
                <div className="flex items-center gap-2 mb-2 text-emerald-500">
                    <Globe className="w-4 h-4" />
                    <span className="font-semibold text-sm font-sans">HTTP Request</span>
                    <StatusBadge status={status} />
                    {statusCode && (
                        <Badge variant={isSuccess ? "secondary" : "destructive"} className="text-[10px] h-4 px-1">
                            {statusCode}
                        </Badge>
                    )}
                </div>
                {args?.url && (
                    <div className="bg-muted/50 p-2 rounded text-xs overflow-x-auto">
                        <span className={`font-bold ${methodColors[method] ?? "text-foreground"}`}>{method}</span>{" "}
                        <span className="text-muted-foreground">{args.url}</span>
                    </div>
                )}
                {body !== null && (
                    <div className="mt-2">
                        <pre className={`text-muted-foreground text-xs overflow-x-auto whitespace-pre-wrap break-all ${isLong && collapsed ? "max-h-[120px] overflow-hidden" : ""}`}>
                            {body}
                        </pre>
                        {isLong && (
                            <button
                                className="mt-1 text-[11px] text-primary hover:underline"
                                onClick={() => setCollapsed(c => !c)}
                            >
                                {collapsed ? "展开响应 ↓" : "折叠 ↑"}
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    },
});

// ─── Database / NL2SQL ──────────────────────────────────────────────────────

export const DatabaseQueryToolUI = makeAssistantToolUI<{ query: string; datasource?: string }, unknown>({
    toolName: "database-connector.execute_query",
    render: ({ args, result, status }) => {
        const rows: any[] = Array.isArray((result as any)?.rows) ? (result as any).rows
            : Array.isArray(result) ? result : [];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        const [page, setPage] = useState(0);
        const PAGE_SIZE = 10;
        const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

        return (
            <div className="border rounded-lg p-3 my-2 bg-card text-xs">
                <div className="flex items-center gap-2 mb-2 text-violet-500 font-mono">
                    <Table2 className="w-4 h-4" />
                    <span className="font-semibold text-sm font-sans">SQL 查询</span>
                    <StatusBadge status={status} />
                    {rows.length > 0 && <Badge variant="secondary" className="text-[10px]">{rows.length} 行</Badge>}
                </div>
                {args?.query && (
                    <pre className="bg-muted/50 p-2 rounded text-xs overflow-x-auto mb-2 text-muted-foreground">{args.query}</pre>
                )}
                {rows.length > 0 && columns.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="border-b bg-muted/30">
                                    {columns.map(col => (
                                        <th key={col} className="px-2 py-1 text-left font-medium text-muted-foreground whitespace-nowrap">{col}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.map((row, i) => (
                                    <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                                        {columns.map(col => (
                                            <td key={col} className="px-2 py-1 truncate max-w-[200px]" title={String(row[col] ?? "")}>
                                                {String(row[col] ?? "")}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {rows.length > PAGE_SIZE && (
                            <div className="flex items-center justify-between mt-2 text-muted-foreground">
                                <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rows.length)} / {rows.length}</span>
                                <div className="flex gap-1">
                                    <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-1.5 py-0.5 border rounded disabled:opacity-40">‹</button>
                                    <button disabled={(page + 1) * PAGE_SIZE >= rows.length} onClick={() => setPage(p => p + 1)} className="px-1.5 py-0.5 border rounded disabled:opacity-40">›</button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    },
});

// ─── Browser Automation: Screenshot ─────────────────────────────────────────

export const BrowserScreenshotToolUI = makeAssistantToolUI<{ url?: string }, unknown>({
    toolName: "browser-automation.screenshot",
    render: ({ args, result, status }) => {
        const [fullscreen, setFullscreen] = useState(false);
        const imgData = (result as any)?.screenshot ?? (typeof result === "string" ? result : null);

        return (
            <div className="border rounded-lg p-3 my-2 bg-card">
                <div className="flex items-center gap-2 mb-2 text-sky-500">
                    <Camera className="w-4 h-4" />
                    <span className="font-semibold text-sm font-sans">Browser Screenshot</span>
                    <StatusBadge status={status} />
                </div>
                {args?.url && (
                    <div className="text-xs text-muted-foreground mb-2 truncate">{args.url}</div>
                )}
                {imgData && (
                    <div className="relative group">
                        <img
                            src={imgData.startsWith("data:") ? imgData : `data:image/png;base64,${imgData}`}
                            alt="screenshot"
                            className="w-full rounded border cursor-zoom-in hover:opacity-90 transition-opacity"
                            onClick={() => setFullscreen(true)}
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                            <Badge variant="secondary" className="text-xs">点击全屏查看</Badge>
                        </div>
                    </div>
                )}
                {fullscreen && imgData && (
                    <div
                        className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
                        onClick={() => setFullscreen(false)}
                    >
                        <img
                            src={imgData.startsWith("data:") ? imgData : `data:image/png;base64,${imgData}`}
                            alt="screenshot fullscreen"
                            className="max-w-full max-h-full object-contain rounded"
                        />
                    </div>
                )}
            </div>
        );
    },
});

// ─── Vision: Analyze Image ───────────────────────────────────────────────────

export const VisionAnalyzeToolUI = makeAssistantToolUI<{ image?: string; prompt?: string }, unknown>({
    toolName: "vision.analyze_image",
    render: ({ args, result, status }) => {
        const analysis = typeof result === "string" ? result : (result as any)?.analysis ?? JSON.stringify(result, null, 2);
        return (
            <div className="border rounded-lg p-3 my-2 bg-card">
                <div className="flex items-center gap-2 mb-2 text-pink-500">
                    <Eye className="w-4 h-4" />
                    <span className="font-semibold text-sm font-sans">Vision 分析</span>
                    <StatusBadge status={status} />
                </div>
                {args?.image && (
                    <div className="grid grid-cols-2 gap-3">
                        <img
                            src={args.image.startsWith("data:") ? args.image : `data:image/jpeg;base64,${args.image}`}
                            alt="analyzed"
                            className="w-full rounded border object-cover max-h-[200px]"
                        />
                        {analysis && (
                            <div className="text-xs text-muted-foreground overflow-y-auto max-h-[200px] leading-relaxed whitespace-pre-wrap">
                                {analysis}
                            </div>
                        )}
                    </div>
                )}
                {!args?.image && analysis && (
                    <div className="text-xs text-muted-foreground whitespace-pre-wrap">{analysis}</div>
                )}
            </div>
        );
    },
});

// ─── Knowledge Search ────────────────────────────────────────────────────────

export const KnowledgeSearchToolUI = makeAssistantToolUI<{ query: string; depth?: number }, unknown>({
    toolName: "knowledge_search",
    render: ({ args, result, status }) => {
        const nodes: any[] = Array.isArray((result as any)?.nodes) ? (result as any).nodes
            : Array.isArray(result) ? result : [];
        return (
            <div className="border rounded-lg p-3 my-2 bg-card">
                <div className="flex items-center gap-2 mb-2 text-teal-500">
                    <Search className="w-4 h-4" />
                    <span className="font-semibold text-sm font-sans">知识库检索</span>
                    <StatusBadge status={status} />
                    {nodes.length > 0 && <Badge variant="secondary" className="text-[10px]">{nodes.length} 结果</Badge>}
                </div>
                {args?.query && (
                    <div className="bg-muted/50 p-2 rounded text-xs mb-2 text-muted-foreground">"{args.query}"</div>
                )}
                {nodes.length > 0 && (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {nodes.slice(0, 5).map((node: any, i: number) => (
                            <div key={i} className="border rounded p-2 hover:bg-muted/30 transition-colors">
                                <div className="font-medium text-xs mb-1">{node.title ?? `节点 ${i + 1}`}</div>
                                <div className="text-xs text-muted-foreground line-clamp-3">
                                    {typeof node.content === "string" ? node.content.slice(0, 200) : JSON.stringify(node).slice(0, 200)}
                                </div>
                                {node.score !== undefined && (
                                    <div className="mt-1 text-[10px] text-muted-foreground">相关度: {(node.score * 100).toFixed(0)}%</div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    },
});

// ─── Plan Task ───────────────────────────────────────────────────────────────

export const PlanTaskToolUI = makeAssistantToolUI<{ task: string; steps?: string[] }, unknown>({
    toolName: "plan_task",
    render: ({ args, result, status }) => {
        const steps: string[] = Array.isArray((result as any)?.steps) ? (result as any).steps
            : Array.isArray(result) ? result
            : Array.isArray(args?.steps) ? args.steps : [];
        return (
            <div className="border rounded-lg p-3 my-2 bg-card">
                <div className="flex items-center gap-2 mb-2 text-indigo-500">
                    <ClipboardList className="w-4 h-4" />
                    <span className="font-semibold text-sm font-sans">任务规划</span>
                    <StatusBadge status={status} />
                </div>
                {args?.task && (
                    <div className="bg-muted/50 p-2 rounded text-xs mb-2 text-muted-foreground">{args.task}</div>
                )}
                {steps.length > 0 && (
                    <ol className="space-y-1">
                        {steps.map((step: string, i: number) => (
                            <li key={i} className="flex items-start gap-2 text-xs">
                                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                                    {i + 1}
                                </span>
                                <span className="text-muted-foreground">{step}</span>
                            </li>
                        ))}
                    </ol>
                )}
            </div>
        );
    },
});

// ─── DAG Create Task ─────────────────────────────────────────────────────────

export const DagCreateTaskToolUI = makeAssistantToolUI<{ description: string; sessionId?: string }, unknown>({
    toolName: "dag_create_task",
    render: ({ args, result, status }) => {
        const taskId = (result as any)?.taskId ?? (typeof result === "string" ? result : null);
        return (
            <div className="border rounded-lg p-3 my-2 bg-card">
                <div className="flex items-center gap-2 mb-2 text-orange-500">
                    <GitFork className="w-4 h-4" />
                    <span className="font-semibold text-sm font-sans">DAG 任务创建</span>
                    <StatusBadge status={status} />
                </div>
                {args?.description && (
                    <div className="text-xs text-muted-foreground">{args.description}</div>
                )}
                {taskId && (
                    <div className="mt-2 text-xs">
                        <span className="text-muted-foreground">任务 ID: </span>
                        <code className="bg-muted/50 px-1 rounded">{taskId}</code>
                    </div>
                )}
            </div>
        );
    },
});

// ─── Export ──────────────────────────────────────────────────────────────────

export const allToolUIs = [
    ShellToolUI,
    FileManagerReadToolUI,
    FileManagerWriteToolUI,
    FileManagerListToolUI,
    HttpClientToolUI,
    DatabaseQueryToolUI,
    BrowserScreenshotToolUI,
    VisionAnalyzeToolUI,
    KnowledgeSearchToolUI,
    PlanTaskToolUI,
    DagCreateTaskToolUI,
];
