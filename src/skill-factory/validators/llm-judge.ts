import type { LLMAdapter, Logger } from '../../types.js';
import type { SkillSpec, SandboxTestResult, LLMJudgeResult } from '../types.js';

const JUDGE_SYSTEM_PROMPT = `你是 CMaster Bot Skill Factory 的质量评审员。
请从 4 个维度对技能进行评分（各维度 0-10 分）：

1. **utility（实用性）**：技能是否切实解决了 spec 描述的问题，功能是否完整
2. **robustness（健壮性）**：边界情况处理是否充分，error handling 是否完善
3. **security（安全性）**：代码中是否没有越权操作、敏感信息泄露风险
4. **documentation（文档质量）**：SKILL.md 描述是否清晰，参数说明是否准确

请输出纯 JSON（不加 markdown 代码块）：
{
  "utility": <0-10>,
  "robustness": <0-10>,
  "security": <0-10>,
  "documentation": <0-10>,
  "feedback": "综合反馈意见，指出主要优点和改进建议（100-300字）"
}`;

function computeScore(dims: LLMJudgeResult['dimensions']): number {
    return dims.utility * 0.35 + dims.robustness * 0.25 + dims.security * 0.25 + dims.documentation * 0.15;
}

function extractJson(text: string): Partial<LLMJudgeResult['dimensions'] & { feedback: string }> {
    const cleaned = text.replace(/```(?:json)?\n?/g, '').replace(/```\n?/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('LLM Judge 输出无法解析');
    }
}

export class LLMJudge {
    constructor(private llm: LLMAdapter, private logger: Logger) {}

    async evaluate(
        spec: SkillSpec,
        files: { skillMd: string; indexTs: string },
        sandboxResult: SandboxTestResult
    ): Promise<LLMJudgeResult> {
        this.logger.info(`[skill-factory:llm-judge] Evaluating skill: ${spec.name}`);

        const sandboxSummary = sandboxResult.mock
            ? '（沙箱未执行，tsx 不可用）'
            : `成功率: ${(sandboxResult.successRate * 100).toFixed(0)}%, 平均耗时: ${sandboxResult.avgDurationMs.toFixed(0)}ms`;

        const userPrompt = `请评审以下技能：

## SkillSpec
名称: ${spec.name}
描述: ${spec.description}
类别: ${spec.category}
输入参数: ${JSON.stringify(spec.inputs, null, 2)}

## SKILL.md
${files.skillMd.substring(0, 2000)}

## index.ts
${files.indexTs.substring(0, 3000)}

## 沙箱测试结果
${sandboxSummary}

请按照评审标准给出 4 个维度的评分和综合反馈。`;

        try {
            const resp = await this.llm.chat([
                { role: 'system', content: JUDGE_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
            ]);

            const raw = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
            const parsed = extractJson(raw);

            const dims: LLMJudgeResult['dimensions'] = {
                utility: clamp(parsed.utility ?? 5),
                robustness: clamp(parsed.robustness ?? 5),
                security: clamp(parsed.security ?? 5),
                documentation: clamp(parsed.documentation ?? 5),
            };

            const score = computeScore(dims);

            return {
                score,
                needsHumanReview: score < 7,
                dimensions: dims,
                feedback: parsed.feedback ?? '未提供详细反馈',
            };
        } catch (err) {
            this.logger.error(`[skill-factory:llm-judge] Evaluation failed: ${err}`);
            const dims = { utility: 5, robustness: 5, security: 5, documentation: 5 };
            return {
                score: computeScore(dims),
                needsHumanReview: true,
                dimensions: dims,
                feedback: `评审失败: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
}

function clamp(v: unknown): number {
    const n = Number(v);
    if (isNaN(n)) return 5;
    return Math.max(0, Math.min(10, n));
}
