"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MessageSquare,
  Puzzle,
  Activity,
  Zap
} from "lucide-react";
import { fetchApi } from "@/lib/api";

export default function DashboardPage() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    fetchApi("/api/status")
      .then(setStatus)
      .catch(console.error);
  }, []);

  const stats = [
    {
      title: "总会话数",
      value: status?.stats?.totalSessions || "0",
      icon: MessageSquare,
      color: "text-blue-500",
    },
    {
      title: "今日消息",
      value: status?.stats?.totalMessages || "0",
      icon: Activity,
      color: "text-green-500",
    },
    {
      title: "活跃技能",
      value: status?.stats?.skillCount || "0",
      icon: Puzzle,
      color: "text-purple-500",
    },
    {
      title: "LLM 提供商",
      value: status?.llm?.provider || "未连接",
      icon: Zap,
      color: "text-amber-500",
    },
  ];

  return (
    <div className="h-full overflow-y-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">你好, 这里是控制台</h1>
        <p className="text-muted-foreground">欢迎回来，您的 AI 助手已准备就绪。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className={cn("w-4 h-4", stat.color)} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>最近对话</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12 text-muted-foreground italic">
              暂无对话记录
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>系统日志</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 font-mono text-xs">
              <div className="flex gap-2">
                <span className="text-green-500">[INFO]</span>
                <span>GatewayServer 启动成功</span>
              </div>
              <div className="flex gap-2">
                <span className="text-blue-500">[DEBUG]</span>
                <span>成功加载 3 个内置技能</span>
              </div>
              <div className="flex gap-2">
                <span className="text-amber-500">[WARN]</span>
                <span>未发现自定义技能目录</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(" ");
}
