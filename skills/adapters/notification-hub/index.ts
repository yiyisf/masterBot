/**
 * INotificationHub adapter — unified internal notification system.
 * Configure via connectors/notification-hub.yaml
 * Falls back to logging when no config is found (for testing/dev).
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SkillContext } from '../../../src/types.js';

interface NotifyConfig {
    name: string;
    baseUrl: string;
    auth?: { type: string; header?: string; key?: string };
    defaultChannel?: string;
}

const TEMPLATES: Record<string, (vars: Record<string, string>) => string> = {
    incident_triggered: (v) => `🚨 **[${v.severity || 'P2'} 告警]** ${v.service || '未知服务'}\n\n**告警内容：** ${v.message || ''}\n\n**影响范围：** ${v.impact || '待评估'}\n\n**根因：** ${v.rootCause || '正在分析...'}`,
    incident_resolved: (v) => `✅ **[已恢复]** ${v.service || '未知服务'}\n\n**处置耗时：** ${v.duration || '未知'}\n\n**根因：** ${v.rootCause || ''}`,
    daily_report: (v) => `📊 **每日运维日报** ${v.date || ''}\n\n${v.content || ''}`,
};

function loadConfig(): NotifyConfig | null {
    const configPath = join(process.cwd(), 'connectors', 'notification-hub.yaml');
    if (!existsSync(configPath)) return null;

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
    return config as unknown as NotifyConfig;
}

function buildMessage(params: { message: string; title?: string; level?: string; template?: string; templateVars?: Record<string, string> }): string {
    if (params.template && TEMPLATES[params.template]) {
        return TEMPLATES[params.template](params.templateVars || {});
    }

    const levelEmoji: Record<string, string> = { info: 'ℹ️', warn: '⚠️', error: '❌', critical: '🆘' };
    const emoji = levelEmoji[params.level || 'info'] || 'ℹ️';
    return params.title
        ? `${emoji} **${params.title}**\n\n${params.message}`
        : `${emoji} ${params.message}`;
}

/**
 * Send a notification to a channel or user
 */
export async function send(
    ctx: SkillContext,
    params: {
        to: string;
        message: string;
        title?: string;
        level?: string;
        template?: string;
        templateVars?: Record<string, string>;
    }
): Promise<{ success: boolean; messageId?: string; channel: string }> {
    const config = loadConfig();
    const formattedMessage = buildMessage(params);

    ctx.logger.info(`[notification-hub] Sending to ${params.to}: ${formattedMessage.substring(0, 100)}`);

    if (!config) {
        // No config: log to console (dev/test mode)
        ctx.logger.info(`[notification-hub] [DEV MODE] Message to ${params.to}:\n${formattedMessage}`);
        return { success: true, messageId: `dev-${Date.now()}`, channel: params.to };
    }

    try {
        const response = await fetch(`${config.baseUrl}/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.auth?.type === 'bearer' && config.auth.key ? { 'Authorization': `Bearer ${config.auth.key}` } : {}),
            },
            body: JSON.stringify({
                to: params.to,
                message: formattedMessage,
                level: params.level || 'info',
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json() as any;
        return { success: true, messageId: data.id || data.messageId, channel: params.to };
    } catch (err) {
        ctx.logger.error(`[notification-hub] Send failed: ${(err as Error).message}`);
        return { success: false, channel: params.to };
    }
}

/**
 * Create a temporary group (e.g., incident response channel)
 */
export async function create_group(
    ctx: SkillContext,
    params: { name: string; members: string[]; description?: string }
): Promise<{ success: boolean; groupId?: string; name: string }> {
    const config = loadConfig();

    ctx.logger.info(`[notification-hub] Creating group "${params.name}" with ${params.members.length} members`);

    if (!config) {
        ctx.logger.info(`[notification-hub] [DEV MODE] Would create group: ${params.name}`);
        return { success: true, groupId: `dev-group-${Date.now()}`, name: params.name };
    }

    try {
        const response = await fetch(`${config.baseUrl}/groups`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.auth?.type === 'bearer' && config.auth.key ? { 'Authorization': `Bearer ${config.auth.key}` } : {}),
            },
            body: JSON.stringify(params),
        });

        const data = await response.json() as any;
        return { success: response.ok, groupId: data.id || data.groupId, name: params.name };
    } catch (err) {
        ctx.logger.error(`[notification-hub] Create group failed: ${(err as Error).message}`);
        return { success: false, name: params.name };
    }
}

/**
 * Broadcast to multiple targets
 */
export async function broadcast(
    ctx: SkillContext,
    params: { targets: string[]; message: string; level?: string }
): Promise<{ results: Array<{ channel: string; success: boolean }> }> {
    ctx.logger.info(`[notification-hub] Broadcasting to ${params.targets.length} targets`);

    const results = await Promise.all(
        params.targets.map(target =>
            send(ctx, { to: target, message: params.message, level: params.level })
                .then(r => ({ channel: target, success: r.success }))
                .catch(() => ({ channel: target, success: false }))
        )
    );

    return { results };
}

export default { send, create_group, broadcast };
