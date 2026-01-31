"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, Calendar, Trash2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function MemoryPage() {
    const [history, setHistory] = useState<any[]>([]);

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
                        <Input className="pl-9 w-64" placeholder="搜索对话..." />
                    </div>
                    <Button variant="outline">导出数据</Button>
                </div>
            </div>

            <div className="grid gap-4">
                {[1, 2, 3].map((i) => (
                    <Card key={i} className="hover:bg-muted/30 transition-colors cursor-pointer group">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-base font-semibold flex items-center gap-2">
                                <MessageSquare className="w-4 h-4 text-primary" />
                                关于项目架构的讨论 #{i}
                            </CardTitle>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center text-xs text-muted-foreground gap-1">
                                    <Calendar className="w-3 h-3" />
                                    2024-05-{20 - i}
                                </div>
                                <Button size="icon" variant="ghost" className="opacity-0 group-hover:opacity-100 text-destructive h-8 w-8">
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                                用户: 帮我设计一个企业级的 AI 助手架构，需要支持热加载和 Web 端控制台...
                            </p>
                        </CardContent>
                    </Card>
                ))}

                <div className="py-20 text-center text-muted-foreground border-2 border-dashed rounded-xl">
                    <History className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>更多历史记录正在加载中...</p>
                </div>
            </div>
        </div>
    );
}

function History({ className }: { className?: string }) {
    return <MessageSquare className={className} />;
}
