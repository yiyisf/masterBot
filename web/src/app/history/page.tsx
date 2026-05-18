"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare, Trash2, Download, Search, Clock,
  ChevronRight, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/layout/empty-state";
import { fetchApi } from "@/lib/api";
import { toast } from "sonner";

interface Session {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastMessage?: string;
}

function groupByDate(sessions: Session[]): Record<string, Session[]> {
  const groups: Record<string, Session[]> = {};
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  for (const s of sessions) {
    const d = new Date(s.updatedAt || s.createdAt);
    const dStr = d.toDateString();
    let label: string;
    if (dStr === todayStr) label = "今天";
    else if (dStr === yesterdayStr) label = "昨天";
    else {
      label = d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
    }
    if (!groups[label]) groups[label] = [];
    groups[label].push(s);
  }
  return groups;
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HistoryPage() {
  const router = useRouter();
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [deleting, setDeleting] = React.useState<string | null>(null);

  const loadSessions = React.useCallback(async () => {
    try {
      const data = await fetchApi<{ sessions: Session[] }>("/api/sessions");
      setSessions(data.sessions ?? []);
    } catch {
      toast.error("加载历史记录失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadSessions(); }, [loadSessions]);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.toLowerCase();
    return sessions.filter(
      (s) =>
        s.title?.toLowerCase().includes(q) ||
        s.lastMessage?.toLowerCase().includes(q),
    );
  }, [sessions, search]);

  const grouped = React.useMemo(() => groupByDate(filtered), [filtered]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(id);
    try {
      await fetchApi(`/api/sessions/${id}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      toast.success("会话已删除");
    } catch {
      toast.error("删除失败");
    } finally {
      setDeleting(null);
    }
  };

  const handleExport = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    let url: string | undefined;
    try {
      const data = await fetchApi<{ messages: unknown[] }>(`/api/sessions/${id}/messages`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `session-${id}.json`;
      a.click();
    } catch {
      toast.error("导出失败");
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">历史对话</h1>
          <p className="text-sm text-muted-foreground">
            共 {sessions.length} 条会话记录
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/chat")}
        >
          新建对话
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="搜索历史对话..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="h-8 w-8" />}
          title={search ? "未找到匹配记录" : "暂无历史对话"}
          description={search ? "换个关键词试试" : "开始第一次对话后，记录会在这里显示"}
          action={
            !search ? (
              <Button onClick={() => router.push("/chat")}>开始对话</Button>
            ) : undefined
          }
        />
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-6 pr-2">
            {Object.entries(grouped).map(([label, group]) => (
              <div key={label}>
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {label}
                  </span>
                </div>
                <div className="space-y-1">
                  {group.map((session) => (
                    <button
                      key={session.id}
                      className="group w-full flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/50"
                      onClick={() =>
                        router.push(`/chat?sessionId=${session.id}`)
                      }
                    >
                      <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-sm">
                            {session.title || "未命名对话"}
                          </span>
                          {session.messageCount !== undefined && (
                            <Badge variant="secondary" className="text-xs shrink-0">
                              {session.messageCount} 条
                            </Badge>
                          )}
                        </div>
                        {session.lastMessage && (
                          <p className="truncate text-xs text-muted-foreground mt-0.5">
                            {session.lastMessage}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {formatTime(session.updatedAt || session.createdAt)}
                        </span>
                        {/* Action buttons - visible on hover */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => handleExport(session.id, e)}
                            title="导出"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={(e) => handleDelete(session.id, e)}
                            disabled={deleting === session.id}
                            title="删除"
                          >
                            {deleting === session.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </button>
                  ))}
                </div>
                <Separator className="mt-4" />
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
