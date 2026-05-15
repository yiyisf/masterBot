/**
 * Phase 7: IChannel 抽象 — 企业 IM 渠道统一接口
 *
 * 设计原则：
 *  - 每个渠道实现 IChannel，统一入站/出站/HitL
 *  - ApprovalRequest 含 riskLevel（影响卡片配色）与 allowModify（第三态按钮）
 *  - ChannelRouter 负责多渠道注册与分发
 */

// ─── Inbound ─────────────────────────────────────────────────────────────────

export interface IncomingMessage {
    channelName: string;
    /** 平台原始用户 ID（如飞书 open_id / 钉钉 dingtalk_id） */
    userId: string;
    /** 会话/群 ID */
    conversationId: string;
    /** 清洗后的文本（已去掉 @Bot 前缀） */
    text: string;
    attachments?: Attachment[];
    /** 平台原始消息体，供适配器内部使用 */
    raw: unknown;
}

export interface Attachment {
    type: 'image' | 'file' | 'audio';
    url?: string;
    name?: string;
}

// ─── Outbound ─────────────────────────────────────────────────────────────────

export interface ChannelTarget {
    channelName: string;
    conversationId: string;
    userId: string;
    /** 平台特定的回复上下文（如 message_id、chat_id） */
    extra?: Record<string, unknown>;
}

export interface ChannelMessage {
    text: string;
    /** 可选：Markdown / 富文本 */
    markdown?: string;
}

// ─── HitL Approval ───────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ApprovalRequest {
    interruptId: string;
    toolName: string;
    toolInput?: Record<string, unknown>;
    /** 风险原因，显示在卡片正文 */
    reason: string;
    riskLevel: RiskLevel;
    /** 是否显示"带修改批准"第三态按钮 */
    allowModify?: boolean;
    /** 超时秒数，默认 300s（5 分钟） */
    timeoutSeconds?: number;
    /** 嵌入卡片 value 的 sessionId，用于 callback 定位 */
    sessionId: string;
    /** 卡片 callback URL */
    cardActionUrl: string;
}

export type ApprovalDecision = 'approve' | 'reject' | 'modify';

export interface ApprovalResponse {
    decision: ApprovalDecision;
    /** "带修改批准"时，用户填入的修改内容 */
    modifiedInput?: Record<string, unknown>;
    operatorUserId: string;
}

// ─── Status Update ────────────────────────────────────────────────────────────

export type StatusKind = 'processing' | 'done' | 'error';

// ─── IChannel ────────────────────────────────────────────────────────────────

export interface IChannel {
    readonly name: string;

    /** 验证入站请求签名，返回 false 则以 401 拒绝 */
    verifyRequest(headers: Record<string, string>, rawBody: string): boolean;

    /** 解析平台事件为标准 IncomingMessage，无需处理时返回 null */
    parseInboundMessage(body: unknown): IncomingMessage | null;

    /** 发送纯文本消息 */
    send(target: ChannelTarget, message: ChannelMessage): Promise<void>;

    /** 发送 HitL 审批卡片 */
    sendApprovalCard(target: ChannelTarget, req: ApprovalRequest): Promise<void>;

    /** 发送状态更新（处理中 / 完成 / 出错） */
    sendStatus(target: ChannelTarget, kind: StatusKind, detail?: string): Promise<void>;

    /** 健康检查 */
    health(): Promise<{ ok: boolean; latencyMs?: number; details?: string }>;
}

// ─── Card Action Callback ─────────────────────────────────────────────────────

/** ChannelRouter.handleCardAction 解析后的标准回调结构 */
export interface CardActionPayload {
    channelName: string;
    interruptId: string;
    sessionId: string;
    decision: ApprovalDecision;
    operatorUserId: string;
    modifiedInput?: Record<string, unknown>;
}
