"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
    LayoutDashboard,
    CheckSquare,
    Shield,
    ClipboardList,
    BarChart2,
    LogOut,
    ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ADMIN_KEY_STORAGE = "cmaster_admin_key";

const NAV_ITEMS = [
    { href: "/admin", label: "概览", icon: LayoutDashboard },
    { href: "/admin/skills/review", label: "技能审批", icon: CheckSquare },
    { href: "/admin/rbac", label: "RBAC 配置", icon: Shield },
    { href: "/admin/audit", label: "审计查询", icon: ClipboardList },
    { href: "/admin/cost", label: "成本看板", icon: BarChart2 },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [adminKey, setAdminKey] = useState<string | null>(null);
    const [inputKey, setInputKey] = useState("");
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        const stored = localStorage.getItem(ADMIN_KEY_STORAGE);
        if (stored) setAdminKey(stored);
        setChecking(false);
    }, []);

    const handleLogin = async () => {
        const res = await fetch("/api/admin/stats", {
            headers: { "X-Admin-Key": inputKey },
        });
        if (res.ok) {
            localStorage.setItem(ADMIN_KEY_STORAGE, inputKey);
            setAdminKey(inputKey);
        } else {
            alert("Admin Key 无效，请重试");
        }
    };

    const handleLogout = () => {
        localStorage.removeItem(ADMIN_KEY_STORAGE);
        setAdminKey(null);
    };

    if (checking) return null;

    if (!adminKey) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-muted/20">
                <div className="w-80 rounded-lg border bg-card p-6 shadow-sm space-y-4">
                    <h1 className="text-lg font-semibold">Admin Console</h1>
                    <p className="text-sm text-muted-foreground">请输入 Admin API Key 访问管理后台</p>
                    <Input
                        type="password"
                        placeholder="X-Admin-Key"
                        value={inputKey}
                        onChange={e => setInputKey(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleLogin()}
                    />
                    <Button className="w-full" onClick={handleLogin}>登录</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen">
            {/* Sidebar */}
            <aside className="w-52 shrink-0 border-r bg-card flex flex-col">
                <div className="p-4 border-b">
                    <span className="font-semibold text-sm">🛡 Admin Console</span>
                </div>
                <nav className="flex-1 p-2 space-y-0.5">
                    {NAV_ITEMS.map(item => {
                        const active = pathname === item.href;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                                    active
                                        ? "bg-primary text-primary-foreground"
                                        : "hover:bg-muted text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                <item.icon className="h-4 w-4" />
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>
                <div className="p-2 border-t">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start gap-2 text-muted-foreground"
                        onClick={handleLogout}
                    >
                        <LogOut className="h-4 w-4" />
                        退出
                    </Button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 overflow-auto">
                {/* Breadcrumb */}
                <div className="flex items-center gap-1 px-6 py-3 border-b text-sm text-muted-foreground">
                    <Link href="/admin" className="hover:text-foreground">Admin</Link>
                    {pathname !== "/admin" && (
                        <>
                            <ChevronRight className="h-3 w-3" />
                            <span className="text-foreground">
                                {NAV_ITEMS.find(n => n.href === pathname)?.label ?? "..."}
                            </span>
                        </>
                    )}
                </div>
                <div className="p-6">{children}</div>
            </main>
        </div>
    );
}

/** Hook: 获取存储的 admin key 用于 API 调用 */
export function useAdminKey(): string {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(ADMIN_KEY_STORAGE) ?? "";
}
