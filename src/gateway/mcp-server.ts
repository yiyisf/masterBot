/**
 * MCP Server 模式（U6）— 把 CMaster 技能注册表暴露为 MCP Server
 *
 * 经 Streamable HTTP（POST /mcp，无状态模式）对外提供全部技能：
 * Claude Code / 任意 MCP 客户端可直接调用企业连接器、通知、知识图谱等技能，
 * CMaster 从「MCP 消费者」升级为「MCP 生态节点」。
 *
 * 治理：
 * - 复用网关既有认证中间件（auth.enabled 时 /mcp 自动受保护）
 * - 工具执行走 ISkillRegistry.executeAction 统一通道（沙箱/审计与内部调用一致）
 *
 * 命名映射：MCP 工具名不允许 "."，导出时 "skill.action" → "skill__action"，
 * 调用时还原（仅替换第一个 "__"）。
 */

import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import type { ISkillRegistry } from '../skills/registry.js';
import type { Logger, MemoryAccess, SkillContext, ToolDefinition } from '../types.js';

/** "skill.action" → MCP 合法工具名 */
export function toolToMcpName(toolName: string): string {
    return toolName.replace(/\./g, '__');
}

/** MCP 工具名 → "skill.action"（仅还原第一个分隔符，动作名可含下划线）*/
export function mcpNameToTool(mcpName: string): string {
    return mcpName.replace('__', '.');
}

/** ToolDefinition[] → MCP tools/list 响应条目 */
export function buildMcpToolList(defs: ToolDefinition[]): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}> {
    return defs.map(d => ({
        name: toolToMcpName(d.function.name),
        description: d.function.description,
        inputSchema: (d.function.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
    }));
}

export interface McpServerRouteOptions {
    registry: ISkillRegistry;
    logger: Logger;
    /** 为每个 MCP 会话提供 MemoryAccess（通常桥接 SessionMemoryManager）*/
    getMemory: (sessionId: string) => MemoryAccess;
    /** 服务器名称/版本（initialize 响应中展示）*/
    serverInfo?: { name: string; version: string };
}

/**
 * 注册 MCP Server 路由（无状态 Streamable HTTP）
 *
 * 无状态模式：每个 POST 请求创建独立 Server+Transport，无需会话粘性，
 * 天然适配负载均衡与 Serverless 部署；GET/DELETE 返回 405（无 SSE 长连接）。
 */
export function registerMcpServerRoutes(app: FastifyInstance, opts: McpServerRouteOptions): void {
    const { registry, logger, getMemory } = opts;
    const serverInfo = opts.serverInfo ?? { name: 'cmaster-bot', version: '0.1.0' };

    app.post('/mcp', async (request, reply) => {
        // 动态加载 SDK 服务端模块（与客户端 McpSkillSource 共享同一依赖）
        const [{ Server }, { StreamableHTTPServerTransport }, types] = await Promise.all([
            import('@modelcontextprotocol/sdk/server/index.js'),
            import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
            import('@modelcontextprotocol/sdk/types.js'),
        ]);

        const server = new Server(serverInfo, { capabilities: { tools: {} } });

        server.setRequestHandler(types.ListToolsRequestSchema, async () => {
            const defs = await registry.getToolDefinitions();
            return { tools: buildMcpToolList(defs) };
        });

        server.setRequestHandler(types.CallToolRequestSchema, async (req) => {
            const toolName = mcpNameToTool(req.params.name);
            const sessionId = `mcp-${nanoid(8)}`;
            const ctx: SkillContext = {
                sessionId,
                memory: getMemory(sessionId),
                logger,
                config: {},
            };

            logger.info(`[mcp-server] Tool call: ${toolName} (session ${sessionId})`);
            const result = await registry.executeAction(
                toolName,
                (req.params.arguments as Record<string, unknown>) ?? {},
                ctx
            );

            if (result.kind === 'ok') {
                return { content: [{ type: 'text' as const, text: result.value }] };
            }
            return {
                content: [{ type: 'text' as const, text: `Error: ${result.message}` }],
                isError: true,
            };
        });

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // 无状态模式
        });

        reply.raw.on('close', () => {
            transport.close().catch(() => {});
            server.close().catch(() => {});
        });

        await server.connect(transport);
        // Fastify 已解析 body，透传给 transport；之后由 transport 接管原始响应流
        await transport.handleRequest(request.raw, reply.raw, request.body);
        reply.hijack();
    });

    // 无状态模式不维护 SSE 长连接与会话
    const methodNotAllowed = async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
        reply.code(405).send({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Method not allowed (stateless MCP server)' },
            id: null,
        });
    app.get('/mcp', methodNotAllowed as never);
    app.delete('/mcp', methodNotAllowed as never);

    logger.info('[mcp-server] MCP Server mode enabled at POST /mcp (stateless streamable HTTP)');
}
