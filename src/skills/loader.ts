import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import type { Skill, SkillAction, Logger } from '../types.js';
import { parseSkillMd, SkillRegistry } from './registry.js';

/**
 * 技能加载器
 * 负责从文件系统加载技能
 */
export class SkillLoader {
    private logger: Logger;
    private registry: SkillRegistry;

    constructor(registry: SkillRegistry, logger: Logger) {
        this.registry = registry;
        this.logger = logger;
    }

    /**
     * 从目录加载所有技能
     */
    async loadFromDirectories(directories: string[]): Promise<void> {
        for (const dir of directories) {
            const resolvedDir = resolve(dir);
            if (!existsSync(resolvedDir)) {
                this.logger.warn(`Skill directory not found: ${resolvedDir}`);
                continue;
            }

            await this.loadDirectory(resolvedDir);
        }
    }

    /**
     * 加载单个目录中的技能
     */
    private async loadDirectory(directory: string): Promise<void> {
        const entries = await readdir(directory, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skillDir = join(directory, entry.name);
            const skillMdPath = join(skillDir, 'SKILL.md');

            if (!existsSync(skillMdPath)) {
                this.logger.debug(`No SKILL.md found in ${skillDir}, skipping`);
                continue;
            }

            try {
                await this.loadSkill(skillDir);
            } catch (error) {
                this.logger.error(`Failed to load skill from ${skillDir}: ${error}`);
            }
        }
    }

    /**
     * 加载单个技能
     */
    async loadSkill(skillDir: string): Promise<Skill> {
        const skillMdPath = join(skillDir, 'SKILL.md');

        // 解析 SKILL.md
        const parsed = await parseSkillMd(skillMdPath);
        this.logger.debug(`Parsed SKILL.md: ${parsed.metadata.name}`);

        // 加载实现文件
        const indexPath = join(skillDir, 'index.ts');
        const indexJsPath = join(skillDir, 'index.js');

        let implementation: Record<string, unknown> = {};

        if (existsSync(indexPath) || existsSync(indexJsPath)) {
            const modulePath = existsSync(indexJsPath) ? indexJsPath : indexPath;
            try {
                // 动态导入模块
                const moduleUrl = pathToFileURL(modulePath).href;
                implementation = await import(moduleUrl);
            } catch (error) {
                this.logger.warn(`Could not load implementation for ${parsed.metadata.name}: ${error}`);
            }
        }

        // 构建技能对象
        const actions = new Map<string, SkillAction>();

        for (const actionDef of parsed.actions) {
            const handler = (implementation[actionDef.name] as SkillAction['handler'])
                || (implementation.default as Record<string, SkillAction['handler']>)?.[actionDef.name]
                || this.createPlaceholderHandler(actionDef.name);

            actions.set(actionDef.name, {
                name: actionDef.name,
                description: actionDef.description,
                parameters: Object.fromEntries(
                    Object.entries(actionDef.parameters).map(([k, v]) => [
                        k,
                        {
                            type: v.type as 'string' | 'number' | 'boolean' | 'object' | 'array',
                            description: v.description,
                            required: v.required,
                        },
                    ])
                ),
                handler,
            });
        }

        const skill: Skill = {
            metadata: parsed.metadata,
            actions,
            init: implementation.init as Skill['init'],
            destroy: implementation.destroy as Skill['destroy'],
        };

        // 初始化技能
        if (skill.init) {
            await skill.init();
        }

        // 注册技能
        this.registry.register(skill);

        return skill;
    }

    /**
     * 创建占位符处理器（当实现未找到时）
     */
    private createPlaceholderHandler(actionName: string): SkillAction['handler'] {
        return async () => {
            throw new Error(`Action "${actionName}" is not implemented`);
        };
    }

    /**
     * 重新加载技能
     */
    async reloadSkill(skillDir: string): Promise<Skill> {
        const skillMdPath = join(skillDir, 'SKILL.md');
        const parsed = await parseSkillMd(skillMdPath);

        // 卸载旧版本
        await this.registry.unregister(parsed.metadata.name);

        // 加载新版本
        return this.loadSkill(skillDir);
    }
}
