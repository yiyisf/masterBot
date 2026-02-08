import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { createAuthHook, type AuthConfig } from '../src/gateway/auth.js';

const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

function createMockRequest(overrides: Record<string, any> = {}) {
    return {
        url: '/api/chat',
        ip: '127.0.0.1',
        headers: {},
        ...overrides,
    } as any;
}

function createMockReply() {
    const reply: any = {
        statusCode: 200,
        body: null,
        status(code: number) { reply.statusCode = code; return reply; },
        send(body: any) { reply.body = body; return reply; },
    };
    return reply;
}

describe('Auth Middleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('API Key mode', () => {
        const config: AuthConfig = {
            enabled: true,
            mode: 'api-key',
            apiKeys: ['test-key-123', 'another-key'],
        };
        const hook = createAuthHook(config, mockLogger);

        it('allows valid API key', () => {
            const done = vi.fn();
            const request = createMockRequest({ headers: { 'x-api-key': 'test-key-123' } });
            const reply = createMockReply();

            hook(request, reply, done);
            expect(done).toHaveBeenCalled();
            expect(reply.statusCode).toBe(200);
        });

        it('rejects invalid API key', () => {
            const done = vi.fn();
            const request = createMockRequest({ headers: { 'x-api-key': 'wrong-key' } });
            const reply = createMockReply();

            hook(request, reply, done);
            expect(done).not.toHaveBeenCalled();
            expect(reply.statusCode).toBe(401);
        });

        it('rejects missing API key', () => {
            const done = vi.fn();
            const request = createMockRequest();
            const reply = createMockReply();

            hook(request, reply, done);
            expect(done).not.toHaveBeenCalled();
            expect(reply.statusCode).toBe(401);
        });
    });

    describe('JWT mode', () => {
        const secret = 'test-jwt-secret';
        const config: AuthConfig = {
            enabled: true,
            mode: 'jwt',
            jwtSecret: secret,
        };
        const hook = createAuthHook(config, mockLogger);

        it('allows valid JWT', () => {
            const token = jwt.sign({ sub: 'user1' }, secret, { expiresIn: '1h' });
            const done = vi.fn();
            const request = createMockRequest({ headers: { authorization: `Bearer ${token}` } });
            const reply = createMockReply();

            hook(request, reply, done);
            expect(done).toHaveBeenCalled();
        });

        it('rejects expired JWT', () => {
            const token = jwt.sign({ sub: 'user1' }, secret, { expiresIn: '-1s' });
            const done = vi.fn();
            const request = createMockRequest({ headers: { authorization: `Bearer ${token}` } });
            const reply = createMockReply();

            hook(request, reply, done);
            expect(done).not.toHaveBeenCalled();
            expect(reply.statusCode).toBe(401);
        });

        it('rejects malformed token', () => {
            const done = vi.fn();
            const request = createMockRequest({ headers: { authorization: 'Bearer not.a.valid.token' } });
            const reply = createMockReply();

            hook(request, reply, done);
            expect(done).not.toHaveBeenCalled();
            expect(reply.statusCode).toBe(401);
        });

        it('rejects missing Bearer header', () => {
            const done = vi.fn();
            const request = createMockRequest({ headers: {} });
            const reply = createMockReply();

            hook(request, reply, done);
            expect(done).not.toHaveBeenCalled();
            expect(reply.statusCode).toBe(401);
        });
    });

    describe('/health bypass', () => {
        const config: AuthConfig = {
            enabled: true,
            mode: 'api-key',
            apiKeys: ['key'],
        };
        const hook = createAuthHook(config, mockLogger);

        it('skips auth for /health', () => {
            const done = vi.fn();
            const request = createMockRequest({ url: '/health', headers: {} });
            const reply = createMockReply();

            hook(request, reply, done);
            expect(done).toHaveBeenCalled();
        });
    });
});
