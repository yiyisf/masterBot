/**
 * Phase 7: TeamsChannel — Microsoft Teams（占位实现）
 *
 * Phase 7 聚焦飞书 + 钉钉，此文件保留接口签名供后续实现。
 */

import type { IChannel, IncomingMessage, ChannelTarget, ChannelMessage, ApprovalRequest, StatusKind } from './types.js';

export class TeamsChannel implements IChannel {
    readonly name = 'teams';

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    verifyRequest(_headers: Record<string, string>, _rawBody: string): boolean {
        throw new Error('TeamsChannel: not implemented — planned for Phase 7.5');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    parseInboundMessage(_body: unknown): IncomingMessage | null {
        throw new Error('TeamsChannel: not implemented');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async send(_target: ChannelTarget, _message: ChannelMessage): Promise<void> {
        throw new Error('TeamsChannel: not implemented');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async sendApprovalCard(_target: ChannelTarget, _req: ApprovalRequest): Promise<void> {
        throw new Error('TeamsChannel: not implemented');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async sendStatus(_target: ChannelTarget, _kind: StatusKind, _detail?: string): Promise<void> {
        throw new Error('TeamsChannel: not implemented');
    }

    async health(): Promise<{ ok: boolean; details?: string }> {
        return { ok: false, details: 'TeamsChannel: not implemented' };
    }
}
