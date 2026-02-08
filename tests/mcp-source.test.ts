import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServerConfig, Logger } from '../src/types.js';

// vi.hoisted runs before vi.mock hoisting, so these are available in mock factories
const { mockClient, mockStdioTransport, mockSSETransport } = vi.hoisted(() => {
    const mockClient = {
        connect: vi.fn(),
        close: vi.fn(),
        listTools: vi.fn().mockResolvedValue({
            tools: [
                {
                    name: 'read_file',
                    description: 'Read a file from the filesystem',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path' }
                        },
                        required: ['path']
                    }
                },
                {
                    name: 'write_file',
                    description: 'Write content to a file',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                            content: { type: 'string' }
                        },
                        required: ['path', 'content']
                    }
                }
            ]
        }),
        callTool: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'file contents here' }]
        }),
    };

    const mockStdioTransport = vi.fn(function MockStdio() {});
    const mockSSETransport = vi.fn(function MockSSE() {});

    return { mockClient, mockStdioTransport, mockSSETransport };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: function MockClient() { return mockClient; },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: mockStdioTransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
    SSEClientTransport: mockSSETransport,
}));

import { McpSkillSource } from '../src/skills/mcp-source.js';

const mockLogger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

const stdioConfig: McpServerConfig = {
    id: 'test-1',
    name: 'filesystem',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    enabled: true,
};

const sseConfig: McpServerConfig = {
    id: 'test-2',
    name: 'remote-tools',
    type: 'sse',
    url: 'http://localhost:8080/sse',
    enabled: true,
};

describe('McpSkillSource', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Restore default mock behaviors after clearAllMocks
        mockClient.listTools.mockResolvedValue({
            tools: [
                {
                    name: 'read_file',
                    description: 'Read a file from the filesystem',
                    inputSchema: {
                        type: 'object',
                        properties: { path: { type: 'string' } },
                        required: ['path']
                    }
                },
                {
                    name: 'write_file',
                    description: 'Write content to a file',
                    inputSchema: {
                        type: 'object',
                        properties: { path: { type: 'string' }, content: { type: 'string' } },
                        required: ['path', 'content']
                    }
                }
            ]
        });
        mockClient.callTool.mockResolvedValue({
            content: [{ type: 'text', text: 'file contents here' }]
        });
    });

    describe('constructor', () => {
        it('should set name with mcp- prefix', () => {
            const source = new McpSkillSource(stdioConfig, mockLogger);
            expect(source.name).toBe('mcp-filesystem');
            expect(source.type).toBe('mcp');
        });
    });

    describe('initialize', () => {
        it('should create stdio transport and connect', async () => {
            const source = new McpSkillSource(stdioConfig, mockLogger);
            await source.initialize();

            expect(mockStdioTransport).toHaveBeenCalledWith({
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
            });
            expect(mockClient.connect).toHaveBeenCalled();
        });

        it('should create SSE transport for sse type', async () => {
            const source = new McpSkillSource(sseConfig, mockLogger);
            await source.initialize();

            expect(mockSSETransport).toHaveBeenCalledWith(new URL('http://localhost:8080/sse'));
        });

        it('should throw for stdio without command', async () => {
            const badConfig: McpServerConfig = {
                ...stdioConfig,
                command: undefined,
            };
            const source = new McpSkillSource(badConfig, mockLogger);
            await expect(source.initialize()).rejects.toThrow("requires 'command'");
        });

        it('should throw for sse without url', async () => {
            const badConfig: McpServerConfig = {
                ...sseConfig,
                url: undefined,
            };
            const source = new McpSkillSource(badConfig, mockLogger);
            await expect(source.initialize()).rejects.toThrow("requires 'url'");
        });
    });

    describe('getTools', () => {
        it('should return mapped tool definitions with prefixed names', async () => {
            const source = new McpSkillSource(stdioConfig, mockLogger);
            await source.initialize();

            const tools = await source.getTools();
            expect(tools).toHaveLength(2);
            expect(tools[0].type).toBe('function');
            expect(tools[0].function.name).toBe('mcp-filesystem.read_file');
            expect(tools[0].function.description).toBe('Read a file from the filesystem');
            expect(tools[1].function.name).toBe('mcp-filesystem.write_file');
        });

        it('should return empty array when not connected', async () => {
            const source = new McpSkillSource(stdioConfig, mockLogger);
            const tools = await source.getTools();
            expect(tools).toEqual([]);
        });
    });

    describe('execute', () => {
        it('should call tool with stripped prefix', async () => {
            const source = new McpSkillSource(stdioConfig, mockLogger);
            await source.initialize();

            const result = await source.execute(
                'mcp-filesystem.read_file',
                { path: '/tmp/test.txt' },
                { sessionId: 's1', memory: {} as any, logger: mockLogger, config: {} }
            );

            expect(mockClient.callTool).toHaveBeenCalledWith({
                name: 'read_file',
                arguments: { path: '/tmp/test.txt' },
            });
            expect(result).toBe('file contents here');
        });

        it('should throw when not connected', async () => {
            const source = new McpSkillSource(stdioConfig, mockLogger);
            await expect(
                source.execute('mcp-filesystem.read_file', {}, {} as any)
            ).rejects.toThrow('not connected');
        });
    });

    describe('destroy', () => {
        it('should close client and clear tools', async () => {
            const source = new McpSkillSource(stdioConfig, mockLogger);
            await source.initialize();

            expect((await source.getTools()).length).toBeGreaterThan(0);

            await source.destroy();

            expect(mockClient.close).toHaveBeenCalled();
            expect(await source.getTools()).toEqual([]);
        });
    });

    describe('connection failure handling', () => {
        it('should throw on connection failure and schedule reconnect', async () => {
            mockClient.connect.mockRejectedValueOnce(new Error('Connection refused'));

            const source = new McpSkillSource(stdioConfig, mockLogger);
            await expect(source.initialize()).rejects.toThrow('Connection refused');

            // Should schedule reconnect
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('reconnecting')
            );

            // Cleanup timer
            await source.destroy();
        });
    });
});
