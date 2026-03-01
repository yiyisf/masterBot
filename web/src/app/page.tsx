"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Puzzle,
  Activity,
  BrainCircuit,
  Network,
  BarChart2,
  CalendarClock,
  Database,
  Plus,
  BookOpen,
  Download,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { fetchApi } from "@/lib/api";
import Link from "next/link";

export default function DashboardPage() {
  const [status, setStatus] = useState<any>(null);
  const [improvements, setImprovements] = useState<any[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetchApi("/api/status")
      .then((data: any) => {
        setStatus(data);
        setImprovements(data.recentImprovements || []);
      })
      .catch(console.error);
  }, []);

  const stats = [
    {
      title: "总会话数",
      value: status?.stats?.totalSessions ?? "—",
      icon: MessageSquare,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      title: "今日消息",
      value: status?.stats?.totalMessages ?? "—",
      icon: Activity,
      color: "text-green-500",
      bg: "bg-green-500/10",
    },
    {
      title: "活跃技能",
      value: status?.stats?.skillCount ?? "—",
      icon: Puzzle,
      color: "text-purple-500",
      bg: "bg-purple-500/10",
    },
    {
      title: "知识节点",
      value: status?.stats?.knowledgeNodeCount ?? "—",
      icon: Network,
      color: "text-cyan-500",
      bg: "bg-cyan-500/10",
    },
    {
      title: "长期记忆",
      value: status?.stats?.memoryCount ?? "—",
      icon: BrainCircuit,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
  ];

  const capabilities = [
    {
      icon: BrainCircuit,
      title: "自主学习进化",
      description: "遇到无法完成的任务时，自动生成新技能，持续扩展能力边界，无需 IT 人员介入。",
      color: "text-violet-500",
      bg: "bg-violet-500/10",
      examples: ["帮我生成一个查询 ERP 订单状态的技能", "学习如何对接我们公司的 HR 系统 API"],
    },
    {
      icon: Network,
      title: "企业知识图谱",
      description: "GraphRAG 深度检索，理解文档间关联关系，比传统关键词搜索更准确地找到企业知识。",
      color: "text-cyan-500",
      bg: "bg-cyan-500/10",
      examples: ["搜索差旅报销流程相关规定", "查找关于产品合规认证的内部文档"],
    },
    {
      icon: BarChart2,
      title: "数据自然语言查询",
      description: "直接用中文描述数据需求，自动转为 SQL，生成可视化报表，无需掌握任何数据库技能。",
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
      examples: ["查询本周华东区销售额排名前10的客户", "生成上月各部门费用对比图"],
    },
    {
      icon: CalendarClock,
      title: "定时 Agent 任务",
      description: "配置定时任务，让 AI 每天自动生成报告、发送通知、执行巡检，解放重复性工作。",
      color: "text-orange-500",
      bg: "bg-orange-500/10",
      examples: ["每天 8 点自动生成昨日销售日报", "每周一发送项目进度摘要到飞书"],
    },
  ];

  const actionButtons = [
    {
      icon: Plus,
      label: "新建对话",
      description: "开始与 AI 助手对话",
      href: "/chat",
      variant: "default" as const,
    },
    {
      icon: BookOpen,
      label: "导入知识",
      description: "上传文档、录入企业知识库",
      href: "/knowledge",
      variant: "outline" as const,
    },
    {
      icon: Download,
      label: "安装技能",
      description: "扩展 AI 能力边界",
      href: "/skills",
      variant: "outline" as const,
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-8 max-w-7xl mx-auto">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">控制台</h1>
          <p className="text-muted-foreground mt-1">
            欢迎回来！CMaster Bot 正在运行 —{" "}
            <span className="text-primary font-medium">
              {status?.llm?.provider ?? "LLM 连接中..."}
            </span>
          </p>
        </div>

        {/* 5 Stats Cards */}
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((stat) => (
            <Card key={stat.title} className="hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-xs font-medium text-muted-foreground">{stat.title}</CardTitle>
                <div className={`p-1.5 rounded-md ${stat.bg}`}>
                  <stat.icon className={`w-3.5 h-3.5 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main content: Recent sessions + Capability showcase */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Recent sessions — 7/12 */}
          <Card className="lg:col-span-7 flex flex-col">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>最近对话</CardTitle>
                <Link href="/memory">
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                    查看全部 <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto max-h-[360px]">
              {status?.sessions?.length > 0 ? (
                <div className="space-y-2">
                  {status.sessions.slice(0, 10).map((session: any) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors group cursor-pointer"
                      onClick={() => router.push(`/chat?sessionId=${session.id}`)}
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <MessageSquare className="w-4 h-4 text-primary" />
                        </div>
                        <div className="overflow-hidden">
                          <div className="font-medium truncate text-sm">{session.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(session.updatedAt).toLocaleString("zh-CN")}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                        恢复对话 →
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">暂无对话记录</p>
                  <Link href="/chat">
                    <Button variant="outline" size="sm" className="mt-3">
                      <Plus className="w-3.5 h-3.5 mr-1" /> 开始第一次对话
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Capability showcase — 5/12 */}
          <div className="lg:col-span-5 space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
              核心差异化能力
            </h2>
            {capabilities.map((cap) => (
              <Card key={cap.title} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${cap.bg} shrink-0 mt-0.5`}>
                      <cap.icon className={`w-4 h-4 ${cap.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{cap.title}</div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{cap.description}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {cap.examples.map((ex) => (
                          <button
                            key={ex}
                            onClick={() => router.push(`/chat?prompt=${encodeURIComponent(ex)}`)}
                            className="text-[11px] px-2 py-0.5 rounded-full border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors truncate max-w-[160px]"
                            title={ex}
                          >
                            {ex.length > 18 ? ex.slice(0, 18) + "…" : ex}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* 3 Action Buttons */}
        <div className="grid gap-4 sm:grid-cols-3">
          {actionButtons.map((btn) => (
            <Card
              key={btn.label}
              className="hover:shadow-md transition-shadow cursor-pointer group"
              onClick={() => router.push(btn.href)}
            >
              <CardContent className="pt-6 pb-5 flex flex-col items-center text-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <btn.icon className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <div className="font-semibold">{btn.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{btn.description}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Agent Growth Track */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <CardTitle className="text-base">Agent 成长轨迹</CardTitle>
              <Badge variant="secondary" className="text-[10px]">自我进化</Badge>
            </div>
            <CardDescription>
              每次负向反馈后，系统会自动分析失败原因并按需生成新技能
            </CardDescription>
          </CardHeader>
          <CardContent>
            {improvements.length > 0 ? (
              <div className="space-y-3">
                {improvements.map((evt: any, i: number) => (
                  <div key={evt.id ?? i} className="flex items-start gap-3 text-sm">
                    <div className="mt-0.5">
                      {evt.action === "skill_generated" ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <Clock className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1">
                      <span className="font-medium">
                        {evt.action === "skill_generated"
                          ? `新技能已生成: ${evt.skill_name ?? "未知"}`
                          : "收到反馈，已记录分析"}
                      </span>
                      {evt.analysis && (
                        <span className="text-muted-foreground ml-1">· {evt.analysis}</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(evt.created_at).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <BrainCircuit className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">暂无成长记录</p>
                <p className="text-xs mt-1">尝试对一条回复点击"没帮助"，触发 AI 自我改进</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
