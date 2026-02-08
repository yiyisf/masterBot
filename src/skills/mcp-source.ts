import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { SkillSource, SkillContext, ToolDefinition, McpServerConfig, Logger } from '../types.js';

/**
 * MCP 技能源
 * 通过 MCP 协议接入社区工具
 */
export class McpSkillSource implements SkillSource {
    readonly name: string;
    readonly type = 'mcp' as const;

    private client: Client;
    private transport?: StdioClientTransport | SSEClientTransport;
    private config: McpServerConfig;
    private logger: Logger;
    private toolCache: ToolDefinition[] = [];
    private connected = false;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private reconnectAttempts = 0;
    private maxReconnectDelay = 60_000;

    constructor(config: McpServerConfig, logger: Logger) {
        this.config = config;
        this.logger = logger;
        this.name = `mcp-${config.name}`;
        this.client = new Client({
            name: 'cmaster-bot',
            version: '0.1.0',
        });
    }

    async initialize(): Promise<void> {
        this.transport = this.createTransport();
        await this.connect();
    }

    async getTools(): Promise<ToolDefinition[]> {
        if (!this.connected) return [];
        return this.toolCache;
    }

    async execute(
        toolName: string,
        params: Record<string, unknown>,
        _context: SkillContext
    ): Promise<unknown> {
        if (!this.connected) {
            throw new Error(`MCP server "${this.config.name}" is not connected`);
        }

        // Strip the mcp prefix: "mcp-serverName.toolName" → "toolName"
        const mcpToolName = toolName.replace(`${this.name}.`, '');

        const result = await this.client.callTool({
            name: mcpToolName,
            arguments: params,
        });

        // Extract text content from MCP response
        if (result.content && Array.isArray(result.content)) {
            const texts = result.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text);
            return texts.length === 1 ? texts[0] : texts.join('\n');
        }

        return result;
    }

    async destroy(): Promise<void> {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        try {
            await this.client.close();
        } catch {
            // Ignore close errors
        }
        if (this.transport && 'close' in this.transport) {
            try {
                await (this.transport as any).close();
            } catch {
                // Ignore close errors
            }
        }
        this.connected = false;
        this.toolCache = [];
        this.logger.info(`MCP source "${this.name}" destroyed`);
    }

    private createTransport(): StdioClientTransport | SSEClientTransport {
        if (this.config.type === 'stdio') {
            if (!this.config.command) {
                throw new Error(`MCP server "${this.config.name}": stdio transport requires 'command'`);
            }
            return new StdioClientTransport({
                command: this.config.command,
                args: this.config.args ?? [],
            });
        }

        if (this.config.type === 'sse') {
            if (!this.config.url) {
                throw new Error(`MCP server "${this.config.name}": SSE transport requires 'url'`);
            }
            return new SSEClientTransport(new URL(this.config.url));
        }

        throw new Error(`MCP server "${this.config.name}": unknown transport type "${this.config.type}"`);
    }

    private async connect(): Promise<void> {
        try {
            await this.client.connect(this.transport!);
            this.connected = true;
            this.reconnectAttempts = 0;

            // Cache tool definitions
            await this.refreshTools();

            this.logger.info(`MCP source "${this.name}" connected with ${this.toolCache.length} tools`);
        } catch (error) {
            this.connected = false;
            this.logger.error(`MCP source "${this.name}" connection failed: ${(error as Error).message}`);
            this.scheduleReconnect();
            throw error;
        }
    }

    private async refreshTools(): Promise<void> {
        try {
            const { tools } = await this.client.listTools();
            this.toolCache = tools.map(tool => this.mapTool(tool));
        } catch (error) {
            this.logger.error(`Failed to list tools from "${this.name}": ${(error as Error).message}`);
            this.toolCache = [];
        }
    }

    private mapTool(mcpTool: { name: string; description?: string; inputSchema?: any }): ToolDefinition {
        return {
            type: 'function',
            function: {
                name: `${this.name}.${mcpTool.name}`,
                description: mcpTool.description ?? '',
                parameters: mcpTool.inputSchema ?? { type: 'object', properties: {} },
            },
        };
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;

        this.reconnectAttempts++;
        const delay = Math.min(
            5000 * Math.pow(2, this.reconnectAttempts - 1),
            this.maxReconnectDelay
        );

        this.logger.info(`MCP "${this.name}" reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = undefined;
            try {
                this.transport = this.createTransport();
                this.client = new Client({
                    name: 'cmaster-bot',
                    version: '0.1.0',
                });
                await this.connect();
            } catch {
                // connect() already schedules next reconnect
            }
        }, delay);

        // Don't keep process alive for reconnect
        if (this.reconnectTimer.unref) {
            this.reconnectTimer.unref();
        }
    }
}
