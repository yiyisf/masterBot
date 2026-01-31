import type { SkillContext } from '../../../src/types.js';

interface HttpResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}

/**
 * 发送 HTTP 请求
 */
export async function request(
    ctx: SkillContext,
    params: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string;
        timeout?: number;
    }
): Promise<HttpResponse> {
    const { url, method = 'GET', headers = {}, body, timeout = 30000 } = params;

    ctx.logger.info(`HTTP ${method} ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            method,
            headers,
            body,
            signal: controller.signal,
        });

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });

        const responseBody = await response.text();

        return {
            status: response.status,
            headers: responseHeaders,
            body: responseBody,
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * GET 请求快捷方法
 */
export async function get(
    ctx: SkillContext,
    params: { url: string; headers?: Record<string, string> }
): Promise<string> {
    const response = await request(ctx, { ...params, method: 'GET' });
    return response.body;
}

/**
 * POST 请求快捷方法
 */
export async function post(
    ctx: SkillContext,
    params: { url: string; data?: unknown; headers?: Record<string, string> }
): Promise<string> {
    const { url, data, headers = {} } = params;

    const response = await request(ctx, {
        url,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
        body: data ? JSON.stringify(data) : undefined,
    });

    return response.body;
}

export default { request, get, post };
