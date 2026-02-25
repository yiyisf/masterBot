"use client";

import { useEffect, useState, useCallback } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Brain,
    Search,
    Plus,
    BookOpen,
    Loader2,
    AlertCircle,
    Network,
    FileText,
    CheckCircle2,
    X,
} from "lucide-react";
import { fetchApi } from "@/lib/api";

interface KnowledgeStats {
    nodeCount: number;
    edgeCount: number;
}

interface KnowledgeNode {
    id: string;
    title: string;
    type: string;
    content: string;
    score?: number;
    createdAt?: string;
}

const NODE_TYPES = [
    { value: "concept", label: "概念" },
    { value: "fact", label: "事实" },
    { value: "procedure", label: "流程" },
    { value: "reference", label: "参考" },
    { value: "entity", label: "实体" },
];

const NODE_TYPE_COLORS: Record<string, string> = {
    concept: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    fact: "bg-green-500/10 text-green-600 border-green-500/20",
    procedure: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    reference: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    entity: "bg-rose-500/10 text-rose-600 border-rose-500/20",
};

export default function KnowledgePage() {
    const [stats, setStats] = useState<KnowledgeStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);

    // Search state
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<KnowledgeNode[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [hasSearched, setHasSearched] = useState(false);

    // Ingest state
    const [ingestTitle, setIngestTitle] = useState("");
    const [ingestContent, setIngestContent] = useState("");
    const [ingestType, setIngestType] = useState("concept");
    const [ingesting, setIngesting] = useState(false);
    const [ingestError, setIngestError] = useState<string | null>(null);
    const [ingestSuccess, setIngestSuccess] = useState(false);

    const loadStats = useCallback(() => {
        setStatsLoading(true);
        fetchApi<KnowledgeStats>("/api/knowledge/stats")
            .then((data) => {
                setStats(data);
                setStatsLoading(false);
            })
            .catch((err) => {
                console.error("Failed to load knowledge stats", err);
                setStats(null);
                setStatsLoading(false);
            });
    }, []);

    useEffect(() => {
        loadStats();
    }, [loadStats]);

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        setSearchError(null);
        setHasSearched(true);
        try {
            const data = await fetchApi<KnowledgeNode[]>(
                `/api/knowledge/search?q=${encodeURIComponent(searchQuery.trim())}`
            );
            setSearchResults(Array.isArray(data) ? data : []);
        } catch (err: any) {
            setSearchError("搜索失败: " + err.message);
            setSearchResults([]);
        } finally {
            setSearching(false);
        }
    };

    const handleClearSearch = () => {
        setSearchQuery("");
        setSearchResults([]);
        setHasSearched(false);
        setSearchError(null);
    };

    const handleIngest = async () => {
        setIngestError(null);
        if (!ingestTitle.trim() || !ingestContent.trim()) {
            setIngestError("标题和内容不能为空。");
            return;
        }
        setIngesting(true);
        try {
            await fetchApi("/api/knowledge/ingest", {
                method: "POST",
                body: JSON.stringify({
                    title: ingestTitle.trim(),
                    content: ingestContent.trim(),
                    type: ingestType,
                }),
            });
            setIngestSuccess(true);
            setIngestTitle("");
            setIngestContent("");
            setIngestType("concept");
            loadStats();
            setTimeout(() => setIngestSuccess(false), 3000);
        } catch (err: any) {
            setIngestError("录入失败: " + err.message);
        } finally {
            setIngesting(false);
        }
    };

    return (
        <div className="h-full overflow-y-auto w-full max-w-5xl mx-auto p-6 space-y-8 pb-10">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">
                    知识图谱
                </h1>
                <p className="text-muted-foreground mt-1">
                    管理 Agent 的结构化知识库，支持语义检索和知识录入。
                </p>
            </div>

            {/* Stats Bar */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Card className="sm:col-span-2">
                    <CardContent className="pt-6 pb-4">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <Network className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">
                                    知识节点
                                </p>
                                {statsLoading ? (
                                    <div className="h-7 w-16 bg-muted animate-pulse rounded mt-0.5" />
                                ) : (
                                    <p className="text-2xl font-bold">
                                        {stats?.nodeCount ?? "—"}
                                    </p>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="sm:col-span-2">
                    <CardContent className="pt-6 pb-4">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <Brain className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">
                                    关系边
                                </p>
                                {statsLoading ? (
                                    <div className="h-7 w-16 bg-muted animate-pulse rounded mt-0.5" />
                                ) : (
                                    <p className="text-2xl font-bold">
                                        {stats?.edgeCount ?? "—"}
                                    </p>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Search */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Search className="w-4 h-4 text-primary" />
                        知识检索
                    </CardTitle>
                    <CardDescription>
                        语义搜索知识图谱，查找相关知识节点。
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                            <Input
                                className="pl-9 pr-9"
                                placeholder="搜索知识图谱..."
                                value={searchQuery}
                                onChange={(e) =>
                                    setSearchQuery(e.target.value)
                                }
                                onKeyDown={(e) =>
                                    e.key === "Enter" && handleSearch()
                                }
                            />
                            {searchQuery && (
                                <button
                                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                                    onClick={handleClearSearch}
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                        <Button
                            onClick={handleSearch}
                            disabled={searching || !searchQuery.trim()}
                            className="gap-2"
                        >
                            {searching ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Search className="w-4 h-4" />
                            )}
                            搜索
                        </Button>
                    </div>

                    {searchError && (
                        <div className="flex items-center gap-2 text-sm text-destructive">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            {searchError}
                        </div>
                    )}

                    {hasSearched && !searching && searchResults.length === 0 && !searchError && (
                        <div className="py-8 text-center text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                            <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            未找到与 "{searchQuery}" 相关的知识节点。
                        </div>
                    )}

                    {searchResults.length > 0 && (
                        <div className="space-y-3">
                            <p className="text-xs text-muted-foreground">
                                找到 {searchResults.length} 个相关节点
                            </p>
                            {searchResults.map((node) => (
                                <div
                                    key={node.id}
                                    className="rounded-lg border bg-card p-4 space-y-2"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <FileText className="w-4 h-4 text-primary shrink-0" />
                                            <h3 className="font-medium text-sm">
                                                {node.title}
                                            </h3>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {node.type && (
                                                <span
                                                    className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${NODE_TYPE_COLORS[node.type] ?? "bg-muted text-muted-foreground"}`}
                                                >
                                                    {NODE_TYPES.find(
                                                        (t) =>
                                                            t.value ===
                                                            node.type
                                                    )?.label ?? node.type}
                                                </span>
                                            )}
                                            {node.score !== undefined && (
                                                <Badge
                                                    variant="secondary"
                                                    className="text-[10px]"
                                                >
                                                    {(node.score * 100).toFixed(
                                                        0
                                                    )}
                                                    %
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-sm text-muted-foreground line-clamp-3">
                                        {node.content}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Ingest */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Plus className="w-4 h-4 text-primary" />
                        录入知识
                    </CardTitle>
                    <CardDescription>
                        将新知识添加到知识图谱，供 Agent 检索和引用。
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-1.5">
                        <Label>标题</Label>
                        <Input
                            placeholder="知识节点标题..."
                            value={ingestTitle}
                            onChange={(e) => setIngestTitle(e.target.value)}
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label>节点类型</Label>
                        <div className="flex flex-wrap gap-2">
                            {NODE_TYPES.map((t) => (
                                <button
                                    key={t.value}
                                    type="button"
                                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                                        ingestType === t.value
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "bg-muted/40 hover:bg-muted text-muted-foreground border-transparent"
                                    }`}
                                    onClick={() => setIngestType(t.value)}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid gap-1.5">
                        <Label>内容</Label>
                        <Textarea
                            placeholder="输入要录入的知识内容，支持 Markdown 格式..."
                            value={ingestContent}
                            onChange={(e) => setIngestContent(e.target.value)}
                            className="min-h-[140px] resize-y"
                        />
                    </div>
                    {ingestError && (
                        <div className="flex items-center gap-2 text-sm text-destructive">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            {ingestError}
                        </div>
                    )}
                    {ingestSuccess && (
                        <div className="flex items-center gap-2 text-sm text-green-600">
                            <CheckCircle2 className="w-4 h-4" />
                            知识录入成功！
                        </div>
                    )}
                    <div className="flex justify-end">
                        <Button
                            onClick={handleIngest}
                            disabled={ingesting}
                            className="gap-2"
                        >
                            {ingesting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Plus className="w-4 h-4" />
                            )}
                            录入知识
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
