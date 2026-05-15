/**
 * Phase 7: WeComChannel — 企业微信（占位实现）
 *
 * Phase 7 聚焦飞书 + 钉钉，此文件保留接口签名供后续实现。
 * 调用任何方法将抛出 NotImplementedError。
 */

import type { IChannel, IncomingMessage, ChannelTarget, ChannelMessage, ApprovalRequest, StatusKind } from './types.js';

export class WeComChannel implements IChannel {
    readonly name = 'wecom';

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    verifyRequest(_headers: Record<string, string>, _rawBody: string): boolean {
        throw new Error('WeComChannel: not implemented — planned for Phase 7.5');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    parseInboundMessage(_body: unknown): IncomingMessage | null {
        throw new Error('WeComChannel: not implemented');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async send(_target: ChannelTarget, _message: ChannelMessage): Promise<void> {
        throw new Error('WeComChannel: not implemented');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async sendApprovalCard(_target: ChannelTarget, _req: ApprovalRequest): Promise<void> {
        throw new Error('WeComChannel: not implemented');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async sendStatus(_target: ChannelTarget, _kind: StatusKind, _detail?: string): Promise<void> {
        throw new Error('WeComChannel: not implemented');
    }

    async health(): Promise<{ ok: boolean; details?: string }> {
        return { ok: false, details: 'WeComChannel: not implemented' };
    }
}
