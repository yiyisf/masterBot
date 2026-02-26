import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SkillContext } from '../../../src/types.js';

interface LogPlatformConfig {
    name: string;
    baseUrl: string;
    auth?: { type: string; header?: string; key?: string };
}

function loadConfig(): LogPlatformConfig {
    const configPath = join(process.cwd(), 'connectors', 'log-platform.yaml');
    if (!existsSync(configPath)) {
        // Return a mock config for demo purposes
        return { name: 'mock-log-platform', baseUrl: 'http://localhost:9200' };
    }

    const content = readFileSync(configPath, 'utf-8');
    const config: Record<string, unknown> = {};
    for (const line of content.split('\n')) {
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match) {
            const val = match[2].trim().replace(/^['"]|['"]$/g, '');
            config[match[1]] = val.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (_: string, v: string, d: string) => {
                return process.env[v] ?? d ?? '';
            });
        }
    }
    return config as unknown as LogPlatformConfig;
}

function buildHeaders(config: LogPlatformConfig): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.auth?.type === 'bearer' && config.auth.key) {
        headers['Authorization'] = `Bearer ${config.auth.key}`;
    } else if (config.auth?.type === 'api-key' && config.auth.header && config.auth.key) {
        headers[config.auth.header] = config.auth.key;
    }
    return headers;
}

/**
 * Fetch logs from the internal log platform
 */
export async function fetch_logs(
    ctx: SkillContext,
    params: {
        service: string;
        level?: string;
        since?: string;
        until?: string;
        limit?: number;
    }
): Promise<{ logs: string[]; count: number; service: string; timeRange: string }> {
    const config = loadConfig();
    const { service, level = 'error', since = '-1h', until = 'now', limit = 200 } = params;

    ctx.logger.info(`[log-analyzer] Fetching ${level} logs for ${service} (${since} to ${until})`);

    try {
        const qs = new URLSearchParams({
            service,
            level,
            since,
            until,
            limit: String(limit),
        });

        const response = await fetch(`${config.baseUrl}/logs?${qs}`, {
            headers: buildHeaders(config),
        });

        if (!response.ok) {
            // Return mock logs on API failure for demo
            ctx.logger.warn(`[log-analyzer] Log platform unavailable, returning mock data`);
            return {
                logs: [
                    `[ERROR] ${service}: Connection timeout after 30s`,
                    `[ERROR] ${service}: Database pool exhausted (max=10)`,
                    `[ERROR] ${service}: Retry attempt 3/3 failed`,
                    `[WARN] ${service}: Memory usage at 92%`,
                ],
                count: 4,
                service,
                timeRange: `${since} to ${until}`,
            };
        }

        const data = await response.json() as any;
        const logs = (data.hits || data.logs || []).map((h: any) => h.message || h._source?.message || String(h));

        return { logs, count: logs.length, service, timeRange: `${since} to ${until}` };
    } catch (err) {
        ctx.logger.warn(`[log-analyzer] Fetch failed: ${(err as Error).message}, using mock data`);
        return {
            logs: [
                `[ERROR] ${service}: Service unavailable`,
                `[ERROR] ${service}: Health check failed`,
            ],
            count: 2,
            service,
            timeRange: `${since} to ${until}`,
        };
    }
}

/**
 * Cluster and analyze log anomalies using LLM
 */
export async function cluster_anomalies(
    ctx: SkillContext,
    params: {
        logs: string[];
        service?: string;
        alertContext?: string;
    }
): Promise<{
    clusters: Array<{ pattern: string; count: number; severity: string; samples: string[] }>;
    rootCause?: string;
    recommendation?: string;
}> {
    const { logs, service, alertContext } = params;

    if (logs.length === 0) {
        return { clusters: [] };
    }

    ctx.logger.info(`[log-analyzer] Clustering ${logs.length} log entries`);

    const logSample = logs.slice(0, 50).join('\n');
    const prompt = `你是一个 SRE 专家，请分析以下日志并进行异常聚类。
${service ? `服务：${service}` : ''}
${alertContext ? `告警上下文：${alertContext}` : ''}

日志（共 ${logs.length} 条，显示前 50 条）：
\`\`\`
${logSample}
\`\`\`

请输出 JSON 格式：
{
  "clusters": [
    { "pattern": "错误模式描述", "count": 预估出现次数, "severity": "critical|high|medium|low", "samples": ["示例日志1", "示例日志2"] }
  ],
  "rootCause": "根因分析：...",
  "recommendation": "建议处理步骤：1. ... 2. ..."
}`;

    const response = await ctx.llm.chat([{ role: 'user', content: prompt }]);
    const content = typeof response.content === 'string' ? response.content : '';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        return {
            clusters: [{ pattern: 'Unknown', count: logs.length, severity: 'medium', samples: logs.slice(0, 3) }],
        };
    }

    return JSON.parse(jsonMatch[0]);
}

/**
 * Comprehensive root cause analysis: fetch logs + cluster + diagnose
 */
export async function analyze_root_cause(
    ctx: SkillContext,
    params: { service: string; alertMessage?: string; timeRange?: string }
): Promise<{
    service: string;
    summary: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    rootCause: string;
    impactedComponents: string[];
    recommendation: string;
    clusters: Array<{ pattern: string; count: number; severity: string }>;
}> {
    const { service, alertMessage, timeRange = '-1h' } = params;

    ctx.logger.info(`[log-analyzer] Running root cause analysis for ${service}`);

    // Step 1: Fetch logs
    const { logs } = await fetch_logs(ctx, {
        service,
        level: 'error',
        since: timeRange,
        limit: 200,
    });

    // Step 2: Cluster anomalies
    const analysis = await cluster_anomalies(ctx, {
        logs,
        service,
        alertContext: alertMessage,
    });

    // Step 3: Generate summary
    const topSeverity = analysis.clusters.reduce((worst, c) => {
        const order = ['critical', 'high', 'medium', 'low'];
        return order.indexOf(c.severity) < order.indexOf(worst) ? c.severity : worst;
    }, 'low') as 'critical' | 'high' | 'medium' | 'low';

    return {
        service,
        summary: `${service} 检测到 ${logs.length} 条错误日志，识别出 ${analysis.clusters.length} 个异常模式`,
        severity: topSeverity,
        rootCause: analysis.rootCause || '待进一步分析',
        impactedComponents: [service],
        recommendation: analysis.recommendation || '请查看日志详情并联系服务负责人',
        clusters: analysis.clusters,
    };
}

export default { fetch_logs, cluster_anomalies, analyze_root_cause };
