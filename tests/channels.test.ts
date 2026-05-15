import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeishuChannel } from '../src/channels/feishu.js';
import { DingTalkChannel } from '../src/channels/dingtalk.js';
import { HitlCardRenderer } from '../src/channels/hitl-card-renderer.js';
import { ChannelRouter } from '../src/channels/router.js';
import type { Logger } from '../src/types.js';

const mockLogger: Logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
};

// ─── FeishuChannel Tests ──────────────────────────────────────────────────────

describe('FeishuChannel', () => {
    const cfg = {
        appId: 'test_app_id',
        appSecret: 'test_app_secret',
        verificationToken: 'test_token',
        encryptKey: 'test_key_1234567', // 16 字节
    };

    let ch: FeishuChannel;
    beforeEach(() => { ch = new FeishuChannel(cfg, mockLogger); });

    it('verifyRequest: 缺少 header 时返回 false', () => {
        expect(ch.verifyRequest({}, '{}')).toBe(false);
        expect(ch.verifyRequest({ 'x-lark-signature': 'abc' }, '{}')).toBe(false);
    });

    it('verifyRequest: 签名正确时返回 true', () => {
        const ts = String(Date.now());
        const nonce = 'testnonce';
        const body = '{"test":1}';
        const key = cfg.encryptKey;
        const sig = crypto.createHmac('sha256', key).update(ts + nonce + key + body).digest('hex');
        const headers = {
            'x-lark-signature': sig,
            'x-lark-request-timestamp': ts,
            'x-lark-request-nonce': nonce,
        };
        expect(ch.verifyRequest(headers, body)).toBe(true);
    });

    it('parseInboundMessage: URL challenge 返回 null', () => {
        expect(ch.parseInboundMessage({ challenge: 'abc' })).toBeNull();
    });

    it('parseInboundMessage: 非 im.message.receive_v1 返回 null', () => {
        expect(ch.parseInboundMessage({ header: { event_type: 'bot.added' } })).toBeNull();
    });

    it('parseInboundMessage: 正常文本消息解析成功', () => {
        const body = {
            header: { event_type: 'im.message.receive_v1' },
            event: {
                sender: { sender_id: { open_id: 'user123' } },
                message: {
                    message_type: 'text',
                    content: JSON.stringify({ text: 'hello bot' }),
                    chat_id: 'chat_abc',
                    message_id: 'msg_001',
                },
            },
        };
        const msg = ch.parseInboundMessage(body);
        expect(msg).not.toBeNull();
        expect(msg?.text).toBe('hello bot');
        expect(msg?.userId).toBe('user123');
        expect(msg?.conversationId).toBe('chat_abc');
        expect(msg?.channelName).toBe('feishu');
    });

    it('parseInboundMessage: @mention 被清洗', () => {
        const body = {
            header: { event_type: 'im.message.receive_v1' },
            event: {
                sender: { sender_id: { open_id: 'u1' } },
                message: {
                    message_type: 'text',
                    content: JSON.stringify({ text: '@bot 帮我查下天气' }),
                    chat_id: 'c1',
                    message_id: 'm1',
                },
            },
        };
        const msg = ch.parseInboundMessage(body);
        expect(msg?.text).toBe('帮我查下天气');
    });

    it('parseInboundMessage: 空文本返回 null', () => {
        const body = {
            header: { event_type: 'im.message.receive_v1' },
            event: {
                sender: { sender_id: { open_id: 'u1' } },
                message: {
                    message_type: 'text',
                    content: JSON.stringify({ text: '@bot' }),
                    chat_id: 'c1',
                    message_id: 'm1',
                },
            },
        };
        expect(ch.parseInboundMessage(body)).toBeNull();
    });

    it('extractOperatorUserId: 飞书 2.0 格式', () => {
        expect(FeishuChannel.extractOperatorUserId({ operator: { open_id: 'op123' } })).toBe('op123');
    });

    it('extractOperatorUserId: 飞书 3.0 fallback', () => {
        expect(FeishuChannel.extractOperatorUserId({ open_id: 'op456' })).toBe('op456');
    });
});

// ─── DingTalkChannel Tests ────────────────────────────────────────────────────

describe('DingTalkChannel', () => {
    const cfg = {
        appKey: 'test_app_key',
        appSecret: 'test_app_secret',
        signingSecret: 'test_signing_secret',
    };

    let ch: DingTalkChannel;
    beforeEach(() => { ch = new DingTalkChannel(cfg, mockLogger); });

    it('verifyRequest: 缺少 timestamp/sign 返回 false', () => {
        expect(ch.verifyRequest({}, '{}')).toBe(false);
        expect(ch.verifyRequest({ timestamp: '123' }, '{}')).toBe(false);
    });

    it('verifyRequest: 签名正确时返回 true', () => {
        const ts = String(Date.now());
        const content = ts + '\n' + cfg.signingSecret;
        const sign = encodeURIComponent(
            crypto.createHmac('sha256', cfg.signingSecret).update(content).digest('base64'),
        );
        expect(ch.verifyRequest({ timestamp: ts, sign }, '{}')).toBe(true);
    });

    it('parseInboundMessage: 非 text 消息返回 null', () => {
        expect(ch.parseInboundMessage({ msgtype: 'image' })).toBeNull();
    });

    it('parseInboundMessage: 正常文本消息解析成功', () => {
        const body = {
            msgtype: 'text',
            text: { content: '查询订单状态' },
            senderStaffId: 'staff001',
            conversationId: 'conv_001',
        };
        const msg = ch.parseInboundMessage(body);
        expect(msg).not.toBeNull();
        expect(msg?.text).toBe('查询订单状态');
        expect(msg?.userId).toBe('staff001');
        expect(msg?.channelName).toBe('dingtalk');
    });

    it('parseInboundMessage: @mention 被清洗', () => {
        const body = {
            msgtype: 'text',
            text: { content: '@bot 帮我查天气' },
            senderStaffId: 's1',
            conversationId: 'c1',
        };
        expect(ch.parseInboundMessage(body)?.text).toBe('帮我查天气');
    });

    it('extractOperatorUserId: staffId 优先', () => {
        expect(DingTalkChannel.extractOperatorUserId({ staffId: 's1', userId: 'u1' })).toBe('s1');
    });
});

// ─── HitlCardRenderer Tests ───────────────────────────────────────────────────

describe('HitlCardRenderer', () => {
    it('parseCardAction: 飞书格式', () => {
        const body = {
            action: { value: { action: 'approve', interrupt_id: 'int1', session_id: 'sess1', channel: 'feishu' } },
            operator: { open_id: 'op1' },
        };
        const result = HitlCardRenderer.parseCardAction('feishu', body);
        expect(result).not.toBeNull();
        expect(result?.decision).toBe('approve');
        expect(result?.interruptId).toBe('int1');
        expect(result?.operatorUserId).toBe('op1');
    });

    it('parseCardAction: 钉钉 querystring 格式', () => {
        const body = { action: 'reject', interrupt_id: 'int2', session_id: 'sess2', staffId: 'staff1' };
        const result = HitlCardRenderer.parseCardAction('dingtalk', body);
        expect(result).not.toBeNull();
        expect(result?.decision).toBe('reject');
        expect(result?.interruptId).toBe('int2');
        expect(result?.operatorUserId).toBe('staff1');
    });

    it('parseCardAction: 无效 body 返回 null', () => {
        expect(HitlCardRenderer.parseCardAction('feishu', {})).toBeNull();
        expect(HitlCardRenderer.parseCardAction('dingtalk', { foo: 'bar' })).toBeNull();
    });

    it('send 后 pendingCount 增加，clear 后减少', async () => {
        const renderer = new HitlCardRenderer(mockLogger);
        const mockChannel = {
            name: 'feishu',
            sendApprovalCard: vi.fn().mockResolvedValue(undefined),
        } as any;
        const target = { channelName: 'feishu', conversationId: 'c1', userId: 'u1' };
        const req = {
            interruptId: 'int_test',
            toolName: 'rm_rf',
            reason: '危险操作',
            riskLevel: 'high' as const,
            sessionId: 'sess_test',
            cardActionUrl: 'http://localhost/callback',
            timeoutSeconds: 3600,
        };
        await renderer.send(mockChannel, target, req, vi.fn());
        expect(renderer.pendingCount).toBe(1);
        renderer.clear('int_test');
        expect(renderer.pendingCount).toBe(0);
        renderer.destroy();
    });
});

// ─── ChannelRouter Tests ──────────────────────────────────────────────────────

describe('ChannelRouter', () => {
    const runAgent = vi.fn().mockResolvedValue('agent answer');

    it('未注册渠道返回 404', async () => {
        const router = new ChannelRouter({ logger: mockLogger, runAgent });
        const result = await router.handleInbound('unknown', '{}', {}) as any;
        expect(result.code).toBe(404);
        router.destroy();
    });

    it('注册/注销/listChannels 正常工作', () => {
        const router = new ChannelRouter({ logger: mockLogger, runAgent });
        const mockCh = { name: 'feishu', verifyRequest: vi.fn(), parseInboundMessage: vi.fn(), send: vi.fn(), sendApprovalCard: vi.fn(), sendStatus: vi.fn(), health: vi.fn() };
        router.register(mockCh);
        expect(router.listChannels()).toContain('feishu');
        router.unregister('feishu');
        expect(router.listChannels()).not.toContain('feishu');
        router.destroy();
    });

    it('验签失败返回 401', async () => {
        const router = new ChannelRouter({ logger: mockLogger, runAgent });
        const mockCh = {
            name: 'test',
            verifyRequest: vi.fn().mockReturnValue(false),
            parseInboundMessage: vi.fn(),
            send: vi.fn(),
            sendApprovalCard: vi.fn(),
            sendStatus: vi.fn(),
            health: vi.fn(),
        };
        router.register(mockCh);
        const result = await router.handleInbound('test', '{}', {}) as any;
        expect(result.code).toBe(401);
        router.destroy();
    });

    it('handleCardAction: 无效 body 返回 error toast', async () => {
        const router = new ChannelRouter({ logger: mockLogger, runAgent });
        const result = await router.handleCardAction('feishu', {}) as any;
        expect(result.toast.type).toBe('error');
        router.destroy();
    });

    it('health: 返回各渠道健康状态 map', async () => {
        const router = new ChannelRouter({ logger: mockLogger, runAgent });
        const mockCh = {
            name: 'feishu',
            verifyRequest: vi.fn(),
            parseInboundMessage: vi.fn(),
            send: vi.fn(),
            sendApprovalCard: vi.fn(),
            sendStatus: vi.fn(),
            health: vi.fn().mockResolvedValue({ ok: true, latencyMs: 10 }),
        };
        router.register(mockCh);
        const h = await router.health();
        expect(h['feishu']?.ok).toBe(true);
        router.destroy();
    });
});
