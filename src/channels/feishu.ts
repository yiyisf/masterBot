/**
 * Phase 7: FeishuChannel — 飞书企业版 OpenAPI v3 完整实现
 *
 * 改进项（相对 im-gateway.ts FeishuAdapter）：
 *  - access_token 30 分钟缓存，避免每次请求都换 token
 *  - riskLevel → 卡片颜色（green/yellow/orange/red）
 *  - allowModify → 第三态"带修改批准"按钮
 *  - AES 消息加密解密支持（encryptKey 非空时自动解密）
 *  - health() 实现（调用 /auth/v3/app_ticket）
 */

import crypto from 'crypto';
import type { IChannel, IncomingMessage, ChannelTarget, ChannelMessage, ApprovalRequest, StatusKind, RiskLevel } from './types.js';
import type { Logger } from '../types.js';

export interface FeishuChannelConfig {
    appId: string;
    appSecret: string;
    verificationToken: string;
    /** AES 解密 key（16/24/32 字节）；留空则不做消息加密 */
    encryptKey?: string;
}

const RISK_COLOR: Record<RiskLevel, string> = {
    low: 'green',
    medium: 'yellow',
    high: 'orange',
    critical: 'red',
};

export class FeishuChannel implements IChannel {
    readonly name = 'feishu';

    private cfg: FeishuChannelConfig;
    private logger: Logger;

    /** tenant_access_token 缓存 */
    private tokenCache: { token: string; expiresAt: number } | null = null;

    constructor(cfg: FeishuChannelConfig, logger: Logger) {
        this.cfg = cfg;
        this.logger = logger;
    }

    // ─── verifyRequest ────────────────────────────────────────────────────────

    verifyRequest(headers: Record<string, string>, rawBody: string): boolean {
        const sig = headers['x-lark-signature'] ?? headers['X-Lark-Signature'];
        const ts = headers['x-lark-request-timestamp'] ?? headers['X-Lark-Request-Timestamp'];
        const nonce = headers['x-lark-request-nonce'] ?? headers['X-Lark-Request-Nonce'];

        if (!sig || !ts || !nonce) return false;

        const key = this.cfg.encryptKey || this.cfg.verificationToken;
        const expected = crypto
            .createHmac('sha256', key)
            .update(ts + nonce + key + rawBody)
            .digest('hex');

        try {
            return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
        } catch {
            return false;
        }
    }

    // ─── parseInboundMessage ─────────────────────────────────────────────────

    parseInboundMessage(body: unknown): IncomingMessage | null {
        let b = body as any;

        // AES 加密消息解密
        if (b?.encrypt && this.cfg.encryptKey) {
            try {
                b = this.decryptMessage(b.encrypt);
            } catch (err) {
                this.logger.warn(`[feishu] AES decrypt failed: ${(err as Error).message}`);
                return null;
            }
        }

        // URL 验证 challenge
        if (b?.challenge) return null;

        const event = b?.event;
        if (b?.header?.event_type !== 'im.message.receive_v1' || !event) return null;

        const msgType = event.message?.message_type;
        if (msgType !== 'text') return null;

        let text: string;
        try {
            text = (JSON.parse(event.message.content).text ?? '').trim();
        } catch {
            return null;
        }

        text = text.replace(/@\S+/g, '').trim();
        if (!text) return null;

        const userId = event.sender?.sender_id?.open_id ?? event.sender?.sender_id?.user_id ?? '';
        const chatId = event.message?.chat_id ?? '';
        const messageId = event.message?.message_id ?? '';

        return {
            channelName: this.name,
            userId,
            conversationId: chatId,
            text,
            raw: b,
            attachments: [],
        };
    }

    // ─── send ─────────────────────────────────────────────────────────────────

    async send(target: ChannelTarget, message: ChannelMessage): Promise<void> {
        const token = await this.getToken();
        const chatId = (target.extra?.chatId as string) ?? target.conversationId;

        await this.post(
            'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
            token,
            {
                receive_id: chatId,
                msg_type: 'text',
                content: JSON.stringify({ text: message.text }),
            },
        );
    }

    // ─── sendApprovalCard ─────────────────────────────────────────────────────

    async sendApprovalCard(target: ChannelTarget, req: ApprovalRequest): Promise<void> {
        const token = await this.getToken();
        const chatId = (target.extra?.chatId as string) ?? target.conversationId;
        const color = RISK_COLOR[req.riskLevel];

        const actions: unknown[] = [
            {
                tag: 'button',
                text: { tag: 'plain_text', content: '✅ 确认执行' },
                type: 'primary',
                value: {
                    action: 'approve',
                    interrupt_id: req.interruptId,
                    session_id: req.sessionId,
                    channel: this.name,
                },
                url: req.cardActionUrl,
            },
            {
                tag: 'button',
                text: { tag: 'plain_text', content: '❌ 拒绝' },
                type: 'danger',
                value: {
                    action: 'reject',
                    interrupt_id: req.interruptId,
                    session_id: req.sessionId,
                    channel: this.name,
                },
                url: req.cardActionUrl,
            },
        ];

        if (req.allowModify) {
            actions.push({
                tag: 'button',
                text: { tag: 'plain_text', content: '✏️ 带修改批准' },
                type: 'default',
                value: {
                    action: 'modify',
                    interrupt_id: req.interruptId,
                    session_id: req.sessionId,
                    channel: this.name,
                },
                url: req.cardActionUrl,
            });
        }

        const card = {
            msg_type: 'interactive',
            card: {
                header: {
                    title: { tag: 'plain_text', content: `⚠️ 高危操作确认 [${req.riskLevel.toUpperCase()}]` },
                    template: color,
                },
                elements: [
                    {
                        tag: 'div',
                        text: {
                            tag: 'lark_md',
                            content: `**工具**：\`${req.toolName}\`\n**风险**：${req.reason}`,
                        },
                    },
                    { tag: 'action', actions },
                ],
            },
        };

        await this.post(
            'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
            token,
            { receive_id: chatId, ...card },
        );
    }

    // ─── sendStatus ───────────────────────────────────────────────────────────

    async sendStatus(target: ChannelTarget, kind: StatusKind, detail?: string): Promise<void> {
        const labels: Record<StatusKind, string> = {
            processing: '⏳ 正在处理中...',
            done: '✅ 已完成',
            error: `❌ 出现错误${detail ? '：' + detail : ''}`,
        };
        await this.send(target, { text: labels[kind] });
    }

    // ─── health ───────────────────────────────────────────────────────────────

    async health(): Promise<{ ok: boolean; latencyMs?: number; details?: string }> {
        const t0 = Date.now();
        try {
            await this.getToken(true);
            return { ok: true, latencyMs: Date.now() - t0 };
        } catch (err) {
            return { ok: false, latencyMs: Date.now() - t0, details: (err as Error).message };
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private async getToken(forceRefresh = false): Promise<string> {
        if (!forceRefresh && this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
            return this.tokenCache.token;
        }

        const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: this.cfg.appId, app_secret: this.cfg.appSecret }),
        });

        const data = await res.json() as any;
        if (!data.tenant_access_token) {
            throw new Error(`[feishu] getToken failed: ${JSON.stringify(data)}`);
        }

        // 飞书 token 有效期 7200s，缓存 1800s（30 分钟）保守处理
        this.tokenCache = { token: data.tenant_access_token, expiresAt: Date.now() + 1800_000 };
        return this.tokenCache.token;
    }

    private async post(url: string, token: string, body: unknown): Promise<void> {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const msg = `[feishu] POST ${url} → ${res.status}: ${text.slice(0, 200)}`;
            this.logger.error(msg);
            throw new Error(msg);
        }
    }

    /** AES-256-CBC 解密飞书加密消息 */
    private decryptMessage(encrypted: string): unknown {
        if (!this.cfg.encryptKey) throw new Error('encryptKey not configured');

        // 飞书 AES key：SHA256(encryptKey) 取前 32 字节
        const key = crypto.createHash('sha256').update(this.cfg.encryptKey).digest().subarray(0, 32);
        const buf = Buffer.from(encrypted, 'base64');
        const iv = buf.subarray(0, 16);
        const ciphertext = buf.subarray(16);

        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
        return JSON.parse(decrypted);
    }

    /** 从卡片 callback body 提取 userId（兼容飞书 2.0 / 3.0 格式） */
    static extractOperatorUserId(body: unknown): string {
        const b = body as any;
        return b?.operator?.open_id ?? b?.open_id ?? b?.user_id ?? 'unknown';
    }
}
