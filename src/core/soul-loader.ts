import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import type { Logger } from '../types.js';
import type { MultiAgentOrchestrator, WorkerAgentConfig } from './multi-agent.js';
import { Agent } from './agent.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { LLMAdapter } from '../types.js';

export interface SoulMetadata {
    name: string;
    version: string;
    description: string;
    skills?: string[];
    systemPrompt?: string;
}

/**
 * SOUL.md 加载器 — Phase 21
 * 扫描 agents/ 目录中的 SOUL.md，动态注册 Worker Agent
 */
export class SoulLoader {
    constructor(
        private orchestrator: MultiAgentOrchestrator,
        private skillRegistry: SkillRegistry,
        private llmGetter: () => LLMAdapter,
        private logger: Logger
    ) {}

    /**
     * 扫描目录下所有 SOUL.md，解析并注册 Worker
     */
    async loadAgents(dir: string): Promise<number> {
        if (!existsSync(dir)) {
            this.logger.debug(`[soul-loader] agents directory not found: ${dir}`);
            return 0;
        }

        let loaded = 0;

        let entries: import('fs').Dirent[];
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            this.logger.warn(`[soul-loader] Failed to read agents directory: ${dir}`);
            return 0;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const agentDir = join(dir, entry.name);
            const soulMdPath = join(agentDir, 'SOUL.md');

            if (!existsSync(soulMdPath)) {
                this.logger.debug(`[soul-loader] No SOUL.md in ${agentDir}, skipping`);
                continue;
            }

            try {
                const soul = await this.parseSoulMd(soulMdPath);
                await this.registerWorker(soul);
                loaded++;
                this.logger.info(`[soul-loader] Loaded worker agent: ${soul.name} (${soul.description})`);
            } catch (err) {
                this.logger.warn(`[soul-loader] Failed to load ${soulMdPath}: ${(err as Error).message}`);
            }
        }

        this.logger.info(`[soul-loader] Loaded ${loaded} worker agent(s) from ${dir}`);
        return loaded;
    }

    private async parseSoulMd(filePath: string): Promise<SoulMetadata> {
        const content = await readFile(filePath, 'utf-8');
        const { data } = matter(content);

        if (!data.name) {
            throw new Error(`SOUL.md at ${filePath} missing required field: name`);
        }

        return {
            name: data.name,
            version: data.version ?? '1.0.0',
            description: data.description ?? '',
            skills: Array.isArray(data.skills) ? data.skills : [],
            systemPrompt: typeof data.systemPrompt === 'string' ? data.systemPrompt : '',
        };
    }

    private async registerWorker(soul: SoulMetadata): Promise<void> {
        const config: WorkerAgentConfig = {
            id: soul.name,
            name: soul.name,
            description: soul.description,
            systemPrompt: soul.systemPrompt ?? `你是 ${soul.name}，${soul.description}`,
            skills: soul.skills,
        };

        // 创建共享 LLM 但独立 Agent 实例
        const workerAgent = new Agent({
            llm: this.llmGetter,
            skillRegistry: this.skillRegistry,
            logger: this.logger,
            maxIterations: 8,
        });

        this.orchestrator.registerWorker(config, workerAgent);
    }
}
