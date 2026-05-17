"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/layout/auth-layout";

const IS_DEV = process.env.NODE_ENV === "development";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const user = localStorage.getItem("cmaster_user");
    if (user) router.replace("/chat");
  }, [router]);

  const handleSso = () => {
    window.location.href = "/api/auth/sso/login";
  };

  const handleDevLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) { setError("请输入用户名"); return; }
    setLoading(true);
    const user = { id: `dev-${username}`, name: username, role: "user", tenant: "default" };
    localStorage.setItem("cmaster_user", JSON.stringify(user));
    setTimeout(() => router.replace("/chat"), 300);
  };

  return (
    <AuthLayout title="CMaster Bot">
      <div className="flex flex-col gap-5">
        <p className="text-center text-sm text-muted-foreground">企业 AI 工作助手</p>

        <Button className="w-full gap-2" size="lg" onClick={handleSso}>
          使用公司账号登录
        </Button>

        {IS_DEV && (
          <div className="space-y-3 border-t pt-4">
            <p className="text-center text-xs text-muted-foreground">开发模式快速登录</p>
            <form onSubmit={handleDevLogin} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  placeholder="输入任意用户名"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(""); }}
                  autoComplete="off"
                />
                {error && <p className="text-xs text-destructive">{error}</p>}
              </div>
              <Button type="submit" variant="outline" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "模拟登录"}
              </Button>
            </form>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
