"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, Calendar, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fetchApi } from "@/lib/api";

export default function MemoryPage() {
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        fetchApi("/api/sessions")
            .then((data: any) => {
                setHistory(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

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
                        <Card key={session.id} className="hover:bg-muted/30 transition-colors cursor-pointer group">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-base font-semibold flex items-center gap-2">
                                    <MessageSquare className="w-4 h-4 text-primary" />
                                    {session.title}
                                </CardTitle>
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center text-xs text-muted-foreground gap-1">
                                        <Calendar className="w-3 h-3" />
                                        {new Date(session.updatedAt).toLocaleString()}
                                    </div>
                                    <a href={`/chat?sessionId=${session.id}`}>
                                        <Button size="sm" variant="outline">进入会话</Button>
                                    </a>
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
