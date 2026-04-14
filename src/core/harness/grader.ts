/**
 * Grader — 任务结果质量评判引擎
 * Phase 23: Managed Agents Harness
 *
 * 独立的 LLM 调用，与 Agent 推理完全解耦。
 * 根据 OutcomeSpec.criteria 对 Agent 输出打分，驱动修订循环。
 */

import type { LLMAdapter, Logger } from '../../types.js';
import type { OutcomeSpec, GraderResult, OutcomeStatus, CriterionResult } from './outcome-spec.js';

const GRADER_SYSTEM_PROMPT = `你是一个严格、客观的任务质量评审员（Grader）。
你的职责是评估 AI Agent 的任务完成质量。评估原则：
1. 严格对照给定标准，不受 Agent 态度或表达方式影响
2. 对 "required" 标注的标准零容忍——未达标则整体 failed
3. 给出可执行的具体改进建议，而非模糊的方向
4. 必须以纯 JSON 输出，不添加任何 markdown 包裹或说明文字`;

export class Grader {
    constructor(
        private getLLM: (provider?: string) => LLMAdapter,
        private logger: Logger
    ) {}

    async evaluate(
        task: string,
        output: string,
        spec: OutcomeSpec,
        revision: number
    ): Promise<GraderResult> {
        const startMs = Date.now();
        this.logger.info(`[grader] Evaluating revision ${revision} for task: ${task.slice(0, 80)}...`);

        const prompt = this.buildPrompt(task, output, spec);
        const llm = this.getLLM(spec.grader.provider);

        let rawResponse: string;
        try {
            const response = await llm.chat(
                [
                    { role: 'system', content: GRADER_SYSTEM_PROMPT },
                    { role: 'user', content: prompt },
                ],
                { maxTokens: 2048 }
            );
            rawResponse = typeof response.content === 'string'
                ? response.content
                : JSON.stringify(response.content);
        } catch (err) {
            this.logger.error(`[grader] LLM call failed: ${(err as Error).message}`);
            return {
                status: 'grader_error',
                overallScore: 0,
                criteriaResults: [],
                feedback: `Grader LLM 调用失败: ${(err as Error).message}`,
                revision,
                durationMs: Date.now() - startMs,
            };
        }

        const result = this.parseResponse(rawResponse, spec, revision, Date.now() - startMs);
        this.logger.info(`[grader] Revision ${revision}: ${result.status} (score=${result.overallScore})`);
        return result;
    }

    private buildPrompt(task: string, output: string, spec: OutcomeSpec): string {
        const criteriaText = spec.criteria
            .map(c =>
                `  {"id":"${c.id}","weight":${c.weight},"required":${c.required},"description":"${c.description}"}`
            )
            .join(',\n');

        const outputPreview = output.length > 3000
            ? output.slice(0, 3000) + `\n...[已截断，共 ${output.length} 字符]`
            : output;

        return `## 原始任务
${task}

## Agent 输出
${outputPreview}

## 评估标准（JSON）
[
${criteriaText}
]

## 要求
请对每个标准独立评分（0-100），并给出综合改进建议。
- required=true 的标准：score < 60 即视为 failed，整体 status 必须为 "failed"
- overallScore = 各标准加权平均（按 weight 权重）
- status 取值：satisfied（overallScore >= ${spec.grader.minScore} 且所有 required 通过）| needs_revision | failed

## 输出格式（纯 JSON，不加 markdown）
{
  "criteriaResults": [
    {"criterionId":"...","passed":true,"score":85,"reasoning":"...","suggestions":"..."}
  ],
  "overallScore": 82,
  "status": "satisfied|needs_revision|failed",
  "feedback": "写给 Agent 的综合改进建议，直接、具体、可执行"
}`;
    }

    private parseResponse(
        raw: string,
        spec: OutcomeSpec,
        revision: number,
        durationMs: number
    ): GraderResult {
        // 容忍 markdown 代码块包裹
        const jsonStr = raw.match(/```(?:json)?\s*([\s\S]+?)```/)?.[1]
            ?? raw.match(/(\{[\s\S]+\})/)?.[1]
            ?? raw;

        let parsed: any;
        try {
            parsed = JSON.parse(jsonStr.trim());
        } catch {
            this.logger.warn(`[grader] Failed to parse response as JSON, using fallback`);
            return {
                status: 'grader_error',
                overallScore: 0,
                criteriaResults: [],
                feedback: `Grader 响应无法解析为 JSON。原始输出: ${raw.slice(0, 200)}`,
                revision,
                durationMs,
            };
        }

        const criteriaResults: CriterionResult[] = parsed.criteriaResults ?? [];

        // required 项目只要 score < 60 即 failed
        const requiredFailed = spec.criteria
            .filter(c => c.required)
            .some(c => {
                const r = criteriaResults.find(cr => cr.criterionId === c.id);
                return !r || r.score < 60;
            });

        // 计算加权总分
        let totalWeight = 0;
        let weightedScore = 0;
        for (const criterion of spec.criteria) {
            const r = criteriaResults.find(cr => cr.criterionId === criterion.id);
            if (r) {
                weightedScore += r.score * criterion.weight;
                totalWeight += criterion.weight;
            }
        }
        const overallScore = totalWeight > 0
            ? Math.round(weightedScore / totalWeight)
            : parsed.overallScore ?? 0;

        let status: OutcomeStatus;
        if (requiredFailed) {
            status = 'failed';
        } else if (overallScore >= spec.grader.minScore) {
            status = 'satisfied';
        } else {
            status = 'needs_revision';
        }

        return {
            status,
            overallScore,
            criteriaResults,
            feedback: parsed.feedback ?? '',
            revision,
            durationMs,
        };
    }
}
