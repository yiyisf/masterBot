import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { glob } from 'glob';
import matter from 'gray-matter';
import type { Skill, SkillMetadata, SkillAction, SkillContext, SkillSource, ToolDefinition, Logger } from '../types.js';

/**
 * SKILL.md 解析器
 * 解析 SKILL.md 文件中的元数据和 action 定义
 */
export interface ParsedSkillMd {
    metadata: SkillMetadata;
    actions: Array<{
        name: string;
        description: string;
        parameters: Record<string, {
            type: string;
            description?: string;
            required?: boolean;
        }>;
    }>;
    content: string;
}

/**
 * 解析 SKILL.md 文件
 */
export async function parseSkillMd(filePath: string): Promise<ParsedSkillMd> {
    const content = await readFile(filePath, 'utf-8');
    const { data: frontmatter, content: body } = matter(content);

    const metadata: SkillMetadata = {
        name: frontmatter.name || basename(dirname(filePath)),
        version: frontmatter.version || '1.0.0',
        description: frontmatter.description || '',
        author: frontmatter.author,
        dependencies: frontmatter.dependencies,
    };

    // 解析 markdown 中的 actions
    const actions = parseActionsFromMarkdown(body);

    return { metadata, actions, content: body };
}

/**
 * 从 markdown 内容中解析 actions
 * 支持 ## Actions 下的 ### action_name 格式
 */
function parseActionsFromMarkdown(content: string): ParsedSkillMd['actions'] {
    const actions: ParsedSkillMd['actions'] = [];

    // 匹配 ### action_name 开始的 action 定义
    const actionRegex = /###\s+(\w+)\s*\n([\s\S]*?)(?=###\s+\w+|\n##\s+|$)/g;

    let match;
    while ((match = actionRegex.exec(content)) !== null) {
        const name = match[1];
        const body = match[2];

        // 提取描述 (第一行非空文本)
        const descMatch = body.match(/^([^\n-*]+)/m);
        const description = descMatch ? descMatch[1].trim() : '';

        // 解析参数
        const parameters: ParsedSkillMd['actions'][0]['parameters'] = {};
        const paramRegex = /[-*]\s+\*\*(?:参数|参数名)?[:：]?\s*\*\*[:：]?\s*`(\w+)`\s*\((\w+)\)\s*[-–]?\s*(.*)/g;
        const altParamRegex = /[-*]\s+`(\w+)`\s*\((\w+)\)\s*[-–]?\s*(.*)/g;

        let paramMatch;
        while ((paramMatch = paramRegex.exec(body)) !== null) {
            parameters[paramMatch[1]] = {
                type: paramMatch[2],
                description: paramMatch[3]?.trim(),
                required: !paramMatch[3]?.includes('可选'),
            };
        }
        while ((paramMatch = altParamRegex.exec(body)) !== null) {
            if (!parameters[paramMatch[1]]) {
                parameters[paramMatch[1]] = {
                    type: paramMatch[2],
                    description: paramMatch[3]?.trim(),
                    required: true,
                };
            }
        }

        actions.push({ name, description, parameters });
    }

    return actions;
}

/**
 * 技能注册中心 (Registry 2.0)
 * 管理多源技能接入 (Local + MCP)
 */
export class SkillRegistry {
    private sources: Map<string, SkillSource> = new Map();
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * 注册技能源
     */
    async registerSource(source: SkillSource): Promise<void> {
        if (this.sources.has(source.name)) {
            this.logger.warn(`Skill source "${source.name}" already registered, overwriting`);
            const old = this.sources.get(source.name);
            if (old?.destroy) await old.destroy();
        }

        try {
            await source.initialize();
            this.sources.set(source.name, source);
            this.logger.info(`Registered skill source: ${source.name} (${source.type})`);
        } catch (error) {
            this.logger.error(`Failed to register source ${source.name}: ${error}`);
            throw error;
        }
    }

    /**
     * 获取所有聚合的工具定义 (JSON Schema)
     */
    async getToolDefinitions(): Promise<Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
        };
    }>> {
        const tools: Array<any> = [];

        for (const source of this.sources.values()) {
            try {
                const sourceTools = await source.getTools();
                tools.push(...sourceTools);
            } catch (error) {
                this.logger.error(`Failed to get tools from source ${source.name}: ${error}`);
            }
        }

        return tools;
    }

    /**
     * 搜索工具 (支持简单的文本匹配，未来可扩展为向量检索)
     */
    async searchTools(query: string): Promise<Array<any>> {
        const allTools = await this.getToolDefinitions();
        const lowerQuery = query.toLowerCase();

        return allTools.filter(tool => {
            const nameMatch = tool.function.name.toLowerCase().includes(lowerQuery);
            const descMatch = tool.function.description.toLowerCase().includes(lowerQuery);
            return nameMatch || descMatch;
        });
    }

    /**
     * 统一执行入口
     */
    async executeAction(
        toolName: string,
        params: Record<string, unknown>,
        context: SkillContext
    ): Promise<unknown> {
        // Find which source owns this tool
        // Optimization: We could cache tool->source mapping, but for now we search
        for (const source of this.sources.values()) {
            try {
                const tools = await source.getTools();
                const found = tools.find(t => t.function.name === toolName);

                if (found) {
                    return await source.execute(toolName, params, context);
                }
            } catch (error) {
                this.logger.warn(`Error searching tool in source ${source.name}: ${error}`);
            }
        }

        throw new Error(`Tool "${toolName}" not found in any registered source`);
    }

    /**
     * 卸载源
     */
    async unregisterSource(name: string): Promise<void> {
        const source = this.sources.get(name);
        if (source) {
            if (source.destroy) await source.destroy();
            this.sources.delete(name);
            this.logger.info(`Unregistered source: ${name}`);
        }
    }

    /**
     * 清理所有
     */
    async unregisterAll(): Promise<void> {
        for (const [name, source] of this.sources) {
            if (source.destroy) await source.destroy();
        }
        this.sources.clear();
    }

    // Legacy support for direct skill access if needed, or remove
    getAllSources(): SkillSource[] {
        return Array.from(this.sources.values());
    }
}
