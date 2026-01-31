import pino from 'pino';
import type { Logger } from '../types.js';

/**
 * 创建日志器
 */
export function createLogger(options: { level: string; prettyPrint: boolean }): Logger {
    const pinoLogger = pino({
        level: options.level,
        transport: options.prettyPrint
            ? {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                },
            }
            : undefined,
    });

    return {
        debug: (msg: string, ...args: unknown[]) => pinoLogger.debug({ args }, msg),
        info: (msg: string, ...args: unknown[]) => pinoLogger.info({ args }, msg),
        warn: (msg: string, ...args: unknown[]) => pinoLogger.warn({ args }, msg),
        error: (msg: string, ...args: unknown[]) => pinoLogger.error({ args }, msg),
    };
}
