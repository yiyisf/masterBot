/**
 * Outcome Specification — 任务结果质量评判标准
 * Phase 23: Managed Agents Harness
 */

export interface OutcomeSpec {
    /** 评判维度列表 */
    criteria: OutcomeCriterion[];
    grader: {
        /** 用于评判的 LLM provider（留空则使用与 Agent 相同的 provider）*/
        provider?: string;
        /** 最大修订轮次，超过后状态变为 max_revisions_reached */
        maxRevisions: number;
        /** 加权总分达到此值视为 satisfied（0-100）*/
        minScore: number;
    };
}

export interface OutcomeCriterion {
    id: string;
    /** 自然语言描述"什么叫做好了" */
    description: string;
    /** 相对权重 1-10 */
    weight: number;
    /** true 则该项不过即视为 failed，不管总分 */
    required: boolean;
}

export type OutcomeStatus =
    | 'satisfied'               // 通过
    | 'needs_revision'          // 部分未达标，可修订
    | 'failed'                  // required 项失败，无法修复
    | 'max_revisions_reached'   // 超过修订次数
    | 'grader_error';           // Grader 自身出错

export interface GraderResult {
    status: OutcomeStatus;
    /** 加权总分 0-100 */
    overallScore: number;
    criteriaResults: CriterionResult[];
    /** 直接写给 Agent 的改进建议 */
    feedback: string;
    /** 第几次评分（从 1 开始）*/
    revision: number;
    durationMs: number;
}

export interface CriterionResult {
    criterionId: string;
    passed: boolean;
    score: number;
    reasoning: string;
    suggestions?: string;
}
