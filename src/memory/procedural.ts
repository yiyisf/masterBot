/**
 * Phase 6: L4 Procedural Memory
 * 加载 SOUL.md / AGENTS.md / SKILL.md，注入 system prompt，支持热重载。
 */

import { readFile, watch } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { Logger } from '../types.js';
import type { ProceduralRule } from './types.js';

export class ProceduralMemory {
    /** scope → rule content cache */
    private cache = new Map<string, ProceduralRule>();
    /** 全局规则（所有 agent 共享） */
    private globalRules: string[] = [];
    /** agentId → 该 agent 专属规则内容（热路径用，无需 existsSync） */
    private agentRules = new Map<string, string>();
    private watching = false;

    constructor(
        private baseDir: string,
        private logger: Logger,
    ) {}

    /**
     * 启动时加载所有规则并开启热重载 watcher。
     */
    async initialize(): Promise<void> {
        await this.loadAll();
        this.startWatcher();
    }

    private async loadAll(): Promise<void> {
        const globalSources = [
            { path: join(this.baseDir, 'AGENTS.md'), scope: '*' },
            { path: join(this.baseDir, 'agents/SOUL.md'), scope: '*' },
        ];

        this.globalRules = [];
        for (const { path: filePath, scope } of globalSources) {
            if (existsSync(filePath)) {
                const content = await readFile(filePath, 'utf-8');
                this.globalRules.push(content);
                this.cache.set(scope + ':' + filePath, {
                    scope, tenantId: '*', content, source: filePath, loadedAt: Date.now(),
                });
                this.logger.debug(`[procedural] Loaded ${filePath}`);
            }
        }

        // Pre-load all agent-specific SOUL.md files into agentRules cache
        this.agentRules.clear();
        const agentsDir = join(this.baseDir, 'agents');
        if (existsSync(agentsDir)) {
            const { readdirSync, statSync } = await import('fs');
            try {
                for (const entry of readdirSync(agentsDir)) {
                    const agentSoulPath = join(agentsDir, entry, 'SOUL.md');
                    if (statSync(join(agentsDir, entry)).isDirectory() && existsSync(agentSoulPath)) {
                        const content = await readFile(agentSoulPath, 'utf-8');
                        this.agentRules.set(entry, content);
                        this.cache.set(entry + ':' + agentSoulPath, {
                            scope: entry, tenantId: '*', content, source: agentSoulPath, loadedAt: Date.now(),
                        });
                        this.logger.debug(`[procedural] Loaded agent soul: ${agentSoulPath}`);
                    }
                }
            } catch { /* ignore scan errors */ }
        }
    }

    private startWatcher(): void {
        if (this.watching) return;
        this.watching = true;

        // Watch agent dir for SOUL.md changes
        const agentDir = join(this.baseDir, 'agents');
        if (!existsSync(agentDir)) return;

        // watch() from fs/promises returns an AsyncIterable directly (not a Promise)
        const self = this;
        (async () => {
            try {
                const watcher = watch(agentDir, { recursive: true });
                for await (const event of watcher) {
                    if (event.filename?.endsWith('.md')) {
                        self.logger.info(`[procedural] File changed: ${event.filename}, reloading`);
                        await self.loadAll();
                    }
                }
            } catch { /* watcher unavailable on some platforms */ }
        })();
    }

    /**
     * 获取指定 scope 的规则内容（注入 system prompt 用）。
     * scope = agent id 时先查 agent 专属规则，再加全局规则。
     * 纯内存查找，无 I/O。
     */
    getRules(scope: string, _tenantId: string): string {
        const parts: string[] = [];

        // Global rules
        if (this.globalRules.length > 0) {
            parts.push(this.globalRules.join('\n\n---\n\n'));
        }

        // Agent-specific SOUL.md (from in-memory cache, no I/O)
        const agentContent = this.agentRules.get(scope);
        if (agentContent) parts.push(agentContent);

        return parts.join('\n\n---\n\n').trim();
    }

    getCachedRules(): ProceduralRule[] {
        return [...this.cache.values()];
    }
}
