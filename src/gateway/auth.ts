import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import jwt from 'jsonwebtoken';
import type { Logger } from '../types.js';

export interface AuthConfig {
    enabled: boolean;
    mode: 'api-key' | 'jwt';
    apiKeys?: string[];
    jwtSecret?: string;
}

/**
 * Create a Fastify onRequest hook for authentication
 */
export function createAuthHook(config: AuthConfig, logger: Logger) {
    return function authHook(request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
        // Skip health check
        if (request.url === '/health') {
            done();
            return;
        }

        if (config.mode === 'api-key') {
            const apiKey = request.headers['x-api-key'] as string | undefined;
            if (!apiKey || !(config.apiKeys ?? []).includes(apiKey)) {
                logger.warn(`Auth failed: invalid or missing API key from ${request.ip}`);
                reply.status(401).send({ error: 'Unauthorized: invalid or missing API key' });
                return;
            }
            done();
        } else if (config.mode === 'jwt') {
            const authHeader = request.headers.authorization;
            if (!authHeader?.startsWith('Bearer ')) {
                logger.warn(`Auth failed: missing Bearer token from ${request.ip}`);
                reply.status(401).send({ error: 'Unauthorized: missing Bearer token' });
                return;
            }

            const token = authHeader.slice(7);
            try {
                jwt.verify(token, config.jwtSecret ?? '');
                done();
            } catch (err: any) {
                logger.warn(`Auth failed: invalid JWT from ${request.ip}: ${err.message}`);
                reply.status(401).send({ error: `Unauthorized: ${err.message}` });
                return;
            }
        } else {
            done();
        }
    };
}
