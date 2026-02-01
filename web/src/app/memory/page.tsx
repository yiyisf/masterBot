"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, Calendar, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { Trash2, Pin, PinOff } from "lucide-react";
import { toast } from "sonner";

export default function MemoryPage() {
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");

    const loadSessions = () => {
        setLoading(true);
        fetchApi("/api/sessions")
            .then((data: any) => {
                setHistory(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
                toast.error("加载会话失败");
            });
    };

    useEffect(() => {
        loadSessions();
    }, []);

    const handleDelete = async (id: string) => {
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

            // Reload to get correct sorting from backend
            loadSessions();
        } catch (err: any) {
            console.error(err);
            toast.error(`操作失败: ${err.message}`);
        }
    };

    const filteredHistory = history.filter(item =>
        item.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="h-full overflow-y-auto space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">对话历史</h1>
                    <p className="text-muted-foreground">浏览和管理您的所有过去对话及其上下文记忆。</p>
                </div>
                <div className="flex gap-2">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                        <Input
                            className="pl-9 w-64"
                            placeholder="搜索对话..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className="grid gap-4">
                {loading ? (
                    <div className="py-20 text-center text-muted-foreground animate-pulse">
                        加载中...
                    </div>
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
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center text-xs text-muted-foreground gap-1">
                                        <Calendar className="w-3 h-3" />
                                        {new Date(session.updatedAt).toLocaleString()}
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => handleTogglePin(session.id, session.is_pinned)}
                                    >
                                        {session.is_pinned ? (
                                            <PinOff className="w-4 h-4" />
                                        ) : (
                                            <Pin className="w-4 h-4" />
                                        )}
                                    </Button>

                                    <a href={`/chat?sessionId=${session.id}`}>
                                        <Button size="sm" variant="outline">进入会话</Button>
                                    </a>

                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>确认删除此对话？</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    此操作将永久删除与该会话相关的所有消息和上下文记忆，且无法撤销。
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>取消</AlertDialogCancel>
                                                <AlertDialogAction onClick={() => handleDelete(session.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
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
        </div>
    );
}
