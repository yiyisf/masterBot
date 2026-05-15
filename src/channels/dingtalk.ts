/**
 * Phase 7: DingTalkChannel — 钉钉自建应用机器人
 *
 * 实现：
 *  - 签名验证：timestamp + '\n' + secret → HMAC-SHA256 Base64
 *  - 消息接收：回调事件格式（msgtype=text）
 *  - ActionCard 交互卡片（HitL 审批）
 *  - access_token 缓存（7200s 官方 TTL，缓存 1800s）
 *  - health()：调用 /gettoken 端点
 */

import crypto from 'crypto';
import type { IChannel, IncomingMessage, ChannelTarget, ChannelMessage, ApprovalRequest, StatusKind, RiskLevel } from './types.js';
import type { Logger } from '../types.js';

export interface DingTalkChannelConfig {
    /** 应用 AppKey */
    appKey: string;
    /** 应用 AppSecret */
    appSecret: string;
    /** 机器人 outgoing webhook 签名 token */
    signingSecret: string;
    /** 企业 CorpId（用于 API 鉴权） */
    corpId?: string;
}

const RISK_COLOR: Record<RiskLevel, string> = {
    low: '#36a64f',
    medium: '#f0ad4e',
    high: '#ff7f00',
    critical: '#d9534f',
};

export class DingTalkChannel implements IChannel {
    readonly name = 'dingtalk';

    private cfg: DingTalkChannelConfig;
    private logger: Logger;

    private tokenCache: { token: string; expiresAt: number } | null = null;

    constructor(cfg: DingTalkChannelConfig, logger: Logger) {
        this.cfg = cfg;
        this.logger = logger;
    }

    // ─── verifyRequest ────────────────────────────────────────────────────────

    verifyRequest(headers: Record<string, string>, rawBody: string): boolean {
        // 钉钉签名：HmacSHA256(timestamp + '\n' + token) → Base64
        const ts = headers['timestamp'];
        const sign = headers['sign'];

        if (!ts || !sign) return false;

        const content = ts + '\n' + this.cfg.signingSecret;
        const expected = crypto
            .createHmac('sha256', this.cfg.signingSecret)
            .update(content)
            .digest('base64');

        const decoded = decodeURIComponent(sign);
        try {
            return crypto.timingSafeEqual(Buffer.from(expected, 'base64'), Buffer.from(decoded, 'base64'));
        } catch {
            return false;
        }
    }

    // ─── parseInboundMessage ─────────────────────────────────────────────────

    parseInboundMessage(body: unknown): IncomingMessage | null {
        const b = body as any;

        // 只处理文本消息
        if (b?.msgtype !== 'text') return null;

        let text: string = (b?.text?.content ?? '').trim();
        // 去掉 @机器人 mention
        text = text.replace(/@\S+/g, '').trim();
        if (!text) return null;

        const userId: string = b?.senderStaffId ?? b?.senderId ?? '';
        const conversationId: string = b?.conversationId ?? b?.chatId ?? '';

        return {
            channelName: this.name,
            userId,
            conversationId,
            text,
            raw: b,
        };
    }

    // ─── send ─────────────────────────────────────────────────────────────────

    async send(target: ChannelTarget, message: ChannelMessage): Promise<void> {
        const token = await this.getToken();
        const chatId = (target.extra?.chatId as string) ?? target.conversationId;

        await this.post(
            `https://oapi.dingtalk.com/topapi/im/chat/scencegroup/message/send_v2?access_token=${token}`,
            {
                chat_id: chatId,
                msg: { msgtype: 'text', text: { content: message.text } },
            },
        );
    }

    // ─── sendApprovalCard ─────────────────────────────────────────────────────

    async sendApprovalCard(target: ChannelTarget, req: ApprovalRequest): Promise<void> {
        const token = await this.getToken();
        const chatId = (target.extra?.chatId as string) ?? target.conversationId;
        const color = RISK_COLOR[req.riskLevel];

        const baseUrl = req.cardActionUrl;
        const approveUrl = `${baseUrl}?action=approve&interrupt_id=${encodeURIComponent(req.interruptId)}&session_id=${encodeURIComponent(req.sessionId)}&channel=dingtalk`;
        const rejectUrl = `${baseUrl}?action=reject&interrupt_id=${encodeURIComponent(req.interruptId)}&session_id=${encodeURIComponent(req.sessionId)}&channel=dingtalk`;

        const btns: unknown[] = [
            { title: '✅ 确认执行', actionURL: approveUrl },
            { title: '❌ 拒绝', actionURL: rejectUrl },
        ];

        if (req.allowModify) {
            const modifyUrl = `${baseUrl}?action=modify&interrupt_id=${encodeURIComponent(req.interruptId)}&session_id=${encodeURIComponent(req.sessionId)}&channel=dingtalk`;
            btns.push({ title: '✏️ 带修改批准', actionURL: modifyUrl });
        }

        const card = {
            msgtype: 'action_card',
            action_card: {
                title: `⚠️ 高危操作确认 [${req.riskLevel.toUpperCase()}]`,
                markdown: `**工具**：\`${req.toolName}\`\n\n**风险**：${req.reason}\n\n<font color="${color}">▌ 风险等级：${req.riskLevel.toUpperCase()}</font>`,
                btn_orientation: '1',
                btns,
            },
        };

        await this.post(
            `https://oapi.dingtalk.com/topapi/im/chat/scencegroup/message/send_v2?access_token=${token}`,
            { chat_id: chatId, msg: card },
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

        const url = `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(this.cfg.appKey)}&appsecret=${encodeURIComponent(this.cfg.appSecret)}`;
        const res = await fetch(url);
        const data = await res.json() as any;

        if (data.errcode !== 0 || !data.access_token) {
            throw new Error(`[dingtalk] getToken failed: ${JSON.stringify(data)}`);
        }

        // 官方 7200s，保守缓存 1800s
        this.tokenCache = { token: data.access_token, expiresAt: Date.now() + 1800_000 };
        return this.tokenCache.token;
    }

    private async post(url: string, body: unknown): Promise<void> {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const msg = `[dingtalk] POST ${url} → ${res.status}: ${text.slice(0, 200)}`;
            this.logger.error(msg);
            throw new Error(msg);
        }
        const data = await res.json().catch(() => ({})) as any;
        if (data?.errcode && data.errcode !== 0) {
            const msg = `[dingtalk] API error: ${data.errmsg} (${data.errcode})`;
            this.logger.error(msg);
            throw new Error(msg);
        }
    }

    /** 从卡片 callback body（GET querystring 已解析为 body）提取 userId */
    static extractOperatorUserId(body: unknown): string {
        const b = body as any;
        return b?.staffId ?? b?.senderStaffId ?? b?.userId ?? 'unknown';
    }
}
