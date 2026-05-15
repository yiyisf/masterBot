/**
 * Phase 7: HitlCardRenderer — HitL 审批卡片统一管理
 *
 * 职责：
 *  - 向目标渠道发送审批卡片
 *  - 管理超时定时器（默认 5 分钟，超时自动 reject）
 *  - 解析卡片 callback body 为 CardActionPayload
 */

import type { IChannel, ChannelTarget, ApprovalRequest, CardActionPayload, ApprovalDecision } from './types.js';
import type { Logger } from '../types.js';
import { FeishuChannel } from './feishu.js';
import { DingTalkChannel } from './dingtalk.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟

interface PendingCard {
    interruptId: string;
    sessionId: string;
    channelName: string;
    timer: NodeJS.Timeout;
    onTimeout: () => void;
}

export class HitlCardRenderer {
    private pending = new Map<string, PendingCard>();
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * 向指定渠道发送审批卡片，并注册超时定时器。
     * @param channel 目标渠道实例
     * @param target  目标用户/会话
     * @param req     审批请求
     * @param onTimeout 超时回调（一般是 resolveInterrupt(false)）
     */
    async send(
        channel: IChannel,
        target: ChannelTarget,
        req: ApprovalRequest,
        onTimeout: () => void,
    ): Promise<void> {
        await channel.sendApprovalCard(target, req);

        const timeoutMs = (req.timeoutSeconds ?? DEFAULT_TIMEOUT_MS / 1000) * 1000;
        const timer = setTimeout(() => {
            this.logger.warn(`[hitl] timeout interruptId=${req.interruptId} sessionId=${req.sessionId}`);
            this.pending.delete(req.interruptId);
            onTimeout();
        }, timeoutMs);

        this.clear(req.interruptId); // 防止重复调用导致旧定时器泄漏
        this.pending.set(req.interruptId, {
            interruptId: req.interruptId,
            sessionId: req.sessionId,
            channelName: channel.name,
            timer,
            onTimeout,
        });

        this.logger.info(`[hitl] card sent interruptId=${req.interruptId} timeout=${timeoutMs}ms`);
    }

    /** 卡片已被用户点击，清除定时器 */
    clear(interruptId: string): void {
        const p = this.pending.get(interruptId);
        if (p) {
            clearTimeout(p.timer);
            this.pending.delete(interruptId);
        }
    }

    /**
     * 解析卡片 callback body 为标准 CardActionPayload。
     * 兼容飞书（body.action.value）和钉钉（querystring 已解析为 body）两种格式。
     */
    static parseCardAction(channelName: string, body: unknown): CardActionPayload | null {
        const b = body as any;

        // 飞书格式：body.action.value
        const feishuValue = b?.action?.value;
        if (feishuValue?.interrupt_id) {
            return {
                channelName,
                interruptId: feishuValue.interrupt_id,
                sessionId: feishuValue.session_id ?? '',
                decision: (feishuValue.action as ApprovalDecision) ?? 'reject',
                operatorUserId: FeishuChannel.extractOperatorUserId(body),
            };
        }

        // 钉钉格式：querystring 参数
        if (b?.interrupt_id) {
            return {
                channelName,
                interruptId: b.interrupt_id,
                sessionId: b.session_id ?? '',
                decision: (b.action as ApprovalDecision) ?? 'reject',
                operatorUserId: DingTalkChannel.extractOperatorUserId(body),
            };
        }

        return null;
    }

    get pendingCount(): number {
        return this.pending.size;
    }

    /** 停止所有定时器（graceful shutdown） */
    destroy(): void {
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
        }
        this.pending.clear();
    }
}
