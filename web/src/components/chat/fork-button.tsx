"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { GitFork, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ForkButtonProps {
    sessionId: string;
}

export function ForkButton({ sessionId }: ForkButtonProps) {
    const router = useRouter();
    const [forking, setForking] = useState(false);

    const handleFork = async () => {
        setForking(true);
        try {
            const res = await fetch(`/api/sessions/${sessionId}/fork`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error ?? "Fork 失败");
            }
            const { sessionId: newId } = await res.json();
            toast.success("已创建对话分支，正在跳转...");
            router.push(`/chat?sessionId=${newId}`);
        } catch (err: any) {
            toast.error(`Fork 失败：${err.message}`);
        } finally {
            setForking(false);
        }
    };

    return (
        <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={handleFork}
            disabled={forking}
            title="创建对话分支（Fork）"
        >
            {forking
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <GitFork className="h-4 w-4" />}
            <span className="text-xs hidden sm:inline">分支</span>
        </Button>
    );
}
