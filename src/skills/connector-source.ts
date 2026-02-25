import { readFileSync, readdirSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import type { SkillSource, ToolDefinition, SkillContext, Logger } from '../types.js';

export interface ConnectorEndpoint {
    name: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    description: string;
    params?: Array<{
        name: string;
        type: string;
        in: 'path' | 'query' | 'body';
        required?: boolean;
        description?: string;
    }>;
}

export interface ConnectorConfig {
    name: string;
    baseUrl: string;
    auth?: {
        type: 'api-key' | 'bearer' | 'basic';
        header?: string;
        key?: string;
        username?: string;
        password?: string;
    };
    endpoints: ConnectorEndpoint[];
    description?: string;
}

/**
 * Interpolates ${ENV_VAR} and ${ENV_VAR:default} patterns
 */
function interpolateEnv(value: string): string {
    return value.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (_, varName, defaultVal) => {
        return process.env[varName] ?? defaultVal ?? '';
    });
}

function interpolateConfig(config: ConnectorConfig): ConnectorConfig {
    const str = JSON.stringify(config);
    const interpolated = interpolateEnv(str);
    return JSON.parse(interpolated);
}

export class ConnectorSkillSource implements SkillSource {
    name: string;
    type = 'local' as const;
    private config: ConnectorConfig;
    private logger: Logger;

    constructor(config: ConnectorConfig, logger: Logger) {
        this.config = interpolateConfig(config);
        this.name = `connector-${config.name}`;
        this.logger = logger;
    }

    async initialize(): Promise<void> {
        this.logger.info(`[connector] Initialized connector: ${this.config.name} (${this.config.baseUrl})`);
    }

    async getTools(): Promise<ToolDefinition[]> {
        return this.config.endpoints.map(ep => {
            const properties: Record<string, unknown> = {};
            const required: string[] = [];

            for (const p of ep.params || []) {
                properties[p.name] = { type: p.type, description: p.description || p.name };
                if (p.required) required.push(p.name);
            }

            return {
                type: 'function' as const,
                function: {
                    name: `${this.config.name}.${ep.name}`,
                    description: ep.description || `${ep.method} ${ep.path}`,
                    parameters: { type: 'object', properties, required },
                },
            };
        });
    }

    async execute(toolName: string, params: Record<string, unknown>, context: SkillContext): Promise<unknown> {
        const actionName = toolName.split('.')[1];
        const endpoint = this.config.endpoints.find(e => e.name === actionName);
        if (!endpoint) throw new Error(`Endpoint ${actionName} not found in connector ${this.config.name}`);

        // Build URL: replace path params
        let url = this.config.baseUrl.replace(/\/$/, '') + endpoint.path;
        const queryParams: Record<string, string> = {};
        const bodyData: Record<string, unknown> = {};

        for (const param of endpoint.params || []) {
            const val = params[param.name];
            if (val === undefined) continue;

            if (param.in === 'path') {
                url = url.replace(`{${param.name}}`, encodeURIComponent(String(val)));
            } else if (param.in === 'query') {
                queryParams[param.name] = String(val);
            } else if (param.in === 'body') {
                bodyData[param.name] = val;
            }
        }

        if (Object.keys(queryParams).length > 0) {
            url += '?' + new URLSearchParams(queryParams).toString();
        }

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const auth = this.config.auth;
        if (auth) {
            if (auth.type === 'api-key' && auth.header && auth.key) {
                headers[auth.header] = auth.key;
            } else if (auth.type === 'bearer' && auth.key) {
                headers['Authorization'] = `Bearer ${auth.key}`;
            } else if (auth.type === 'basic' && auth.username && auth.password) {
                headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
            }
        }

        context.logger.info(`[connector] ${endpoint.method} ${url}`);

        const fetchOpts: RequestInit = {
            method: endpoint.method,
            headers,
        };
        if (['POST', 'PUT', 'PATCH'].includes(endpoint.method) && Object.keys(bodyData).length > 0) {
            fetchOpts.body = JSON.stringify(bodyData);
        }

        const response = await fetch(url, fetchOpts);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return response.json();
        }
        return response.text();
    }

    async destroy(): Promise<void> {}
}

/**
 * Manager for multiple connector configs stored as JSON files
 */
export class ConnectorManager {
    private connectorsDir: string;
    private logger: Logger;
    private sources: Map<string, ConnectorSkillSource> = new Map();

    constructor(connectorsDir: string, logger: Logger) {
        this.connectorsDir = resolve(connectorsDir);
        this.logger = logger;
    }

    async loadAll(): Promise<ConnectorSkillSource[]> {
        if (!existsSync(this.connectorsDir)) return [];

        const files = readdirSync(this.connectorsDir).filter(f => f.endsWith('.json'));
        const sources: ConnectorSkillSource[] = [];

        for (const file of files) {
            try {
                const config: ConnectorConfig = JSON.parse(readFileSync(join(this.connectorsDir, file), 'utf-8'));
                const source = new ConnectorSkillSource(config, this.logger);
                await source.initialize();
                this.sources.set(config.name, source);
                sources.push(source);
            } catch (err) {
                this.logger.error(`[connector] Failed to load ${file}: ${(err as Error).message}`);
            }
        }

        return sources;
    }

    save(config: ConnectorConfig): void {
        if (!existsSync(this.connectorsDir)) {
            mkdirSync(this.connectorsDir, { recursive: true });
        }
        writeFileSync(join(this.connectorsDir, `${config.name}.json`), JSON.stringify(config, null, 2), 'utf-8');
    }

    delete(name: string): void {
        const path = join(this.connectorsDir, `${name}.json`);
        if (existsSync(path)) unlinkSync(path);
        this.sources.delete(name);
    }

    getSource(name: string): ConnectorSkillSource | undefined {
        return this.sources.get(name);
    }

    listConfigs(): ConnectorConfig[] {
        if (!existsSync(this.connectorsDir)) return [];
        return readdirSync(this.connectorsDir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                try { return JSON.parse(readFileSync(join(this.connectorsDir, f), 'utf-8')); }
                catch { return null; }
            })
            .filter(Boolean);
    }
}
