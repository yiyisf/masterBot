import { readdirSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LLMAdapter, Logger } from '../types.js';
import type { SkillSpec } from './types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SKILLS_DIR = join(__dirname, '../../skills');

export interface ConversationContext {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

const SPEC_SYSTEM_PROMPT = `你是 CMaster Bot Skill Factory 的需求分析师。
你的任务是将用户的自然语言意图转化为标准化的 SkillSpec（JSON）。

SkillSpec 结构：
{
  "name": "kebab-case 唯一标识符，例如 github-pr-merger",
  "description": "一句话描述此技能的作用",
  "category": "execution|file|web|data|communication|ai|enterprise",
  "inputs": {
    "paramName": { "type": "string|number|boolean|object|array", "description": "参数用途", "required": true }
  },
  "outputs": {
    "result": { "type": "string", "description": "输出描述" }
  },
  "requiredScopes": ["shell", "network:api.github.com"],
  "testCases": [
    {
      "name": "基础场景",
      "input": { "paramName": "示例值" },
      "expectedOutput": "期望输出中包含的关键词"
    }
  ]
}

规则：
1. name 必须 kebab-case，全小写字母+数字+横杠，以字母开头
2. 至少 1 个 input，至少 1 个 testCase
3. requiredScopes：无需外部网络时为空数组 []
4. 直接输出 JSON，不加 markdown 代码块`;

function extractJson(text: string): unknown {
    const cleaned = text.replace(/```(?:json)?\n?/g, '').replace(/```\n?/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('无法解析 LLM 输出为 JSON');
    }
}

function isSpecComplete(spec: Partial<SkillSpec>): { ok: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!spec.name) missing.push('name');
    if (!spec.description) missing.push('description');
    if (!spec.inputs || Object.keys(spec.inputs).length === 0) missing.push('inputs');
    if (!spec.testCases || spec.testCases.length === 0) missing.push('testCases');
    return { ok: missing.length === 0, missing };
}

async function queryCatalog(): Promise<string[]> {
    const names: string[] = [];
    if (!existsSync(SKILLS_DIR)) return names;
    const subdirs = ['built-in', 'installed', 'local'];
    for (const sub of subdirs) {
        const dir = join(SKILLS_DIR, sub);
        if (!existsSync(dir)) continue;
        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const mdPath = join(dir, entry.name, 'SKILL.md');
                if (!existsSync(mdPath)) continue;
                const content = await readFile(mdPath, 'utf-8');
                const match = content.match(/^name:\s*(.+)$/m);
                if (match) names.push(match[1].trim());
            }
        } catch {
            // ignore unreadable dirs
        }
    }
    return names;
}

export class SpecBuilder {
    constructor(private llm: LLMAdapter, private logger: Logger) {}

    async build(
        intent: string,
        context: ConversationContext = { messages: [] },
        options: { maxRounds?: number } = {}
    ): Promise<SkillSpec> {
        const maxRounds = options.maxRounds ?? 3;
        this.logger.info('[skill-factory:spec-builder] Building spec from intent');

        const catalog = await queryCatalog();
        const catalogHint = catalog.length > 0
            ? `\n\n已有技能（避免重复）：${catalog.join(', ')}`
            : '';

        const history = [...context.messages];
        let spec: Partial<SkillSpec> = {};

        for (let round = 0; round < maxRounds; round++) {
            const userMsg = round === 0
                ? `用户意图：${intent}${catalogHint}\n\n请生成 SkillSpec JSON。`
                : `请根据以上信息补全缺失字段（${(isSpecComplete(spec).missing).join(', ')}），输出完整 SkillSpec JSON。`;

            history.push({ role: 'user', content: userMsg });

            const resp = await this.llm.chat([
                { role: 'system', content: SPEC_SYSTEM_PROMPT },
                ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
            ]);

            const raw = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
            history.push({ role: 'assistant', content: raw });

            try {
                const parsed = extractJson(raw) as Partial<SkillSpec>;
                spec = { ...spec, ...parsed };
            } catch (err) {
                this.logger.warn(`[skill-factory:spec-builder] Round ${round} parse failed: ${err}`);
            }

            const { ok } = isSpecComplete(spec);
            if (ok) break;
        }

        // Fill defaults for still-missing fields
        if (!spec.name) spec.name = intent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 40) || 'generated-skill';
        if (!spec.description) spec.description = intent;
        if (!spec.category) spec.category = 'execution';
        if (!spec.inputs) spec.inputs = { input: { type: 'string', description: '输入内容', required: true } };
        if (!spec.outputs) spec.outputs = { result: { type: 'string', description: '执行结果' } };
        if (!spec.requiredScopes) spec.requiredScopes = [];
        if (!spec.testCases || spec.testCases.length === 0) {
            spec.testCases = [{ name: '基础场景', input: { input: 'test' }, expectedOutput: 'success' }];
        }

        // Detect similar skills
        const nameLower = (spec.name ?? '').toLowerCase();
        spec.similarSkills = catalog.filter(n => {
            const parts = nameLower.split('-');
            return parts.some(p => p.length > 3 && n.toLowerCase().includes(p));
        });

        this.logger.info(`[skill-factory:spec-builder] Spec built: ${spec.name}`);
        return spec as SkillSpec;
    }
}
