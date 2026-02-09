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
  CreditCard,
  LogOut,
  Bell,
  BadgeCheck,
  Plus,
  Trash2,
  Pin,
  PinOff,
  Pencil,
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
  is_pinned: boolean;
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
        { title: "系统日志", url: "#" },
      ],
    },
    {
      title: "智能对话 (Chat)",
      url: "/chat",
      icon: MessageSquare,
      items: [
        { title: "对话界面", url: "/chat" },
        { title: "Playground", url: "#", badge: "Soon" },
      ],
    },
    {
      title: "能力扩展 (Skills)",
      url: "/skills",
      icon: Puzzle,
      items: [
        { title: "技能管理", url: "/skills" },
        { title: "插件市场", url: "#", badge: "New" },
      ],
    },
    {
      title: "记忆检索 (Memory)",
      url: "/memory",
      icon: Library,
      items: [
        { title: "对话记录", url: "/memory" },
        { title: "知识库 (RAG)", url: "#", badge: "Soon" },
      ],
    },
  ],
  navSecondary: [
    {
      title: "系统设置",
      url: "/settings",
      icon: Settings,
    },
    {
      title: "技术文档",
      url: "#",
      icon: BookOpen,
    },
  ],
};

/**
 * Session list component for the sidebar
 */
function SessionList() {
  const [sessions, setSessions] = React.useState<SessionItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState("");
  const router = useRouter();
  const pathname = usePathname();

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

  React.useEffect(() => {
    loadSessions();
  }, [loadSessions]);

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
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await fetchApi(`/api/sessions/${id}/title`, {
        method: 'PATCH',
        body: JSON.stringify({ title: editTitle.trim() }),
      });
      setSessions(prev =>
        prev.map(s => s.id === id ? { ...s, title: editTitle.trim() } : s)
      );
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
    setEditingId(null);
  };

  if (loading) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground animate-pulse">
        加载会话列表...
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        暂无历史会话
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[300px]">
      <div className="space-y-0.5 px-1">
        {sessions.map(session => (
          <div
            key={session.id}
            className="group/session flex items-center gap-1 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50 cursor-pointer transition-colors"
            onClick={() => router.push(`/chat?sessionId=${session.id}`)}
          >
            {session.is_pinned && <Pin className="w-3 h-3 text-amber-500 shrink-0" />}
            {editingId === session.id ? (
              <input
                className="flex-1 bg-transparent border-b border-primary text-xs outline-none min-w-0"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => handleRename(session.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(session.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="flex-1 truncate text-muted-foreground group-hover/session:text-foreground transition-colors">
                {session.title}
              </span>
            )}
            <div className="flex gap-0.5 opacity-0 group-hover/session:opacity-100 transition-opacity shrink-0">
              <button
                onClick={(e) => {
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
                onClick={(e) => handleTogglePin(session.id, session.is_pinned, e)}
                className="p-0.5 rounded hover:bg-muted"
                title={session.is_pinned ? "取消置顶" : "置顶"}
              >
                {session.is_pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
              </button>
              <button
                onClick={(e) => handleDelete(session.id, e)}
                className="p-0.5 rounded hover:bg-destructive/10 text-destructive"
                title="删除"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
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

      <SidebarContent>
        <SidebarGroup>
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

        {/* Session List */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 font-semibold flex items-center justify-between">
            <span>历史会话 (History)</span>
            <Link
              href="/chat"
              className="p-0.5 rounded hover:bg-muted transition-colors"
              title="新建对话"
            >
              <Plus className="size-3.5" />
            </Link>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SessionList />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel className="px-2 font-semibold">系统运营 (Operations)</SidebarGroupLabel>
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
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
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
                  <DropdownMenuItem>
                    <BadgeCheck className="mr-2 size-4" />
                    身份账号
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <CreditCard className="mr-2 size-4" />
                    计费方案
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Bell className="mr-2 size-4" />
                    消息通知
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive">
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
