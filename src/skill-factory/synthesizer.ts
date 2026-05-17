import type { LLMAdapter, Logger } from '../types.js';
import type { SkillSpec } from './types.js';

const SYNTHESIZER_SYSTEM_PROMPT = `你是 CMaster Bot Skill Factory 的代码合成引擎。
根据 SkillSpec 生成三个文件的内容：SKILL.md、index.ts、unit.test.ts。

## SKILL.md 格式
\`\`\`
---
name: skill-name
version: 1.0.0
description: 技能描述
author: SkillFactory-2.0
---

### action_name

动作描述。

**Parameters:**
- \`param\` (type, required): 参数描述

**Returns:** 返回值描述
\`\`\`

## index.ts 格式
\`\`\`typescript
import type { SkillContext } from '../../../src/types.js';

export async function action_name(
    ctx: SkillContext,
    params: { param: string }
): Promise<string> {
    ctx.logger.info('[skill-name] action_name called');
    try {
        // 实现代码
        return JSON.stringify({ success: true });
    } catch (err) {
        throw new Error(\`action_name failed: \${err instanceof Error ? err.message : String(err)}\`);
    }
}
\`\`\`

## unit.test.ts 格式
\`\`\`typescript
import { describe, it, expect, vi } from 'vitest';
import { action_name } from './index.js';

const mockCtx = {
    sessionId: 'test',
    memory: { get: vi.fn(), set: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    config: {},
} as any;

describe('skill-name', () => {
    it('should handle basic case', async () => {
        const result = await action_name(mockCtx, { param: 'value' });
        expect(result).toBeDefined();
    });
});
\`\`\`

## 重要约束
1. 每个 action 都必须有完整的 TypeScript 类型注解
2. 所有 error 必须 try/catch 并 throw new Error(...)
3. 绝对不能硬编码 API key 或密钥
4. 使用 ctx.config 读取运行时配置，不使用 process.env 直接硬编码值
5. fetch() 用于 HTTP 请求（Node 18+ 内置）
6. 测试文件覆盖 spec 中的所有 testCase

输出纯 JSON（不加 markdown 代码块）:
{
  "skillMd": "SKILL.md 全部内容",
  "indexTs": "index.ts 全部内容",
  "testTs": "unit.test.ts 全部内容"
}`;

function extractJson(text: string): { skillMd: string; indexTs: string; testTs: string } {
    const cleaned = text.replace(/```(?:json)?\n?/g, '').replace(/```\n?/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('无法解析合成器输出为 JSON');
    }
}

export class SkillSynthesizer {
    constructor(private llm: LLMAdapter, private logger: Logger) {}

    async synthesize(
        spec: SkillSpec,
        options: { maxAttempts?: number } = {}
    ): Promise<{ skillMd: string; indexTs: string; testTs: string }> {
        const maxAttempts = options.maxAttempts ?? 3;
        this.logger.info(`[skill-factory:synthesizer] Synthesizing skill: ${spec.name}`);

        const inputsDesc = Object.entries(spec.inputs)
            .map(([k, v]) => `  - ${k} (${v.type}${v.required ? ', required' : ''}): ${v.description}`)
            .join('\n');

        const testCasesDesc = spec.testCases
            .map(tc => `  - "${tc.name}": input=${JSON.stringify(tc.input)}, expected contains: "${tc.expectedOutput}"`)
            .join('\n');

        const userPrompt = `生成技能：${spec.name}

描述：${spec.description}
类别：${spec.category}

输入参数：
${inputsDesc}

测试用例：
${testCasesDesc}

所需权限：${spec.requiredScopes.join(', ') || '无'}

请生成 SKILL.md、index.ts、unit.test.ts 三个文件，输出 JSON 格式。`;

        let lastError: Error | undefined;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const resp = await this.llm.chat([
                    { role: 'system', content: SYNTHESIZER_SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ]);

                const raw = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
                const files = extractJson(raw);

                if (!files.skillMd || !files.indexTs || !files.testTs) {
                    throw new Error('生成文件不完整：缺少 skillMd/indexTs/testTs');
                }

                this.logger.info(`[skill-factory:synthesizer] Synthesis complete on attempt ${attempt + 1}`);
                return files;
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                this.logger.warn(`[skill-factory:synthesizer] Attempt ${attempt + 1} failed: ${lastError.message}`);
            }
        }

        throw lastError ?? new Error('Synthesis failed after max attempts');
    }
}
