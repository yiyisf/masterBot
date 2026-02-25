import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { LLMAdapter, Logger } from '../types.js';

export interface GenerateSkillRequest {
    name: string;
    description: string;
    actions: Array<{
        name: string;
        description: string;
        params?: Array<{ name: string; type: string; required?: boolean; description?: string }>;
    }>;
}

export interface GeneratedSkill {
    skillMd: string;
    indexTs: string;
    dir: string;
}

const GENERATOR_SYSTEM_PROMPT = `你是一个专业的技能代码生成器，负责为 CMaster Bot 生成技能文件。

## 技能文件格式

### SKILL.md 格式
\`\`\`markdown
---
name: skill-name
version: 1.0.0
description: 技能描述
author: Auto-Generated
---

### action_name

动作描述。

**Parameters:**
- \`param\` (type, required): 参数描述
\`\`\`

### index.ts 格式
\`\`\`typescript
import type { SkillContext } from '../../../src/types.js';

export async function action_name(
    ctx: SkillContext,
    params: { param: string }
): Promise<string> {
    ctx.logger.info(\`[skill-name] action_name called\`);
    // 实现代码
    return '结果';
}
\`\`\`

## 重要约束
1. SkillContext 提供: ctx.logger, ctx.sessionId, ctx.memory, ctx.config
2. 使用 async/await，返回 Promise<string | object>
3. 所有错误用 throw new Error() 抛出
4. 不能导入无法从 npm 获取的模块
5. 使用 fetch() 进行 HTTP 请求（Node 18+ 内置）
6. 输出纯 JSON，格式: { "skillMd": "...", "indexTs": "..." }`;

export class SkillGenerator {
    private llm: LLMAdapter;
    private logger: Logger;
    private skillsDir: string;

    constructor(llm: LLMAdapter, logger: Logger, skillsDir = 'skills/local') {
        this.llm = llm;
        this.logger = logger;
        this.skillsDir = skillsDir;
    }

    async generate(req: GenerateSkillRequest): Promise<GeneratedSkill> {
        this.logger.info(`[skill-generator] Generating skill: ${req.name}`);

        const actionsDesc = req.actions.map(a => {
            const paramsDesc = (a.params || []).map(p =>
                `  - ${p.name} (${p.type}${p.required ? ', required' : ''}): ${p.description || ''}`
            ).join('\n');
            return `Action: ${a.name}\nDescription: ${a.description}\nParams:\n${paramsDesc}`;
        }).join('\n\n');

        const userPrompt = `生成一个名为 "${req.name}" 的技能。

描述: ${req.description}

动作列表:
${actionsDesc}

请输出纯 JSON 格式（不要 markdown 代码块）: { "skillMd": "SKILL.md内容", "indexTs": "index.ts内容" }`;

        const response = await this.llm.chat([
            { role: 'system', content: GENERATOR_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
        ]);

        const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

        // Parse JSON output
        let parsed: { skillMd: string; indexTs: string };
        try {
            // Strip markdown code blocks if present
            const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            parsed = JSON.parse(cleaned);
        } catch (err) {
            throw new Error(`LLM 输出解析失败: ${content.substring(0, 200)}`);
        }

        const skillDir = join(this.skillsDir, req.name);
        return {
            skillMd: parsed.skillMd,
            indexTs: parsed.indexTs,
            dir: skillDir,
        };
    }

    async install(generated: GeneratedSkill): Promise<string> {
        const { dir, skillMd, indexTs } = generated;

        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        writeFileSync(join(dir, 'SKILL.md'), skillMd, 'utf-8');
        writeFileSync(join(dir, 'index.ts'), indexTs, 'utf-8');

        this.logger.info(`[skill-generator] Installed skill at ${dir}`);
        return dir;
    }
}
