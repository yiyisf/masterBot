/**
 * API 客户端工具类
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
        ...(options?.headers as Record<string, string>),
    };

    if (options?.body || (options?.method && ['POST', 'PUT', 'PATCH'].includes(options.method.toUpperCase()))) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || response.statusText);
    }

    return response.json();
}

/**
 * SSE 流式请求
 */
export async function* streamApi(path: string, body: any, signal?: AbortSignal): AsyncGenerator<any> {
    const response = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        throw new Error('SSE request failed');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Body reader not available');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const content = line.slice(6).trim();
                if (content === '[DONE]') return;
                try {
                    yield JSON.parse(content);
                } catch (e) {
                    console.error('Failed to parse SSE event', e);
                }
            }
        }
    }
}
