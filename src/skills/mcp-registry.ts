import { nanoid } from 'nanoid';
import type { McpServerConfig, Logger } from '../types.js';

/**
 * MCP Registry 服务器条目
 */
export interface RegistryServerEntry {
    name: string;
    description?: string;
    repository?: {
        url: string;
        source: string;
    };
    version_detail?: {
        version: string;
    };
    packages?: Array<{
        registry_name: string;
        name: string;
        version?: string;
        runtime?: string;
        environment_variables?: Array<{
            name: string;
            description?: string;
            required?: boolean;
        }>;
        package_arguments?: string[];
    }>;
    remotes?: Array<{
        transport_type: 'sse' | 'streamable-http';
        url: string;
    }>;
}

export interface RegistryListResponse {
    servers: RegistryServerEntry[];
    next_cursor?: string;
}

/**
 * MCP Registry API 客户端
 * 从官方 MCP Registry 浏览、搜索和安装 MCP 服务器
 */
export class McpRegistryClient {
    private baseUrl: string;
    private logger: Logger;

    constructor(logger: Logger, baseUrl = 'https://registry.modelcontextprotocol.io/v0') {
        this.baseUrl = baseUrl;
        this.logger = logger;
    }

    /**
     * 浏览服务器列表 (分页)
     */
    async listServers(cursor?: string, limit = 50): Promise<RegistryListResponse> {
        const params = new URLSearchParams();
        if (cursor) params.set('cursor', cursor);
        params.set('count', String(limit));

        const url = `${this.baseUrl}/servers?${params}`;
        this.logger.debug(`MCP Registry: listing servers from ${url}`);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`MCP Registry API error: ${response.status} ${response.statusText}`);
        }

        return response.json() as Promise<RegistryListResponse>;
    }

    /**
     * 搜索服务器
     */
    async searchServers(query: string): Promise<RegistryServerEntry[]> {
        const params = new URLSearchParams({ q: query });
        const url = `${this.baseUrl}/servers?${params}`;
        this.logger.debug(`MCP Registry: searching "${query}"`);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`MCP Registry search error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { servers?: RegistryServerEntry[] };
        return data.servers || [];
    }

    /**
     * 获取单个服务器详情
     */
    async getServer(name: string): Promise<RegistryServerEntry> {
        const url = `${this.baseUrl}/servers/${encodeURIComponent(name)}`;
        this.logger.debug(`MCP Registry: fetching server "${name}"`);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`MCP Registry server not found: ${name}`);
        }

        return response.json() as Promise<RegistryServerEntry>;
    }

    /**
     * 将 Registry 条目转换为 McpServerConfig
     */
    toMcpConfig(entry: RegistryServerEntry, envOverrides?: Record<string, string>): McpServerConfig {
        // Prefer npm package → stdio transport
        const npmPkg = entry.packages?.find(p => p.registry_name === 'npm');
        if (npmPkg) {
            const env: Record<string, string> = {};
            if (npmPkg.environment_variables) {
                for (const ev of npmPkg.environment_variables) {
                    env[ev.name] = envOverrides?.[ev.name] || '';
                }
            }

            return {
                id: nanoid(),
                name: entry.name,
                type: 'stdio',
                command: npmPkg.runtime === 'node' ? 'npx' : 'npx',
                args: ['-y', npmPkg.name, ...(npmPkg.package_arguments || [])],
                env: Object.keys(env).length > 0 ? env : undefined,
                enabled: true,
            };
        }

        // Fallback to remote endpoint → sse/streamable-http transport
        const remote = entry.remotes?.[0];
        if (remote) {
            return {
                id: nanoid(),
                name: entry.name,
                type: remote.transport_type === 'streamable-http' ? 'streamable-http' : 'sse',
                url: remote.url,
                enabled: true,
            };
        }

        // Last resort: no viable transport found
        throw new Error(`No installable transport found for "${entry.name}"`);
    }

    /**
     * 提取服务器需要的环境变量
     */
    getRequiredEnvVars(entry: RegistryServerEntry): Array<{ name: string; description?: string; required?: boolean }> {
        const npmPkg = entry.packages?.find(p => p.registry_name === 'npm');
        return npmPkg?.environment_variables || [];
    }
}
