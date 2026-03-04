export type ReasoningTier = 1 | 2 | 3;

/**
 * Classify task complexity to dynamically adjust reasoning tier (Adaptive AI Thinking).
 *
 * Tier 1: Fast/Direct (1 iteration, no tools) - Simple queries, greetings.
 * Tier 2: Standard (10 iterations, all tools) - Multi-step workflows.
 * Tier 3: Deep (25 iterations, extended thinking LLM) - AIOps, heavy diagnostics, coding.
 *
 * @param input The user's input text
 * @param toolCount The number of available external tools to consider
 */
export function classifyComplexity(input: string, toolCount: number): ReasoningTier {
    // Fast path: very short, no tools required, simple conversational questions
    if (toolCount === 0 && input.length < 80 && !/分析|排查|生成|对比|计划|执行/i.test(input)) {
        return 1;
    }

    // Deep path: explicit keywords indicating heavy mental workload or dense tool usage
    const heavyKeywords = /oom|故障|根因|生成技能|对比分析|runbook|架构|重构|调试|bug/i;
    if (heavyKeywords.test(input) || toolCount > 5) {
        return 3;
    }

    // Standard multi-step ReAct
    return 2;
}
