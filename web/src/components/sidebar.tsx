"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  Settings,
  Puzzle,
  History,
  Bot,
  Command,
  ChevronRight,
  Sparkles,
  BookOpen,
  Library,
  Terminal,
  Cpu,
  User2,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Bell,
  BadgeCheck,
  MoreHorizontal
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

function botLogo({ icon: Icon, className }: { icon: any; className?: string }) {
  return <Icon className={className} />;
}
