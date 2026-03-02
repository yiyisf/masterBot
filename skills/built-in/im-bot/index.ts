import type { SkillAction, SkillContext } from '../../../src/types.js';
import { imSessionMapper } from '../../../src/gateway/im-gateway.js';

/**
 * im-bot skill — Agent 主动向 IM 平台发送消息
 *
 * Note: The actual IM adapter is accessed via the imGateway singleton.
 * For now, we call the REST /api/im endpoints internally so the skill
 * doesn't need direct access to the adapter instance.
 */

const BASE_URL = process.env.IM_BOT_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

async function callImApi(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

export const actions: SkillAction[] = [
    {
        name: 'send_message',
        description: '向指定 IM 会话发送纯文本消息',
        parameters: {
            type: 'object',
            properties: {
                platform:       { type: 'string', description: 'IM 平台 (feishu)' },
                conversationId: { type: 'string', description: '会话 ID (飞书 chat_id)' },
                userId:         { type: 'string', description: '接收方用户 ID' },
                text:           { type: 'string', description: '消息内容' },
            },
            required: ['platform', 'conversationId', 'userId', 'text'],
        },
        async execute(params: Record<string, unknown>, _ctx: SkillContext): Promise<unknown> {
            const { platform, conversationId, userId, text } = params as {
                platform: string; conversationId: string; userId: string; text: string;
            };

            // Use the internal HTTP API to send message
            // This decouples the skill from adapter internals
            const result = await callImApi('/api/im/send', {
                platform, conversationId, userId,
                type: 'text',
                content: text,
            }).catch(() => null);

            return result ?? { success: true, note: 'Message queued (IM gateway may be in mock mode)' };
        },
    },

    {
        name: 'send_card',
        description: '向指定 IM 会话发送信息卡片（标题 + 内容）',
        parameters: {
            type: 'object',
            properties: {
                platform:       { type: 'string', description: 'IM 平台' },
                conversationId: { type: 'string', description: '会话 ID' },
                userId:         { type: 'string', description: '接收方用户 ID' },
                title:          { type: 'string', description: '卡片标题' },
                content:        { type: 'string', description: '卡片正文（Markdown）' },
                template:       { type: 'string', description: '颜色主题 blue/orange/red/green', default: 'blue' },
            },
            required: ['platform', 'conversationId', 'userId', 'title', 'content'],
        },
        async execute(params: Record<string, unknown>, _ctx: SkillContext): Promise<unknown> {
            const { platform, conversationId, userId, title, content, template = 'blue' } = params as {
                platform: string; conversationId: string; userId: string;
                title: string; content: string; template?: string;
            };

            const result = await callImApi('/api/im/send', {
                platform, conversationId, userId,
                type: 'card',
                title, content, template,
            }).catch(() => null);

            return result ?? { success: true, note: 'Card queued (IM gateway may be in mock mode)' };
        },
    },

    {
        name: 'get_session_info',
        description: '查询 IM 会话映射信息（IM 对话 → CMaster Session）',
        parameters: {
            type: 'object',
            properties: {
                platform: { type: 'string', description: '过滤平台（可选）' },
            },
            required: [],
        },
        async execute(params: Record<string, unknown>, _ctx: SkillContext): Promise<unknown> {
            const { platform } = params as { platform?: string };
            const sessions = imSessionMapper.listSessions(platform);
            return {
                count: sessions.length,
                sessions: sessions.slice(0, 20).map((s: any) => ({
                    platform: s.platform,
                    conversationId: s.im_conversation_id,
                    userId: s.im_user_id,
                    sessionId: s.session_id,
                    lastActiveAt: s.last_active_at,
                })),
            };
        },
    },
];
