"use client";

// PROTOTYPE — 原型评审用浮动切换条，生产构建不渲染；评审结束随原型一起删除
import { useEffect } from "react";

export function PrototypeSwitcher({ variants, current, onChange, label }: {
    variants: string[];
    current: string;
    onChange: (v: string) => void;
    label?: string;
}) {
    const idx = Math.max(0, variants.indexOf(current));
    const go = (delta: number) => onChange(variants[(idx + delta + variants.length) % variants.length]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
            if (e.key === "ArrowLeft") go(-1);
            if (e.key === "ArrowRight") go(1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    if (process.env.NODE_ENV === "production") return null;
    return (
        <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
            <button aria-label="上一个变体" onClick={() => go(-1)} className="px-1 hover:opacity-70">←</button>
            <span className="font-mono font-semibold">{current}</span>
            {label && <span className="opacity-70">{label}</span>}
            <button aria-label="下一个变体" onClick={() => go(1)} className="px-1 hover:opacity-70">→</button>
        </div>
    );
}
