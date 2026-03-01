"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MessageSquare, Calendar, Search, Brain, Trash2, Pin, PinOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchApi } from "@/lib/api";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

export default function MemoryPage() {
    const [history, setHistory] = useState<any[]>([]);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [historySearch, setHistorySearch] = useState("");

    const [memories, setMemories] = useState<any[]>([]);
    const [memoriesLoading, setMemoriesLoading] = useState(false);
    const [memoriesSearch, setMemoriesSearch] = useState("");

    const loadSessions = () => {
        setHistoryLoading(true);
        fetchApi("/api/sessions")
            .then((data: any) => {
                setHistory(data);
                setHistoryLoading(false);
            })
            .catch(err => {
                console.error(err);
                setHistoryLoading(false);
                toast.error("加载会话失败");
            });
    };

    const loadMemories = (q?: string) => {
        setMemoriesLoading(true);
        const url = q ? `/api/memories?q=${encodeURIComponent(q)}&limit=100` : `/api/memories?limit=100`;
        fetchApi(url)
            .then((data: any) => {
                setMemories(Array.isArray(data) ? data : []);
                setMemoriesLoading(false);
            })
            .catch(err => {
                console.error(err);
                setMemoriesLoading(false);
                toast.error("加载记忆失败");
            });
    };

    const HistorySkeleton = () => (
        <div className="grid gap-4">
            {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-xl border bg-card p-6">
                    <div className="flex flex-row items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Skeleton className="h-4 w-4 rounded-full" />
                            <Skeleton className="h-5 w-48" />
                        </div>
                        <div className="flex items-center gap-4">
                            <Skeleton className="h-3 w-32" />
                            <Skeleton className="h-8 w-20" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );

    useEffect(() => {
        loadSessions();
    }, []);

    const handleDeleteSession = async (id: string) => {
        try {
            await fetchApi(`/api/sessions/${id}`, { method: "DELETE" });
            toast.success("会话已删除");
            setHistory(prev => prev.filter(s => s.id !== id));
        } catch (err: any) {
            console.error(err);
            toast.error(`删除失败: ${err.message}`);
        }
    };

    const handleTogglePin = async (id: string, currentPinned: boolean) => {
        try {
            const isPinned = !currentPinned;
            await fetchApi(`/api/sessions/${id}/pin`, {
                method: "PATCH",
                body: JSON.stringify({ isPinned })
            });
            toast.success(isPinned ? "已置顶" : "已取消置顶");
            loadSessions();
        } catch (err: any) {
            console.error(err);
            toast.error(`操作失败: ${err.message}`);
        }
    };

    const handleDeleteMemory = async (id: string) => {
        try {
            await fetchApi(`/api/memories/${id}`, { method: "DELETE" });
            toast.success("记忆已删除");
            setMemories(prev => prev.filter(m => m.id !== id));
        } catch (err: any) {
            toast.error(`删除失败: ${err.message}`);
        }
    };

    const filteredHistory = history.filter(item =>
        item.title.toLowerCase().includes(historySearch.toLowerCase())
    );

    return (
        <div className="h-full overflow-y-auto space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">记忆中心</h1>
                <p className="text-muted-foreground">浏览对话历史，查看和管理 AI 的长期记忆。</p>
            </div>

            <Tabs defaultValue="history">
                <TabsList>
                    <TabsTrigger value="history" className="flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5" />
                        对话历史
                    </TabsTrigger>
                    <TabsTrigger
                        value="memories"
                        className="flex items-center gap-1.5"
                        onClick={() => { if (memories.length === 0) loadMemories(); }}
                    >
                        <Brain className="w-3.5 h-3.5" />
                        长期记忆库
                    </TabsTrigger>
                </TabsList>

                {/* ── Tab 1: 对话历史 ── */}
                <TabsContent value="history" className="mt-4">
                    <div className="flex items-center justify-between mb-4">
                        <div className="relative">
                            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                            <Input
                                className="pl-9 w-64"
                                placeholder="搜索对话..."
                                value={historySearch}
                                onChange={(e) => setHistorySearch(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="grid gap-4">
                        {historyLoading ? (
                            <HistorySkeleton />
                        ) : filteredHistory.length > 0 ? (
                            filteredHistory.map((session) => (
                                <Card
                                    key={session.id}
                                    className={`hover:bg-muted/30 transition-colors cursor-pointer group ${session.is_pinned ? 'border-primary/50 bg-primary/5' : ''}`}
                                >
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                        <CardTitle className="text-base font-semibold flex items-center gap-2">
                                            {session.is_pinned && <Pin className="w-3 h-3 text-primary fill-primary" />}
                                            <MessageSquare className="w-4 h-4 text-primary" />
                                            {session.title}
                                        </CardTitle>
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center text-xs text-muted-foreground gap-1">
                                                <Calendar className="w-3 h-3" />
                                                {new Date(session.updatedAt).toLocaleString()}
                                            </div>
                                            <Button size="sm" variant="ghost"
                                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                                                onClick={() => handleTogglePin(session.id, session.is_pinned)}
                                            >
                                                {session.is_pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                                            </Button>
                                            <a href={`/chat?sessionId=${session.id}`}>
                                                <Button size="sm" variant="outline">进入会话</Button>
                                            </a>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button size="sm" variant="ghost"
                                                        className="text-destructive hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>确认删除此对话？</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            此操作将永久删除与该会话相关的所有消息，且无法撤销。
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>取消</AlertDialogCancel>
                                                        <AlertDialogAction
                                                            onClick={() => handleDeleteSession(session.id)}
                                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                        >
                                                            确认删除
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    </CardHeader>
                                </Card>
                            ))
                        ) : (
                            <div className="py-20 text-center text-muted-foreground border-2 border-dashed rounded-xl">
                                <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                <p>未找到匹配的对话记录</p>
                            </div>
                        )}
                    </div>
                </TabsContent>

                {/* ── Tab 2: 长期记忆库 ── */}
                <TabsContent value="memories" className="mt-4">
                    <div className="flex items-center justify-between mb-4">
                        <div className="relative flex-1 max-w-xs">
                            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                            <Input
                                className="pl-9"
                                placeholder="搜索记忆内容..."
                                value={memoriesSearch}
                                onChange={(e) => {
                                    setMemoriesSearch(e.target.value);
                                    if (e.target.value.length === 0 || e.target.value.length >= 2) {
                                        loadMemories(e.target.value || undefined);
                                    }
                                }}
                            />
                        </div>
                        <span className="text-sm text-muted-foreground ml-3">共 {memories.length} 条记忆</span>
                    </div>

                    {memoriesLoading ? (
                        <div className="space-y-3">
                            {[1, 2, 3].map(i => (
                                <Skeleton key={i} className="h-24 w-full rounded-xl" />
                            ))}
                        </div>
                    ) : memories.length > 0 ? (
                        <div className="grid gap-3">
                            {memories.map((mem) => (
                                <Card key={mem.id} className="group hover:bg-muted/20 transition-colors">
                                    <CardContent className="pt-4 pb-3">
                                        <div className="flex items-start gap-3">
                                            <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                                                <Brain className="w-4 h-4 text-amber-500" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                {mem.key && (
                                                    <div className="text-xs font-medium text-primary mb-1">{mem.key}</div>
                                                )}
                                                <p className="text-sm text-muted-foreground line-clamp-3">
                                                    {typeof mem.content === "string"
                                                        ? mem.content.slice(0, 300)
                                                        : JSON.stringify(mem.content).slice(0, 300)}
                                                </p>
                                                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                                                    <span>{new Date(mem.created_at).toLocaleString()}</span>
                                                    {mem.session_id && <span>会话: {mem.session_id.slice(0, 8)}…</span>}
                                                </div>
                                            </div>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button
                                                        size="sm" variant="ghost"
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>删除这条记忆？</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            删除后 AI 将无法在未来对话中使用此记忆。此操作无法撤销。
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>取消</AlertDialogCancel>
                                                        <AlertDialogAction
                                                            onClick={() => handleDeleteMemory(mem.id)}
                                                            className="bg-destructive text-destructive-foreground"
                                                        >
                                                            确认删除
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    ) : (
                        <div className="py-20 text-center text-muted-foreground border-2 border-dashed rounded-xl">
                            <Brain className="w-12 h-12 mx-auto mb-4 opacity-20" />
                            <p>暂无长期记忆</p>
                            <p className="text-xs mt-1">当 AI 在对话中使用 memory_remember 工具时，记忆会自动存储到这里</p>
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
