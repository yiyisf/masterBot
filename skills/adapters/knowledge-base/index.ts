/**
 * IKnowledgeBase adapter — connects to internal Wiki/knowledge management systems.
 * Configure via connectors/knowledge-base.yaml
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { SkillContext } from '../../../src/types.js';

interface KbConfig {
    name: string;
    type: 'http';
    baseUrl: string;
    auth?: {
        type: 'bearer' | 'api-key' | 'basic';
        header?: string;
        key?: string;
        username?: string;
        password?: string;
    };
}

function loadConfig(): KbConfig {
    const configPath = join(process.cwd(), 'connectors', 'knowledge-base.yaml');
    if (!existsSync(configPath)) {
        throw new Error('Knowledge base config not found. Create connectors/knowledge-base.yaml');
    }

    const content = readFileSync(configPath, 'utf-8');
    // Simple YAML parse with env interpolation
    const config: Record<string, unknown> = {};
    for (const line of content.split('\n')) {
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match) {
            const val = match[2].trim().replace(/^['"]|['"]$/g, '');
            config[match[1]] = val.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (_: string, varName: string, def: string) => {
                return process.env[varName] ?? def ?? '';
            });
        }
    }

    return config as unknown as KbConfig;
}

function buildHeaders(config: KbConfig): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = config.auth;
    if (!auth) return headers;

    if (auth.type === 'bearer' && auth.key) {
        headers['Authorization'] = `Bearer ${auth.key}`;
    } else if (auth.type === 'api-key' && auth.header && auth.key) {
        headers[auth.header] = auth.key;
    } else if (auth.type === 'basic' && auth.username && auth.password) {
        headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
    }

    return headers;
}

async function apiFetch(config: KbConfig, path: string, opts?: RequestInit): Promise<unknown> {
    const url = config.baseUrl.replace(/\/$/, '') + path;
    const response = await fetch(url, {
        ...opts,
        headers: { ...buildHeaders(config), ...(opts?.headers as Record<string, string> || {}) },
    });

    if (!response.ok) {
        throw new Error(`Knowledge base API error ${response.status}: ${await response.text()}`);
    }

    const ct = response.headers.get('content-type') || '';
    return ct.includes('json') ? response.json() : response.text();
}

/**
 * List pages updated after a given timestamp
 */
export async function list_updated_pages(
    ctx: SkillContext,
    params: { since: string; limit?: number; space?: string }
): Promise<{ pages: Array<{ id: string; title: string; updatedAt: string; url?: string }> }> {
    const config = loadConfig();
    ctx.logger.info(`[knowledge-base] Listing pages updated since ${params.since}`);

    const qs = new URLSearchParams({
        since: params.since,
        limit: String(params.limit || 50),
        ...(params.space ? { space: params.space } : {}),
    });

    const result = await apiFetch(config, `/pages/updated?${qs}`) as any;
    return { pages: result.pages || result.data || [] };
}

/**
 * Get full content of a page
 */
export async function get_page_content(
    ctx: SkillContext,
    params: { pageId: string; format?: 'markdown' | 'text' }
): Promise<{ id: string; title: string; content: string; updatedAt: string }> {
    const config = loadConfig();
    ctx.logger.info(`[knowledge-base] Fetching page ${params.pageId}`);

    const result = await apiFetch(config, `/pages/${params.pageId}?format=${params.format || 'markdown'}`) as any;
    return {
        id: result.id || params.pageId,
        title: result.title || '',
        content: result.content || result.body || '',
        updatedAt: result.updatedAt || result.updated_at || new Date().toISOString(),
    };
}

/**
 * Write or update a page in the knowledge base
 */
export async function write_page(
    ctx: SkillContext,
    params: { pageId?: string; parentId?: string; title: string; content: string; space?: string }
): Promise<{ id: string; url?: string; action: 'created' | 'updated' }> {
    const config = loadConfig();
    ctx.logger.info(`[knowledge-base] Writing page: ${params.title}`);

    if (params.pageId) {
        // Update existing page
        const result = await apiFetch(config, `/pages/${params.pageId}`, {
            method: 'PUT',
            body: JSON.stringify({ title: params.title, content: params.content }),
        }) as any;
        return { id: params.pageId, url: result.url, action: 'updated' };
    } else {
        // Create new page
        const result = await apiFetch(config, '/pages', {
            method: 'POST',
            body: JSON.stringify({
                title: params.title,
                content: params.content,
                parentId: params.parentId,
                space: params.space,
            }),
        }) as any;
        return { id: result.id || '', url: result.url, action: 'created' };
    }
}

/**
 * Full-text search in the knowledge base
 */
export async function search_pages(
    ctx: SkillContext,
    params: { query: string; limit?: number; space?: string }
): Promise<{ results: Array<{ id: string; title: string; excerpt: string; score: number }> }> {
    const config = loadConfig();
    ctx.logger.info(`[knowledge-base] Searching: ${params.query}`);

    const qs = new URLSearchParams({
        q: params.query,
        limit: String(params.limit || 10),
        ...(params.space ? { space: params.space } : {}),
    });

    const result = await apiFetch(config, `/search?${qs}`) as any;
    return { results: result.results || result.data || [] };
}

export default { list_updated_pages, get_page_content, write_page, search_pages };
