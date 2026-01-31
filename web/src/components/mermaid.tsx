"use client";

import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

interface MermaidProps {
    code: string;
}

// Initialize mermaid with enterprise-friendly settings
mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "loose",
    fontFamily: "Inter, system-ui, sans-serif",
    themeVariables: {
        primaryColor: "#3b82f6",
        primaryTextColor: "#fff",
        primaryBorderColor: "#3b82f6",
        lineColor: "#60a5fa",
        secondaryColor: "#1e293b",
        tertiaryColor: "#0f172a",
    },
});

export const Mermaid: React.FC<MermaidProps> = ({ code }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [svg, setSvg] = useState<string>("");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const renderDiagram = async () => {
            if (!code) return;

            try {
                const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
                const { svg: renderedSvg } = await mermaid.render(id, code);
                setSvg(renderedSvg);
                setError(null);
            } catch (err) {
                console.error("Mermaid rendering failed:", err);
                setError("无法渲染图表，请检查 Mermaid 语法是否正确。");
            }
        };

        renderDiagram();
    }, [code]);

    if (error) {
        return (
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono">
                {error}
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="mermaid-container w-full overflow-x-auto bg-muted/30 rounded-xl p-4 border border-border/50 flex justify-center"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
};
