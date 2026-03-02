/**
 * IM 双向集成网关
 *
 * 架构：
 *   IImAdapter（接口）← FeishuAdapter（飞书参考实现）
 *   ImGateway — 统一入站处理、IM 会话映射、HitL 交互卡片
 *
 * 对接内部 IM 时只需实现 IImAdapter 并替换 adapter 实例。
 */

import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { db } from '../core/database.js';
import { auditRepository } from '../core/audit-repository.js';
import { resolveInterrupt, hasPendingInterrupt, getPendingInterruptMeta } from '../core/interrupt-coordinator.js';
import type { Logger } from '../types.js';

// ─── Core Types ───────────────────────────────────────────────────────────────

export interface ImSendTarget {
    platform: string;
    conversationId: string;
    userId: string;
    /** Platform-specific reply context (e.g. message_id for quote-reply) */
    extra?: Record<string, unknown>;
}

export interface ImInboundMessage {
    platform: string;
    conversationId: string;
    userId: string;
    userName?: string;
    /** Cleaned text after stripping @Bot prefix */
    text: string;
    replyTarget: ImSendTarget;
}

// ─── IImAdapter Interface ─────────────────────────────────────────────────────

export interface IImAdapter {
    platform: string;
    /** Verify incoming request signature. Returns false → reject with 401. */
    verifyRequest(headers: Record<string, string>, rawBody: string): boolean;
    /** Parse platform event body into a normalized ImInboundMessage, or null to skip. */
    parseInboundMessage(body: unknown): ImInboundMessage | null;
    /** Send plain text message to a target. */
    sendMessage(target: ImSendTarget, text: string): Promise<void>;
    /** Send an interactive HitL approval card. */
    sendApprovalCard(target: ImSendTarget, opts: {
        interruptId: string;
        actionName: string;
        dangerReason: string;
        cardActionUrl: string;
    }): Promise<void>;
    /** Send a status update (processing / done / error). */
    sendStatusUpdate(target: ImSendTarget, status: 'processing' | 'done' | 'error', detail?: string): Promise<void>;
}

// ─── FeishuAdapter — 飞书协议参考实现 ────────────────────────────────────────

export interface FeishuConfig {
    appId: string;
    appSecret: string;
    verificationToken: string;
    encryptKey: string;
}

export class FeishuAdapter implements IImAdapter {
    readonly platform = 'feishu';
    private config: FeishuConfig;
    private logger: Logger;

    constructor(config: FeishuConfig, logger: Logger) {
        this.config = config;
        this.logger = logger;
    }

    verifyRequest(headers: Record<string, string>, rawBody: string): boolean {
        // Feishu uses X-Lark-Signature header
        // Signature = HMAC-SHA256(timestamp + nonce + encryptKey + rawBody)
        const signature = headers['x-lark-signature'] ?? headers['X-Lark-Signature'];
        const timestamp = headers['x-lark-request-timestamp'] ?? headers['X-Lark-Request-Timestamp'];
        const nonce = headers['x-lark-request-nonce'] ?? headers['X-Lark-Request-Nonce'];

        if (!signature || !timestamp || !nonce) return false;

        const content = timestamp + nonce + this.config.encryptKey + rawBody;
        const expected = crypto.createHmac('sha256', this.config.encryptKey)
            .update(content)
            .digest('hex');

        return expected === signature;
    }

    parseInboundMessage(body: unknown): ImInboundMessage | null {
        const b = body as any;

        // Handle URL verification challenge
        if (b?.challenge) {
            this.logger.info('[feishu] URL verification challenge received');
            return null;
        }

        // Handle im.message.receive_v1 event
        const event = b?.event;
        if (b?.header?.event_type !== 'im.message.receive_v1' || !event) return null;

        const msgType = event.message?.message_type;
        if (msgType !== 'text') return null;

        let text: string;
        try {
            const msgContent = JSON.parse(event.message.content);
            text = (msgContent.text ?? '').trim();
        } catch {
            return null;
        }

        // Strip @Bot mention
        text = text.replace(/@\S+/g, '').trim();
        if (!text) return null;

        const userId = event.sender?.sender_id?.open_id ?? event.sender?.sender_id?.user_id ?? '';
        const userName = event.sender?.sender_id?.name;
        const chatId = event.message?.chat_id ?? '';
        const messageId = event.message?.message_id ?? '';

        const replyTarget: ImSendTarget = {
            platform: 'feishu',
            conversationId: chatId,
            userId,
            extra: { chatId, messageId },
        };

        return { platform: 'feishu', conversationId: chatId, userId, userName, text, replyTarget };
    }

    async sendMessage(target: ImSendTarget, text: string): Promise<void> {
        const token = await this.getTenantAccessToken();
        const chatId = (target.extra?.chatId as string) ?? target.conversationId;

        await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                receive_id: chatId,
                msg_type: 'text',
                content: JSON.stringify({ text }),
            }),
        }).catch(err => {
            this.logger.error(`[feishu] sendMessage failed: ${err.message}`);
        });
    }

    async sendApprovalCard(target: ImSendTarget, opts: {
        interruptId: string;
        actionName: string;
        dangerReason: string;
        cardActionUrl: string;
    }): Promise<void> {
        const token = await this.getTenantAccessToken();
        const chatId = (target.extra?.chatId as string) ?? target.conversationId;

        const card = {
            msg_type: 'interactive',
            card: {
                header: {
                    title: { tag: 'plain_text', content: '⚠️ 高危操作确认' },
                    template: 'orange',
                },
                elements: [
                    {
                        tag: 'div',
                        text: {
                            tag: 'lark_md',
                            content: `**操作**：\`${opts.actionName}\`\n**风险**：${opts.dangerReason}\n\n请确认是否授权执行此操作？`,
                        },
                    },
                    {
                        tag: 'action',
                        actions: [
                            {
                                tag: 'button',
                                text: { tag: 'plain_text', content: '✅ 确认执行' },
                                type: 'primary',
                                value: { action: 'approve', interrupt_id: opts.interruptId, session_id: target.extra?.sessionId },
                                url: opts.cardActionUrl,
                            },
                            {
                                tag: 'button',
                                text: { tag: 'plain_text', content: '❌ 拒绝' },
                                type: 'danger',
                                value: { action: 'reject', interrupt_id: opts.interruptId, session_id: target.extra?.sessionId },
                                url: opts.cardActionUrl,
                            },
                        ],
                    },
                ],
            },
        };

        await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ receive_id: chatId, ...card }),
        }).catch(err => {
            this.logger.error(`[feishu] sendApprovalCard failed: ${err.message}`);
        });
    }

    async sendStatusUpdate(target: ImSendTarget, status: 'processing' | 'done' | 'error', detail?: string): Promise<void> {
        const labels: Record<string, string> = {
            processing: '⏳ 正在处理中...',
            done: '✅ 已完成',
            error: `❌ 出现错误${detail ? '：' + detail : ''}`,
        };
        await this.sendMessage(target, labels[status] ?? status);
    }

    private async getTenantAccessToken(): Promise<string> {
        const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
        });
        const data = await res.json() as any;
        return data.tenant_access_token ?? '';
    }
}

// ─── ImUserRegistry ───────────────────────────────────────────────────────────

export interface ImUser {
    id: string;
    platform: string;
    imUserId: string;
    name?: string;
    role: 'admin' | 'operator' | 'user' | 'blocked';
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}

function rowToImUser(row: any): ImUser {
    return {
        id: row.id,
        platform: row.platform,
        imUserId: row.im_user_id,
        name: row.name ?? undefined,
        role: row.role,
        enabled: row.enabled === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export class ImUserRegistry {
    getUser(platform: string, imUserId: string): ImUser | null {
        const row = db.prepare('SELECT * FROM im_users WHERE platform = ? AND im_user_id = ?').get(platform, imUserId) as any;
        return row ? rowToImUser(row) : null;
    }

    listUsers(platform?: string): ImUser[] {
        const rows = platform
            ? db.prepare('SELECT * FROM im_users WHERE platform = ? ORDER BY created_at DESC').all(platform) as any[]
            : db.prepare('SELECT * FROM im_users ORDER BY created_at DESC').all() as any[];
        return rows.map(rowToImUser);
    }

    upsertUser(d: { platform: string; imUserId: string; name?: string; role?: string; enabled?: boolean }): string {
        const existing = this.getUser(d.platform, d.imUserId);
        const now = new Date().toISOString();
        if (existing) {
            db.prepare('UPDATE im_users SET name = ?, role = ?, enabled = ?, updated_at = ? WHERE id = ?')
                .run(d.name ?? existing.name ?? null, d.role ?? existing.role, d.enabled !== undefined ? (d.enabled ? 1 : 0) : (existing.enabled ? 1 : 0), now, existing.id);
            return existing.id;
        }
        const id = nanoid();
        db.prepare('INSERT INTO im_users (id, platform, im_user_id, name, role, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, d.platform, d.imUserId, d.name ?? null, d.role ?? 'user', d.enabled !== false ? 1 : 0, now, now);
        return id;
    }

    deleteUser(id: string): void {
        db.prepare('DELETE FROM im_users WHERE id = ?').run(id);
    }
}

export const imUserRegistry = new ImUserRegistry();

// ─── ImSessionMapper ──────────────────────────────────────────────────────────

export class ImSessionMapper {
    getOrCreate(platform: string, conversationId: string, userId: string): string {
        const row = db.prepare(
            'SELECT session_id FROM im_sessions WHERE platform = ? AND im_conversation_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1'
        ).get(platform, conversationId) as any;

        if (row) {
            db.prepare('UPDATE im_sessions SET last_active_at = ? WHERE platform = ? AND im_conversation_id = ? AND is_active = 1')
                .run(new Date().toISOString(), platform, conversationId);
            return row.session_id;
        }

        const sessionId = nanoid();
        const now = new Date().toISOString();
        db.prepare('INSERT INTO im_sessions (id, platform, im_conversation_id, im_user_id, session_id, is_active, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
            .run(nanoid(), platform, conversationId, userId, sessionId, now, now);
        return sessionId;
    }

    listSessions(platform?: string): any[] {
        const rows = platform
            ? db.prepare('SELECT * FROM im_sessions WHERE platform = ? ORDER BY last_active_at DESC').all(platform) as any[]
            : db.prepare('SELECT * FROM im_sessions ORDER BY last_active_at DESC').all() as any[];
        return rows;
    }
}

export const imSessionMapper = new ImSessionMapper();

// ─── ImGateway ────────────────────────────────────────────────────────────────

export interface ImGatewayOptions {
    adapter: IImAdapter;
    logger: Logger;
    /** Called to run agent with the user message. Returns the answer string. */
    runAgent: (prompt: string, sessionId: string) => Promise<string>;
    /** Default role for new (unlisted) users: 'user' = allow, 'blocked' = deny */
    defaultRole?: string;
    hitlTimeoutMinutes?: number;
    baseUrl?: string;
}

export class ImGateway {
    private adapter: IImAdapter;
    private logger: Logger;
    private runAgent: ImGatewayOptions['runAgent'];
    private defaultRole: string;
    private hitlTimeoutMs: number;
    private baseUrl: string;

    constructor(opts: ImGatewayOptions) {
        this.adapter = opts.adapter;
        this.logger = opts.logger;
        this.runAgent = opts.runAgent;
        this.defaultRole = opts.defaultRole ?? 'user';
        this.hitlTimeoutMs = (opts.hitlTimeoutMinutes ?? 30) * 60 * 1000;
        this.baseUrl = opts.baseUrl ?? 'http://localhost:3000';
    }

    /** Handle inbound IM event. Returns HTTP response body for the platform. */
    async handleInbound(rawBody: string, headers: Record<string, string>): Promise<unknown> {
        // 1. Signature verification
        if (!this.adapter.verifyRequest(headers, rawBody)) {
            this.logger.warn(`[im-gateway] Signature verification failed (platform=${this.adapter.platform})`);
            return { error: 'Unauthorized', code: 401 };
        }

        let body: unknown;
        try { body = JSON.parse(rawBody); } catch { return { error: 'Invalid JSON', code: 400 }; }

        // 2. Parse message
        const msg = this.adapter.parseInboundMessage(body);
        if (!msg) {
            // Could be a challenge or non-message event
            const b = body as any;
            if (b?.challenge) return { challenge: b.challenge };
            return { ok: true };
        }

        this.logger.info(`[im-gateway] Inbound message from ${msg.platform}/${msg.userId}: "${msg.text.slice(0, 80)}"`);

        // 3. Auth check
        let user = imUserRegistry.getUser(msg.platform, msg.userId);
        if (!user) {
            if (this.defaultRole === 'blocked') {
                await this.adapter.sendMessage(msg.replyTarget, '您没有权限使用此机器人，请联系管理员。');
                return { ok: true };
            }
            // Auto-register with default role
            imUserRegistry.upsertUser({ platform: msg.platform, imUserId: msg.userId, name: msg.userName, role: this.defaultRole });
            user = imUserRegistry.getUser(msg.platform, msg.userId);
        }

        if (!user || !user.enabled || user.role === 'blocked') {
            await this.adapter.sendMessage(msg.replyTarget, '您的账号已被禁用，请联系管理员。');
            return { ok: true };
        }

        // 4. Map IM conversation → CMaster session
        const sessionId = imSessionMapper.getOrCreate(msg.platform, msg.conversationId, msg.userId);

        // 5. Create audit execution record
        const execId = auditRepository.createExecution({
            type: 'agent',
            name: `IM: ${msg.text.slice(0, 50)}`,
            sessionId,
            triggerSource: 'im',
            triggerRef: msg.userId,
            inputSummary: msg.text.slice(0, 500),
        });

        // 6. Return 200 immediately (IM platforms require fast response)
        const replyTarget = { ...msg.replyTarget, extra: { ...msg.replyTarget.extra, sessionId } };
        setImmediate(() => this.runAsync(execId, msg.text, sessionId, replyTarget, msg.platform, msg.userId));

        return { ok: true };
    }

    private async runAsync(
        execId: string,
        text: string,
        sessionId: string,
        replyTarget: ImSendTarget,
        platform: string,
        userId: string,
    ): Promise<void> {
        const startMs = Date.now();
        await this.adapter.sendStatusUpdate(replyTarget, 'processing');

        // HitL timeout watcher: periodically check if session has a pending interrupt
        // and send approval card to IM user. Auto-reject after hitlTimeoutMs.
        let hitlTimer: NodeJS.Timeout | undefined;
        let hitlSent = false;

        const watchHitL = () => {
            if (hasPendingInterrupt(sessionId) && !hitlSent) {
                hitlSent = true;
                const meta = getPendingInterruptMeta(sessionId);
                this.adapter.sendApprovalCard(replyTarget, {
                    interruptId: meta?.interruptId ?? sessionId,
                    actionName: meta?.actionName ?? '未知操作',
                    dangerReason: meta?.dangerReason ?? '高危操作需要确认',
                    cardActionUrl: `${this.baseUrl}/api/im/card-action`,
                }).catch(err => {
                    this.logger.error(`[im-gateway] sendApprovalCard failed: ${err.message}`);
                });

                // Set timeout to auto-reject
                setTimeout(() => {
                    if (hasPendingInterrupt(sessionId)) {
                        this.logger.warn(`[im-gateway] HitL timeout for session ${sessionId}`);
                        const pendingMeta = getPendingInterruptMeta(sessionId);
                        resolveInterrupt(sessionId, false, {
                            interruptId: pendingMeta?.interruptId ?? sessionId,
                            actionName: pendingMeta?.actionName,
                            dangerReason: pendingMeta?.dangerReason,
                            operator: 'system-timeout',
                            operatorChannel: platform,
                        });
                        // Override the decision recorded above with 'timeout'
                        try {
                            auditRepository.recordApproval({
                                sessionId,
                                interruptId: pendingMeta?.interruptId ?? sessionId,
                                actionName: pendingMeta?.actionName,
                                dangerReason: pendingMeta?.dangerReason,
                                decision: 'timeout',
                                operator: 'system',
                                operatorChannel: platform,
                            });
                        } catch { /* non-fatal */ }
                    }
                }, this.hitlTimeoutMs);
            }
        };

        // Poll every 500ms to detect interrupt state
        hitlTimer = setInterval(watchHitL, 500);

        try {
            const answer = await this.runAgent(text, sessionId);
            clearInterval(hitlTimer);
            await this.adapter.sendMessage(replyTarget, answer || '（无结果）');
            auditRepository.updateExecution(execId, {
                status: 'success',
                outputSummary: answer?.slice(0, 500),
                durationMs: Date.now() - startMs,
            });
        } catch (err: any) {
            clearInterval(hitlTimer);
            this.logger.error(`[im-gateway] Agent error: ${err.message}`);
            await this.adapter.sendStatusUpdate(replyTarget, 'error', err.message?.slice(0, 100));
            auditRepository.updateExecution(execId, {
                status: 'failed',
                errorMessage: err.message,
                durationMs: Date.now() - startMs,
            });
        }
    }

    /** Handle interactive card action callback (HitL approve/reject). */
    async handleCardAction(body: unknown): Promise<unknown> {
        const b = body as any;
        // Feishu card action: body.action.value contains { action, interrupt_id, session_id }
        const value = b?.action?.value ?? b?.value ?? {};
        const interruptId: string = value?.interrupt_id ?? '';
        const approved: boolean = value?.action === 'approve';
        const userId: string = b?.open_id ?? b?.user_id ?? value?.user_id ?? 'unknown';
        const platform: string = b?.platform ?? this.adapter.platform;
        // session_id embedded in card value
        const sessionId: string = value?.session_id ?? '';

        if (!sessionId || !interruptId) {
            return { toast: { type: 'error', content: '缺少必要参数' } };
        }

        const meta = getPendingInterruptMeta(sessionId);

        const resolved = resolveInterrupt(sessionId, approved, {
            interruptId,
            actionName: meta?.actionName,
            dangerReason: meta?.dangerReason,
            executionId: meta?.executionId,
            operator: userId,
            operatorChannel: platform,
        });

        if (!resolved) {
            return { toast: { type: 'warning', content: '该操作已超时或不存在' } };
        }

        this.logger.info(`[im-gateway] HitL resolved: sessionId=${sessionId} approved=${approved} by ${userId}`);

        return {
            toast: {
                type: approved ? 'success' : 'info',
                content: approved ? '已确认执行' : '已拒绝操作',
            },
        };
    }

    getAdapterPlatform(): string {
        return this.adapter.platform;
    }
}
