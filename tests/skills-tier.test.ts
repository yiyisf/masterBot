/**
 * Phase 4: Skills Tier 系统测试
 * 验证 SKILL.md tier/category 元数据正确加载，以及 sdk-mcp-wrapper 的 tier 过滤逻辑。
 */

import { describe, it, expect } from 'vitest';
import { parseSkillMd } from '../src/skills/registry.js';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { readdirSync } from 'fs';
import type { SkillTier } from '../src/types.js';

const BUILTIN_SKILLS_DIR = resolve(process.cwd(), 'skills/built-in');

const EXPECTED_TIERS: Record<string, SkillTier> = {
    shell: 'core',
    'file-manager': 'core',
    'http-client': 'core',
    notification: 'extended',
    'document-processor': 'extended',
    vision: 'extended',
    'database-connector': 'extended',
    'log-analyzer': 'extended',
    'im-bot': 'extended',
    'browser-automation': 'experimental',
    'gemini-cli': 'experimental',
    'claude-code': 'experimental',
    'conductor-workflow': 'experimental',
};

describe('Skills Tier System', () => {
    it('所有 built-in 技能目录应有 SKILL.md', () => {
        const entries = readdirSync(BUILTIN_SKILLS_DIR, { withFileTypes: true })
            .filter(e => e.isDirectory());
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
            const skillMd = join(BUILTIN_SKILLS_DIR, entry.name, 'SKILL.md');
            expect(existsSync(skillMd), `${entry.name} 缺少 SKILL.md`).toBe(true);
        }
    });

    it('所有 built-in 技能应包含有效的 tier 元数据', async () => {
        const validTiers: SkillTier[] = ['core', 'extended', 'experimental'];
        const entries = readdirSync(BUILTIN_SKILLS_DIR, { withFileTypes: true })
            .filter(e => e.isDirectory());

        for (const entry of entries) {
            const skillMd = join(BUILTIN_SKILLS_DIR, entry.name, 'SKILL.md');
            if (!existsSync(skillMd)) continue;
            const parsed = await parseSkillMd(skillMd);
            expect(
                parsed.metadata.tier,
                `${entry.name} 缺少 tier 元数据`
            ).toBeDefined();
            expect(
                validTiers.includes(parsed.metadata.tier!),
                `${entry.name} 的 tier "${parsed.metadata.tier}" 不合法`
            ).toBe(true);
        }
    });

    it('所有 built-in 技能应包含 category 元数据', async () => {
        const validCategories = ['execution', 'file', 'web', 'data', 'communication', 'ai', 'enterprise'];
        const entries = readdirSync(BUILTIN_SKILLS_DIR, { withFileTypes: true })
            .filter(e => e.isDirectory());

        for (const entry of entries) {
            const skillMd = join(BUILTIN_SKILLS_DIR, entry.name, 'SKILL.md');
            if (!existsSync(skillMd)) continue;
            const parsed = await parseSkillMd(skillMd);
            expect(
                parsed.metadata.category,
                `${entry.name} 缺少 category 元数据`
            ).toBeDefined();
            expect(
                validCategories.includes(parsed.metadata.category!),
                `${entry.name} 的 category "${parsed.metadata.category}" 不合法`
            ).toBe(true);
        }
    });

    it('各技能的 tier 应与预期一致', async () => {
        for (const [skillName, expectedTier] of Object.entries(EXPECTED_TIERS)) {
            const skillMd = join(BUILTIN_SKILLS_DIR, skillName, 'SKILL.md');
            if (!existsSync(skillMd)) continue;
            const parsed = await parseSkillMd(skillMd);
            expect(
                parsed.metadata.tier,
                `${skillName} 的 tier 应为 ${expectedTier}`
            ).toBe(expectedTier);
        }
    });

    it('core tier 技能应为 3 个（shell / file-manager / http-client）', async () => {
        const entries = readdirSync(BUILTIN_SKILLS_DIR, { withFileTypes: true })
            .filter(e => e.isDirectory());

        const coreSkills: string[] = [];
        for (const entry of entries) {
            const skillMd = join(BUILTIN_SKILLS_DIR, entry.name, 'SKILL.md');
            if (!existsSync(skillMd)) continue;
            const parsed = await parseSkillMd(skillMd);
            if (parsed.metadata.tier === 'core') {
                coreSkills.push(parsed.metadata.name);
            }
        }

        expect(coreSkills).toHaveLength(3);
        expect(coreSkills).toContain('shell');
        expect(coreSkills).toContain('file-manager');
        expect(coreSkills).toContain('http-client');
    });
});

describe('Subagent Definitions', () => {
    it('buildSubagentDefs 应返回 4 个部门专家', async () => {
        const { buildSubagentDefs } = await import('../src/core/agent/subagents.js');
        const defs = buildSubagentDefs();
        const ids = Object.keys(defs);
        expect(ids).toHaveLength(4);
        expect(ids).toContain('hr-specialist');
        expect(ids).toContain('finance-analyst');
        expect(ids).toContain('it-support');
        expect(ids).toContain('engineering-assistant');
    });

    it('每个 Subagent 应有 description、prompt、tools', async () => {
        const { buildSubagentDefs } = await import('../src/core/agent/subagents.js');
        const defs = buildSubagentDefs();
        for (const [id, def] of Object.entries(defs)) {
            expect(def.description, `${id} 缺少 description`).toBeTruthy();
            expect(def.prompt, `${id} 缺少 prompt`).toBeTruthy();
            expect(def.tools, `${id} 缺少 tools`).toBeDefined();
            expect((def.tools ?? []).length, `${id} 的 tools 为空`).toBeGreaterThan(0);
        }
    });

    it('it-support 应有 shell 工具访问权', async () => {
        const { buildSubagentDefs } = await import('../src/core/agent/subagents.js');
        const { tools } = buildSubagentDefs()['it-support'];
        expect(tools?.some(t => t.startsWith('shell.'))).toBe(true);
    });

    it('hr-specialist 不应有 shell 工具（最小权限）', async () => {
        const { buildSubagentDefs } = await import('../src/core/agent/subagents.js');
        const { tools } = buildSubagentDefs()['hr-specialist'];
        expect(tools?.some(t => t.startsWith('shell.'))).toBe(false);
    });
});
