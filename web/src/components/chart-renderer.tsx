"use client";

import { useEffect, useRef } from "react";

interface ChartRendererProps {
    config: Record<string, unknown>;
    height?: number;
    className?: string;
}

/**
 * ECharts chart renderer — lazy-loads echarts from CDN
 * Parses AI-returned ECharts config and renders it inline.
 */
export function ChartRenderer({ config, height = 320, className }: ChartRendererProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<any>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Dynamic import of echarts (optional dep)
        import("echarts").then((echarts) => {
            if (!containerRef.current) return;

            // Dispose old chart before re-init
            if (chartRef.current) {
                chartRef.current.dispose();
            }

            const chart = echarts.init(containerRef.current, "dark");
            chartRef.current = chart;
            chart.setOption(config);

            const handleResize = () => chart.resize();
            window.addEventListener("resize", handleResize);
            return () => window.removeEventListener("resize", handleResize);
        }).catch(() => {
            // echarts not installed, show fallback
        });

        return () => {
            chartRef.current?.dispose();
        };
    }, [config]);

    return (
        <div
            ref={containerRef}
            style={{ height, width: "100%" }}
            className={className}
        />
    );
}

/**
 * Parse chart config from message content.
 * Supports two formats:
 * 1. JSON block: ```echarts\n{...}\n```
 * 2. chart: prefix: `chart:{"..."}` (legacy)
 */
export function parseChartConfig(content: string): {
    chartConfig: Record<string, unknown> | null;
    textContent: string;
} {
    // Try ```echarts ... ``` code block
    const echartsBlockMatch = content.match(/```echarts\s*\n([\s\S]*?)\n```/);
    if (echartsBlockMatch) {
        try {
            const chartConfig = JSON.parse(echartsBlockMatch[1]);
            const textContent = content.replace(echartsBlockMatch[0], "").trim();
            return { chartConfig, textContent };
        } catch {}
    }

    // Try chart: prefix
    if (content.startsWith("chart:")) {
        try {
            const chartConfig = JSON.parse(content.slice(6));
            return { chartConfig, textContent: "" };
        } catch {}
    }

    return { chartConfig: null, textContent: content };
}
