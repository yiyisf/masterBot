#!/usr/bin/env tsx
/**
 * Phase 4: Token 节省测量脚本
 * 对比 Phase 3（全量工具）vs Phase 4（core-tier 过滤）的 input token 差异。
 *
 * 使用方式:
 *   npx tsx scripts/token-count.ts
 */

import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import matter from 'gray-matter';

interface ToolEntry {
    name: string;
    description: string;
    tier: string;
    category: string;
    actions: string[];
}

/** 粗略的 token 估算：按空格分词 × 1.3（英文中文混合系数） */
function estimateTokens(text: string): number {
    const words = text.trim().split(/\s+/).length;
    return Math.ceil(words * 1.3);
}

/** 将工具列表格式化为类似系统提示中的工具描述文本 */
function formatToolsForPrompt(tools: ToolEntry[]): string {
    return tools.map(t =>
        `Tool: ${t.name}\nDescription: ${t.description}\nActions: ${t.actions.join(', ')}`
    ).join('\n\n');
}

async function loadBuiltinSkills(skillsDir: string): Promise<ToolEntry[]> {
    const { readdirSync, existsSync } = await import('fs');
    const tools: ToolEntry[] = [];

    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillMd = join(skillsDir, entry.name, 'SKILL.md');
        if (!existsSync(skillMd)) continue;

        const content = readFileSync(skillMd, 'utf-8');
        const { data: fm, content: body } = matter(content);

        // 提取 action 名称
        const actionRegex = /###\s+(\w+)/g;
        const actions: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = actionRegex.exec(body)) !== null) {
            actions.push(m[1]);
        }

        tools.push({
            name: fm.name ?? entry.name,
            description: fm.description ?? '',
            tier: fm.tier ?? 'extended',
            category: fm.category ?? 'unknown',
            actions,
        });
    }

    return tools;
}

async function main() {
    const skillsDir = resolve(process.cwd(), 'skills/built-in');
    const allTools = await loadBuiltinSkills(skillsDir);

    const coreTools = allTools.filter(t => t.tier === 'core');
    const extendedTools = allTools.filter(t => t.tier === 'extended');
    const experimentalTools = allTools.filter(t => t.tier === 'experimental');

    const allPrompt = formatToolsForPrompt(allTools);
    const corePrompt = formatToolsForPrompt(coreTools);

    const allTokens = estimateTokens(allPrompt);
    const coreTokens = estimateTokens(corePrompt);
    const savedTokens = allTokens - coreTokens;
    const savedPct = ((savedTokens / allTokens) * 100).toFixed(1);

    console.log('\n📊 Phase 4 Token 节省分析报告');
    console.log('='.repeat(50));

    console.log('\n技能分布:');
    console.log(`  core (主 Agent):   ${coreTools.length} 个技能 (${coreTools.map(t => t.name).join(', ')})`);
    console.log(`  extended (子 Agent): ${extendedTools.length} 个技能 (${extendedTools.map(t => t.name).join(', ')})`);
    console.log(`  experimental:      ${experimentalTools.length} 个技能 (${experimentalTools.map(t => t.name).join(', ')})`);

    console.log('\nToken 估算 (系统提示中工具描述部分):');
    console.log(`  Phase 3 (全量):    ~${allTokens} tokens`);
    console.log(`  Phase 4 (core):    ~${coreTokens} tokens`);
    console.log(`  节省:              ~${savedTokens} tokens (${savedPct}%)`);

    const target = 30;
    if (parseFloat(savedPct) >= target) {
        console.log(`\n✅ 达成 Phase 4 目标：input tokens 减少 ≥${target}% (实际 ${savedPct}%)`);
    } else {
        console.log(`\n⚠️ 未达成 Phase 4 目标：期望 ≥${target}%，实际 ${savedPct}%`);
        console.log('   建议：将更多技能移至 extended/experimental tier，或精简 core 工具描述');
    }

    console.log('\n各 Tier 详情:');
    for (const tool of allTools) {
        const marker = tool.tier === 'core' ? '★' : tool.tier === 'extended' ? '○' : '△';
        console.log(`  ${marker} [${tool.tier.padEnd(12)}] ${tool.name.padEnd(22)} (${tool.actions.length} actions, cat=${tool.category})`);
    }
    console.log('\n图例: ★=core(主Agent) ○=extended(子Agent) △=experimental');
}

main().catch(err => {
    console.error('❌ 分析失败:', err);
    process.exit(1);
});
