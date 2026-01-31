import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { glob } from 'glob';
import matter from 'gray-matter';
import type { Skill, SkillMetadata, SkillAction, SkillContext, Logger } from '../types.js';

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
        const paramRegex = /[-*]\s+\*\*(?:参数|参数名)?[:：]?\s*\*\*\s*`(\w+)`\s*\((\w+)\)\s*[-–]?\s*(.*)/g;
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
 * 技能注册中心
 * 管理所有已加载的技能
 */
export class SkillRegistry {
    private skills: Map<string, Skill> = new Map();
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * 注册技能
     */
    register(skill: Skill): void {
        if (this.skills.has(skill.metadata.name)) {
            this.logger.warn(`Skill "${skill.metadata.name}" already registered, overwriting`);
        }
        this.skills.set(skill.metadata.name, skill);
        this.logger.info(`Registered skill: ${skill.metadata.name} v${skill.metadata.version}`);
    }

    /**
     * 获取技能
     */
    get(name: string): Skill | undefined {
        return this.skills.get(name);
    }

    /**
     * 获取所有技能
     */
    getAll(): Skill[] {
        return Array.from(this.skills.values());
    }

    /**
     * 获取所有技能的 action 作为工具定义
     */
    getToolDefinitions(): Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
        };
    }> {
        const tools: Array<{
            type: 'function';
            function: {
                name: string;
                description: string;
                parameters: Record<string, unknown>;
            };
        }> = [];

        for (const skill of this.skills.values()) {
            for (const [actionName, action] of skill.actions) {
                tools.push({
                    type: 'function',
                    function: {
                        name: `${skill.metadata.name}.${actionName}`,
                        description: action.description,
                        parameters: {
                            type: 'object',
                            properties: Object.fromEntries(
                                Object.entries(action.parameters).map(([key, param]) => [
                                    key,
                                    {
                                        type: param.type,
                                        description: param.description,
                                    },
                                ])
                            ),
                            required: Object.entries(action.parameters)
                                .filter(([_, p]) => p.required)
                                .map(([k]) => k),
                        },
                    },
                });
            }
        }

        return tools;
    }

    /**
     * 执行技能 action
     */
    async executeAction(
        skillName: string,
        actionName: string,
        params: Record<string, unknown>,
        context: SkillContext
    ): Promise<unknown> {
        const skill = this.skills.get(skillName);
        if (!skill) {
            throw new Error(`Skill "${skillName}" not found`);
        }

        const action = skill.actions.get(actionName);
        if (!action) {
            throw new Error(`Action "${actionName}" not found in skill "${skillName}"`);
        }

        return action.handler(context, params);
    }

    /**
     * 卸载技能
     */
    async unregister(name: string): Promise<void> {
        const skill = this.skills.get(name);
        if (skill?.destroy) {
            await skill.destroy();
        }
        this.skills.delete(name);
        this.logger.info(`Unregistered skill: ${name}`);
    }

    /**
     * 卸载所有技能
     */
    async unregisterAll(): Promise<void> {
        for (const [name, skill] of this.skills) {
            if (skill.destroy) {
                await skill.destroy();
            }
            this.logger.info(`Unregistered skill: ${name}`);
        }
        this.skills.clear();
    }
}
