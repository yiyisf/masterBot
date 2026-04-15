/**
 * SoulLoader — SOUL.md Agent 规格加载器
 * Phase 23 升级：解析完整 AgentSpec（含 tools/resources/memory/hooks/outcome）
 * 兼容旧格式（仅含 name/description/skills 的简单 frontmatter）
 */

import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import type { Logger } from '../types.js';
import type { AgentPool } from './harness/agent-pool.js';
import { defaultAgentSpec, type AgentSpec } from './harness/agent-spec.js';
import type { OutcomeSpec } from './harness/outcome-spec.js';

export class SoulLoader {
    constructor(
        private pool: AgentPool,
        private logger: Logger
    ) {}

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
            const soulMdPath = join(dir, entry.name, 'SOUL.md');
            if (!existsSync(soulMdPath)) continue;

            try {
                const spec = await this.parseSoulMd(soulMdPath, entry.name);
                this.pool.registerSpec(spec);
                loaded++;
                this.logger.info(`[soul-loader] Loaded agent: ${spec.name} v${spec.version}`);
            } catch (err) {
                this.logger.warn(`[soul-loader] Failed to load ${soulMdPath}: ${(err as Error).message}`);
            }
        }

        this.logger.info(`[soul-loader] Loaded ${loaded} agent spec(s) from ${dir}`);
        return loaded;
    }

    async parseSoulMd(filePath: string, fallbackId?: string): Promise<AgentSpec> {
        const content = await readFile(filePath, 'utf-8');
        const { data: fm } = matter(content);

        const id: string = fm.id ?? fm.name ?? fallbackId ?? 'unknown';

        // 兼容旧格式
        if (!fm.tools && !fm.resources && !fm.memory && !fm.hooks && !fm.outcome) {
            const legacySkills: string[] = Array.isArray(fm.skills) ? fm.skills : [];
            return defaultAgentSpec({
                id,
                name: fm.name ?? id,
                version: fm.version ?? '1.0.0',
                description: fm.description ?? '',
                systemPrompt: fm.systemPrompt ?? `你是 ${fm.name ?? id}，${fm.description ?? '专业 AI 助手'}。`,
                tools: legacySkills.length > 0
                    ? { allow: legacySkills.map((s: string) => `${s}.*`), deny: [] }
                    : { allow: [], deny: [] },
            });
        }

        const tools = fm.tools ?? { allow: [], deny: [] };
        const resources = fm.resources ?? {};
        const memory = fm.memory ?? {};
        const hooks = fm.hooks ?? {};

        // 歸一化 YAML hook 格式：SOUL.md 可直接寫 `message:` / `command:` 等頂層屬性，
        // 解析時統一包裝進 config: {} 以符合 HookDef 類型
        const normalizeHooks = (list: any[] | undefined): any[] | undefined => {
            if (!Array.isArray(list)) return list;
            return list.map((h: any) => {
                if (!h || h.config !== undefined) return h; // 已是標準格式
                const { type, ...rest } = h;
                return { type, config: rest };
            });
        };

        const outcomeRaw = fm.outcome;

        const outcome: OutcomeSpec | undefined = outcomeRaw ? {
            criteria: (outcomeRaw.criteria ?? []).map((c: any) => ({
                id: c.id,
                description: c.description,
                weight: c.weight ?? 5,
                required: c.required ?? false,
            })),
            grader: {
                provider: outcomeRaw.grader?.provider,
                maxRevisions: outcomeRaw.grader?.maxRevisions ?? 2,
                minScore: outcomeRaw.grader?.minScore ?? 75,
            },
        } : undefined;

        return defaultAgentSpec({
            id,
            name: fm.name ?? id,
            version: fm.version ?? '1.0.0',
            description: fm.description ?? '',
            systemPrompt: fm.systemPrompt ?? `你是 ${fm.name ?? id}，${fm.description ?? '专业 AI 助手'}。`,
            tools: {
                allow: Array.isArray(tools.allow) ? tools.allow : [],
                deny: Array.isArray(tools.deny) ? tools.deny : [],
            },
            resources: {
                maxIterations: resources.maxIterations ?? 10,
                timeoutMs: resources.timeoutMs ?? 60_000,
                concurrency: resources.concurrency ?? 3,
            },
            memory: {
                namespace: memory.namespace ?? id,
                scope: memory.scope ?? 'isolated',
                allowRemember: memory.allowRemember !== false,
                allowRecall: memory.allowRecall !== false,
                allowKnowledgeSearch: memory.allowKnowledgeSearch !== false,
            },
            hooks: {
                onStart: normalizeHooks(hooks.onStart),
                onToolCall: normalizeHooks(hooks.onToolCall),
                onToolResult: normalizeHooks(hooks.onToolResult),
                onComplete: normalizeHooks(hooks.onComplete),
                onError: normalizeHooks(hooks.onError),
            },
            outcome,
        });
    }
}
