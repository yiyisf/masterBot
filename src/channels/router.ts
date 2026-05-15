/**
 * Phase 7: ChannelRouter — 多渠道统一分发器
 *
 * 职责：
 *  - 注册/注销渠道（IChannel）
 *  - handleInbound：验签 → 解析 → 鉴权 → 会话映射 → 异步执行 Agent
 *  - handleCardAction：解析 HitL callback → resolveInterrupt
 *  - health：汇总所有渠道健康状态
 *
 * 与旧 ImGateway 的区别：
 *  - 支持多渠道同时注册，按 channelName 路由
 *  - HitL 由 HitlCardRenderer 统一管理（超时、解析）
 *  - 鉴权/会话映射复用 imUserRegistry / imSessionMapper
 */

import { nanoid } from 'nanoid';
import { auditRepository } from '../core/audit-repository.js';
import { resolveInterrupt, hasPendingInterrupt, getPendingInterruptMeta } from '../core/interrupt-coordinator.js';
import { imUserRegistry, imSessionMapper } from '../gateway/im-gateway.js';
import { HitlCardRenderer } from './hitl-card-renderer.js';
import type { IChannel, ChannelTarget, ApprovalRequest } from './types.js';
import type { Logger } from '../types.js';

export interface ChannelRouterOptions {
    logger: Logger;
    /** Agent 执行函数：返回最终答案字符串 */
    runAgent: (prompt: string, sessionId: string) => Promise<string>;
    /** 默认角色（新用户自动注册时使用）：'user' = 允许，'blocked' = 拒绝 */
    defaultRole?: string;
    /** HitL 审批卡片 callback base URL */
    cardActionBaseUrl?: string;
}

export class ChannelRouter {
    private channels = new Map<string, IChannel>();
    private hitl: HitlCardRenderer;
    private logger: Logger;
    private runAgent: ChannelRouterOptions['runAgent'];
    private defaultRole: string;
    private cardActionBaseUrl: string;

    constructor(opts: ChannelRouterOptions) {
        this.logger = opts.logger;
        this.runAgent = opts.runAgent;
        this.defaultRole = opts.defaultRole ?? 'user';
        this.cardActionBaseUrl = opts.cardActionBaseUrl ?? 'http://localhost:3000';
        this.hitl = new HitlCardRenderer(opts.logger);
    }

    // ─── Channel Registry ─────────────────────────────────────────────────────

    register(channel: IChannel): void {
        this.channels.set(channel.name, channel);
        this.logger.info(`[channel-router] registered channel: ${channel.name}`);
    }

    unregister(channelName: string): void {
        this.channels.delete(channelName);
    }

    getChannel(name: string): IChannel | undefined {
        return this.channels.get(name);
    }

    listChannels(): string[] {
        return [...this.channels.keys()];
    }

    // ─── Inbound ──────────────────────────────────────────────────────────────

    /**
     * 处理入站 IM 事件。
     * @returns HTTP 响应体（需由调用者作为 JSON response 返回）
     */
    async handleInbound(
        channelName: string,
        rawBody: string,
        headers: Record<string, string>,
    ): Promise<unknown> {
        const channel = this.channels.get(channelName);
        if (!channel) {
            return { error: `Unknown channel: ${channelName}`, code: 404 };
        }

        // 1. 签名验证
        if (!channel.verifyRequest(headers, rawBody)) {
            this.logger.warn(`[channel-router] signature failed channel=${channelName}`);
            return { error: 'Unauthorized', code: 401 };
        }

        let body: unknown;
        try { body = JSON.parse(rawBody); } catch { return { error: 'Invalid JSON', code: 400 }; }

        // 2. URL 验证 challenge（飞书）
        const b = body as any;
        if (b?.challenge) return { challenge: b.challenge };

        // 3. 解析消息
        const msg = channel.parseInboundMessage(body);
        if (!msg) return { ok: true };

        this.logger.info(`[channel-router] ${channelName}/${msg.userId}: "${msg.text.slice(0, 80)}"`);

        // 4. 鉴权
        let user = imUserRegistry.getUser(channelName, msg.userId);
        if (!user) {
            if (this.defaultRole === 'blocked') {
                const target = this.makeTarget(channel.name, msg.conversationId, msg.userId, msg.raw);
                await channel.send(target, { text: '您没有权限使用此机器人，请联系管理员。' });
                return { ok: true };
            }
            imUserRegistry.upsertUser({ platform: channelName, imUserId: msg.userId, role: this.defaultRole });
            user = imUserRegistry.getUser(channelName, msg.userId);
        }

        if (!user || !user.enabled || user.role === 'blocked') {
            const target = this.makeTarget(channel.name, msg.conversationId, msg.userId, msg.raw);
            await channel.send(target, { text: '您的账号已被禁用，请联系管理员。' });
            return { ok: true };
        }

        // 5. IM 会话 → CMaster Session 映射
        const sessionId = imSessionMapper.getOrCreate(channelName, msg.conversationId, msg.userId);

        // 6. 审计记录
        const execId = auditRepository.createExecution({
            type: 'agent',
            name: `IM[${channelName}]: ${msg.text.slice(0, 50)}`,
            sessionId,
            triggerSource: 'im',
            triggerRef: msg.userId,
            inputSummary: msg.text.slice(0, 500),
        });

        // 7. 立即返回 200，异步执行
        const target = this.makeTarget(channelName, msg.conversationId, msg.userId, msg.raw, sessionId);
        setImmediate(() => this.runAsync(channel, execId, msg.text, sessionId, target));

        return { ok: true };
    }

    // ─── Card Action ──────────────────────────────────────────────────────────

    /** 处理 HitL 审批卡片 callback */
    async handleCardAction(channelName: string, body: unknown): Promise<unknown> {
        const payload = HitlCardRenderer.parseCardAction(channelName, body);
        if (!payload) {
            return { toast: { type: 'error', content: '缺少必要参数' } };
        }

        this.hitl.clear(payload.interruptId);

        const meta = getPendingInterruptMeta(payload.sessionId);
        const approved = payload.decision === 'approve' || payload.decision === 'modify';

        const resolved = resolveInterrupt(payload.sessionId, approved, {
            interruptId: payload.interruptId,
            actionName: meta?.actionName,
            dangerReason: meta?.dangerReason,
            executionId: meta?.executionId,
            operator: payload.operatorUserId,
            operatorChannel: channelName,
        });

        if (!resolved) {
            return { toast: { type: 'warning', content: '该操作已超时或不存在' } };
        }

        this.logger.info(
            `[channel-router] HitL resolved: ${payload.sessionId} decision=${payload.decision} by ${payload.operatorUserId}`,
        );

        return {
            toast: {
                type: approved ? 'success' : 'info',
                content: approved ? '已确认执行' : '已拒绝操作',
            },
        };
    }

    // ─── Health ───────────────────────────────────────────────────────────────

    async health(): Promise<Record<string, { ok: boolean; latencyMs?: number; details?: string }>> {
        const results: Record<string, { ok: boolean; latencyMs?: number; details?: string }> = {};
        await Promise.all(
            [...this.channels.entries()].map(async ([name, ch]) => {
                results[name] = await ch.health().catch(err => ({ ok: false, details: err.message }));
            }),
        );
        return results;
    }

    destroy(): void {
        this.hitl.destroy();
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    private makeTarget(
        channelName: string,
        conversationId: string,
        userId: string,
        raw: unknown,
        sessionId?: string,
    ): ChannelTarget {
        const b = raw as any;
        return {
            channelName,
            conversationId,
            userId,
            extra: {
                chatId: b?.event?.message?.chat_id ?? b?.conversationId ?? conversationId,
                messageId: b?.event?.message?.message_id,
                sessionId,
            },
        };
    }

    private async runAsync(
        channel: IChannel,
        execId: string,
        text: string,
        sessionId: string,
        replyTarget: ChannelTarget,
    ): Promise<void> {
        const t0 = Date.now();
        await channel.sendStatus(replyTarget, 'processing').catch(() => undefined);

        // HitL 监听：500ms 轮询，检测到 pending interrupt 则发卡片
        let hitlSent = false;
        const hitlTimer = setInterval(() => {
            if (hasPendingInterrupt(sessionId) && !hitlSent) {
                hitlSent = true;
                const meta = getPendingInterruptMeta(sessionId);
                const req: ApprovalRequest = {
                    interruptId: meta?.interruptId ?? nanoid(),
                    toolName: meta?.actionName ?? '未知操作',
                    reason: meta?.dangerReason ?? '高危操作需要确认',
                    riskLevel: 'high',
                    sessionId,
                    cardActionUrl: `${this.cardActionBaseUrl}/api/channels/${channel.name}/card-action`,
                    timeoutSeconds: 300,
                };
                this.hitl.send(channel, replyTarget, req, () => {
                    resolveInterrupt(sessionId, false, {
                        interruptId: req.interruptId,
                        actionName: meta?.actionName,
                        dangerReason: meta?.dangerReason,
                        operator: 'system-timeout',
                        operatorChannel: channel.name,
                    });
                }).catch(err => {
                    this.logger.error(`[channel-router] sendApprovalCard failed: ${err.message}`);
                });
            }
        }, 500);

        try {
            const answer = await this.runAgent(text, sessionId);
            clearInterval(hitlTimer);
            await channel.send(replyTarget, { text: answer || '（无结果）' });
            auditRepository.updateExecution(execId, {
                status: 'success',
                outputSummary: answer?.slice(0, 500),
                durationMs: Date.now() - t0,
            });
        } catch (err: any) {
            clearInterval(hitlTimer);
            this.logger.error(`[channel-router] agent error: ${err.message}`);
            await channel.sendStatus(replyTarget, 'error', err.message?.slice(0, 100)).catch(() => undefined);
            auditRepository.updateExecution(execId, {
                status: 'failed',
                errorMessage: err.message,
                durationMs: Date.now() - t0,
            });
        }
    }
}
