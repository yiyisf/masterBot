import pino from 'pino';
import { execSync } from 'child_process';
import type { Logger } from '../types.js';

// Windows: 切换终端代码页到 UTF-8，防止中文乱码；非致命错误直接忽略
if (process.platform === 'win32') {
    try {
        execSync('chcp 65001', { stdio: 'ignore' });
    } catch { /* 非致命，忽略 */ }
}

/**
 * 创建日志器
 */
export function createLogger(options: { level: string; prettyPrint: boolean }): Logger {
    const isWindows = process.platform === 'win32';

    const pinoLogger = pino({
        level: options.level,
        transport: options.prettyPrint
            ? {
                target: 'pino-pretty',
                options: {
                    colorize: !isWindows, // Windows 禁用 ANSI 颜色，避免颜色码乱码
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
