"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  Settings,
  Puzzle,
  Bot,
  ChevronRight,
  BookOpen,
  Library,
  ChevronsUpDown,
  LogOut,
  Plus,
  Trash2,
  Pin,
  PinOff,
  Pencil,
  Webhook,
  BookText,
  Monitor,
  BarChart2,
  FileText,
  Wifi,
  ShieldCheck,
  Search,
  X,
} from "lucide-react";


import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenuAction,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

import {
  Badge
} from "@/components/ui/badge";

import { fetchApi } from "@/lib/api";
import { ScrollArea } from "@/components/ui/scroll-area";

interface NavItem {
  title: string;
  url: string;
  icon?: any;
  isActive?: boolean;
  badge?: string;
  items?: {
    title: string;
    url: string;
    badge?: string;
  }[];
}

interface SidebarData {
  user: {
    name: string;
    email: string;
    avatar: string;
  };
  teams: {
    name: string;
    logo: any;
    plan: string;
  }[];
  navMain: NavItem[];
  navSecondary: NavItem[];
}

interface SessionItem {
  id: string;
  title: string;
  updatedAt: string;
  createdAt?: string;
  is_pinned: boolean;
  /** 最后一条消息的纯文本预览（后端截断至 80 字符） */
  preview?: string;
}

/** 按 updatedAt 将会话分组为：置顶 / 今天 / 昨天 / 本周 / 更早 */
function groupSessions(sessions: SessionItem[]): Array<{ label: string; items: SessionItem[] }> {
  const pinned = sessions.filter(s => s.is_pinned);
  const rest = sessions.filter(s => !s.is_pinned);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400_000);
  const weekStart = new Date(todayStart.getTime() - 6 * 86400_000);

  const groups: Record<string, SessionItem[]> = { today: [], yesterday: [], week: [], older: [] };
  for (const s of rest) {
    const d = new Date(s.updatedAt);
    if (d >= todayStart) groups.today.push(s);
    else if (d >= yesterdayStart) groups.yesterday.push(s);
    else if (d >= weekStart) groups.week.push(s);
    else groups.older.push(s);
  }

  return [
    ...(pinned.length ? [{ label: '📌 置顶', items: pinned }] : []),
    ...(groups.today.length ? [{ label: '今天', items: groups.today }] : []),
    ...(groups.yesterday.length ? [{ label: '昨天', items: groups.yesterday }] : []),
    ...(groups.week.length ? [{ label: '本周', items: groups.week }] : []),
    ...(groups.older.length ? [{ label: '更早', items: groups.older }] : []),
  ];
}

const data: SidebarData = {
  user: {
    name: "Admin User",
    email: "admin@cmaster.io",
    avatar: "/avatars/admin.png",
  },
  teams: [
    {
      name: "CMaster AI",
      logo: Bot,
      plan: "Enterprise",
    }
  ],
  navMain: [
    {
      title: "控制台 (Platform)",
      url: "/",
      icon: LayoutDashboard,
      isActive: true,
      items: [
        { title: "仪表盘", url: "/" },
        { title: "工作流编排", url: "/workflow" },
        { title: "Conductor 编排", url: "/conductor", badge: "NEW" },
      ],
    },
    {
      title: "智能对话 (Chat)",
      url: "/chat",
      icon: MessageSquare,
      items: [
        { title: "对话界面", url: "/chat" },
        { title: "定时任务", url: "/scheduled" },
      ],
    },
    {
      title: "能力扩展 (Skills)",
      url: "/skills",
      icon: Puzzle,
      items: [
        { title: "技能管理", url: "/skills" },
        { title: "企业连接器", url: "/connectors" },
        { title: "Prompt 模板库", url: "/prompts", badge: "NEW" },
      ],
    },
    {
      title: "记忆检索 (Memory)",
      url: "/memory",
      icon: Library,
      items: [
        { title: "对话记录", url: "/memory" },
        { title: "知识图谱", url: "/knowledge" },
      ],
    },
    {
      title: "运维自动化 (AIOps)",
      url: "/webhooks",
      icon: Webhook,
      items: [
        { title: "Webhook 管理", url: "/webhooks" },
        { title: "Runbook 执行", url: "/runbooks" },
        { title: "AI-RPA 自动化", url: "/rpa" },
      ],
    },
    {
      title: "托管 Agent",
      url: "/agents",
      icon: Bot,
      items: [
        { title: "Agent 管理台", url: "/agents", badge: "NEW" },
      ],
    },
    {
      title: "合规审计",
      url: "/audit",
      icon: ShieldCheck,
      items: [
        { title: "审计日志", url: "/audit" },
      ],
    },
  ],
  navSecondary: [
    {
      title: "API 文档",
      url: "/api-docs",
      icon: Wifi,
    },
    {
      title: "系统设置",
      url: "/settings",
      icon: Settings,
    },
    {
      title: "技术文档",
      url: "https://github.com/anthropics/cmaster-bot/blob/main/docs/getting-started.md",
      icon: BookOpen,
    },
  ],
};

/**
 * Session list with search, date grouping and last-message preview
 */
function SessionList() {
  const [sessions, setSessions] = React.useState<SessionItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState("");
  const router = useRouter();

  const loadSessions = React.useCallback(async () => {
    try {
      const data = await fetchApi<SessionItem[]>('/api/sessions');
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetchApi(`/api/sessions/${id}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const handleTogglePin = async (id: string, isPinned: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetchApi(`/api/sessions/${id}/pin`, {
        method: 'PATCH',
        body: JSON.stringify({ isPinned: !isPinned }),
      });
      setSessions(prev =>
        prev.map(s => s.id === id ? { ...s, is_pinned: !isPinned } : s)
          .sort((a, b) => {
            if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          })
      );
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const handleRename = async (id: string) => {
    if (!editTitle.trim()) { setEditingId(null); return; }
    try {
      await fetchApi(`/api/sessions/${id}/title`, {
        method: 'PATCH',
        body: JSON.stringify({ title: editTitle.trim() }),
      });
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title: editTitle.trim() } : s));
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
    setEditingId(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-1 px-2 pt-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 rounded-md bg-muted/40 animate-pulse" />
        ))}
      </div>
    );
  }

  // Filter by search query
  const q = search.toLowerCase().trim();
  const filtered = q
    ? sessions.filter(s =>
        s.title.toLowerCase().includes(q) || (s.preview ?? '').toLowerCase().includes(q)
      )
    : sessions;

  const groups = groupSessions(filtered);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Search input */}
      <div className="px-2 pb-1.5 shrink-0">
        <div className="relative flex items-center">
          <Search className="absolute left-2 w-3 h-3 text-muted-foreground/60 pointer-events-none" />
          <input
            type="text"
            placeholder="搜索会话…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-muted/40 text-xs rounded-md pl-6 pr-6 py-1.5 outline-none border border-transparent focus:border-border focus:bg-background transition-colors placeholder:text-muted-foreground/50"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-1.5 p-0.5 rounded hover:bg-muted text-muted-foreground/60"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Session list with date groups */}
      <ScrollArea className="flex-1 min-h-0">
        {groups.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            {q ? '没有匹配的会话' : '暂无历史会话'}
          </div>
        ) : (
          <div className="space-y-0.5 px-1 pb-1">
            {groups.map(group => (
              <div key={group.label}>
                {/* Group label */}
                <div className="px-2 pt-2 pb-0.5 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider select-none">
                  {group.label}
                </div>
                {group.items.map(session => (
                  <div
                    key={session.id}
                    className="group/session flex items-start gap-1 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/chat?sessionId=${session.id}`)}
                  >
                    {session.is_pinned && (
                      <Pin className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      {editingId === session.id ? (
                        <input
                          className="w-full bg-transparent border-b border-primary text-xs outline-none"
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          onBlur={() => handleRename(session.id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRename(session.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <>
                          <p className="text-xs truncate text-foreground/80 group-hover/session:text-foreground transition-colors leading-tight">
                            {session.title}
                          </p>
                          {session.preview && (
                            <p className="text-[10px] truncate text-muted-foreground/50 leading-tight mt-0.5">
                              {session.preview}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex gap-0.5 opacity-0 group-hover/session:opacity-100 transition-opacity shrink-0 mt-0.5">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setEditingId(session.id);
                          setEditTitle(session.title);
                        }}
                        className="p-0.5 rounded hover:bg-muted"
                        title="重命名"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={e => handleTogglePin(session.id, session.is_pinned, e)}
                        className="p-0.5 rounded hover:bg-muted"
                        title={session.is_pinned ? "取消置顶" : "置顶"}
                      >
                        {session.is_pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={e => handleDelete(session.id, e)}
                        className="p-0.5 rounded hover:bg-destructive/10 text-destructive"
                        title="删除"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* View all link */}
      {sessions.length > 20 && !q && (
        <Link
          href="/memory"
          className="mx-3 mt-0.5 mb-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ChevronRight className="w-3 h-3" />
          查看全部 {sessions.length} 条会话
        </Link>
      )}
    </div>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const activeTeam = data.teams[0];
  const TeamLogo = activeTeam.logo;

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 border-b flex-row items-center gap-2 px-4 group-data-[collapsible=icon]:justify-center">
        <div className="flex flex-1 items-center gap-2 overflow-hidden transition-all group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shrink-0">
            <TeamLogo className="size-4" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold uppercase">
              {activeTeam.name}
            </span>
            <span className="truncate text-xs font-medium text-muted-foreground">
              {activeTeam.plan}
            </span>
          </div>
        </div>
        <SidebarTrigger className="shrink-0" />
      </SidebarHeader>

      {/* overflow-hidden overrides the default overflow-auto so only the inner ScrollArea scrolls */}
      <SidebarContent className="overflow-hidden">
        <SidebarGroup className="shrink-0">
          <SidebarGroupLabel className="px-2 font-semibold">主平台 (Platform)</SidebarGroupLabel>
          <SidebarMenu>
            {data.navMain.map((item) => (
              <Collapsible
                key={item.title}
                asChild
                defaultOpen={item.isActive || pathname.startsWith(item.url)}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip={item.title}>
                      {item.icon && <item.icon className="size-4" />}
                      <span className="font-medium">{item.title}</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.items?.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton asChild isActive={pathname === subItem.url}>
                            <a href={subItem.url} className="flex items-center w-full">
                              <span>{subItem.title}</span>
                              {subItem.badge && (
                                <Badge variant="secondary" className="ml-auto h-4 px-1 text-[10px] leading-none shrink-0">
                                  {subItem.badge}
                                </Badge>
                              )}
                            </a>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {/* Session List — flex-1 takes all remaining height; hidden in icon mode */}
        <SidebarGroup className="flex-1 min-h-0 overflow-hidden group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="px-2 font-semibold flex items-center justify-between shrink-0">
            <span>历史会话 (History)</span>
            <Link
              href="/chat"
              className="p-0.5 rounded hover:bg-muted transition-colors"
              title="新建对话"
            >
              <Plus className="size-3.5" />
            </Link>
          </SidebarGroupLabel>
          <SidebarGroupContent className="flex flex-col min-h-0 flex-1 overflow-hidden">
            <SessionList />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {/* Secondary nav anchored to footer — never overlaps session list */}
        <SidebarMenu>
          {data.navSecondary.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild size="sm" isActive={pathname === item.url} tooltip={item.title}>
                <Link href={item.url}>
                  <item.icon className="size-4" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>

        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-muted">AD</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{data.user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{data.user.email}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="bottom"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-muted">AD</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{data.user.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{data.user.email}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <a href="/settings" className="flex items-center">
                      <Settings className="mr-2 size-4" />
                      前往设置
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-muted-foreground">
                  <LogOut className="mr-2 size-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
