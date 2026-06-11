import { describe, it, expect } from 'vitest';
import { toolToMcpName, mcpNameToTool, buildMcpToolList } from '../src/gateway/mcp-server.js';
import type { ToolDefinition } from '../src/types.js';

describe('U6: MCP Server mode', () => {
    describe('tool name mapping', () => {
        it('should convert skill.action to MCP-safe name', () => {
            expect(toolToMcpName('shell.execute')).toBe('shell__execute');
            expect(toolToMcpName('file-manager.read_file')).toBe('file-manager__read_file');
        });

        it('should restore original tool name (first separator only)', () => {
            expect(mcpNameToTool('shell__execute')).toBe('shell.execute');
            // 动作名自身的下划线不受影响
            expect(mcpNameToTool('file-manager__read_file')).toBe('file-manager.read_file');
        });

        it('round-trips for typical skill tools', () => {
            for (const name of ['shell.execute', 'http-client.get', 'knowledge-base.list_updated_pages']) {
                expect(mcpNameToTool(toolToMcpName(name))).toBe(name);
            }
        });
    });

    describe('buildMcpToolList', () => {
        it('should map ToolDefinition to MCP tool entries', () => {
            const defs: ToolDefinition[] = [
                {
                    type: 'function',
                    function: {
                        name: 'shell.execute',
                        description: '执行 shell 命令',
                        parameters: {
                            type: 'object',
                            properties: { command: { type: 'string' } },
                            required: ['command'],
                        },
                    },
                },
            ];
            const tools = buildMcpToolList(defs);
            expect(tools).toHaveLength(1);
            expect(tools[0].name).toBe('shell__execute');
            expect(tools[0].description).toBe('执行 shell 命令');
            expect(tools[0].inputSchema).toMatchObject({ type: 'object' });
        });

        it('should default missing parameters to empty object schema', () => {
            const defs = [{
                type: 'function',
                function: { name: 'a.b', description: 'd', parameters: undefined },
            }] as unknown as ToolDefinition[];
            const tools = buildMcpToolList(defs);
            expect(tools[0].inputSchema).toEqual({ type: 'object', properties: {} });
        });
    });
});
