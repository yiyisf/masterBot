/**
 * Task 3: createMasterBotMcpServer
 * 将现有 SKILL.md 技能包装成 SDK 的 in-process MCP Server。
 * 使用 createSdkMcpServer + tool()，保护所有 SKILL.md 技能投资。
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { ISkillRegistry } from './registry.js';
import type { Logger, MemoryAccess } from '../types.js';

/**
 * 将 ToolDefinition.parameters JSON Schema 转换为 Zod schema（简化版）。
 * 仅处理 string / number / boolean / object 基础类型，足够覆盖大多数 SKILL.md 工具。
 */
function jsonSchemaToZod(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
    const properties = (schema['properties'] as Record<string, Record<string, unknown>>) ?? {};
    const required = (schema['required'] as string[]) ?? [];
    const result: Record<string, z.ZodTypeAny> = {};

    for (const [key, prop] of Object.entries(properties)) {
        let zodType: z.ZodTypeAny;
        switch (prop['type']) {
            case 'number':
            case 'integer':
                zodType = z.number();
                break;
            case 'boolean':
                zodType = z.boolean();
                break;
            case 'array':
                zodType = z.array(z.unknown());
                break;
            case 'object':
                zodType = z.record(z.unknown());
                break;
            default:
                zodType = z.string();
        }

        if (prop['description']) zodType = zodType.describe(prop['description'] as string);
        if (!required.includes(key)) zodType = zodType.optional() as z.ZodTypeAny;

        result[key] = zodType;
    }

    return result;
}

/**
 * 创建包装了 masterBot 所有 SKILL.md 技能的 in-process MCP Server 配置。
 * 返回值可直接放入 `query({ options: { mcpServers: { masterbot: <返回值> } } })`。
 */
export async function createMasterBotMcpServer(
    skillRegistry: ISkillRegistry,
    context: {
        sessionId: string;
        userId: string;
        tenantId: string;
        memory: MemoryAccess;
    },
    logger: Logger,
) {
    const toolDefs = await skillRegistry.getToolDefinitions();

    const sdkTools = toolDefs.map(def => {
        const fnDef = def.function;
        const zodShape = jsonSchemaToZod(
            (fnDef.parameters as Record<string, unknown>) ?? { properties: {}, required: [] }
        );

        return tool(
            fnDef.name,
            fnDef.description ?? '',
            zodShape,
            async (args) => {
                try {
                    const result = await skillRegistry.executeAction(fnDef.name, args as Record<string, unknown>, {
                        sessionId: context.sessionId,
                        userId: context.userId,
                        memory: context.memory,
                        logger,
                        config: {},
                    });

                    if (result.kind === 'ok') {
                        return { content: [{ type: 'text' as const, text: result.value }] };
                    }
                    return {
                        content: [{ type: 'text' as const, text: `Error: ${result.message}` }],
                        isError: true,
                    };
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    logger.error?.(`[sdk-mcp-wrapper] tool=${fnDef.name} error: ${msg}`);
                    return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
                }
            },
        );
    });

    logger.info?.(`[sdk-mcp-wrapper] 包装了 ${sdkTools.length} 个 SKILL.md 技能为 MCP Server`);

    return createSdkMcpServer({
        name: 'masterbot-skills',
        version: '1.0.0',
        tools: sdkTools,
    });
}
