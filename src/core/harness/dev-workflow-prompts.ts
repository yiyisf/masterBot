/**
 * 两阶段自动化调度层 prompt 模板（spec #85，地图 #74 ticket #79 决策）。
 *
 * 平台 prompt 是薄调度层：需求上下文 + 「必须先调用 <skill> 并遵循其流程」硬指令 +
 * cmaster:questions/done 输出协议要求——流程方法论本身住在 .agents/skills 里（见
 * worktree-manager.ts 的 DEV_WORKFLOW_SKILL_NAMES 与 skills/dev-workflow-bundle/）。
 *
 * 三个模板键：
 * - dev-workflow.analysis：分析阶段（grilling+to-spec），startAnalysis() 的 task 前半段。
 * - dev-workflow.split：拆卡阶段（to-tickets），startAnalysis() 的 task 后半段——两者在
 *   同一次 agent 运行里先后调用（#86 编排目前只有一次分析阶段 run，拆卡是它的收尾产出）。
 * - dev-workflow.implement：单卡实现阶段，driveCardsSequentially() 每张卡片的 task。
 *
 * 每个键可被 dev_workflow_prompt_templates 表按键覆盖（代码内置默认兜底），协议要求本身
 * 是固定后缀、不可通过覆盖模板绕过（保证跨引擎解析器始终认识输出格式）。
 */

export type DevWorkflowStage = 'analysis' | 'split' | 'implement';

export const DEV_WORKFLOW_PROMPT_KEYS: Record<DevWorkflowStage, string> = {
    analysis: 'dev-workflow.analysis',
    split: 'dev-workflow.split',
    implement: 'dev-workflow.implement',
};

const DEFAULT_TEMPLATES: Record<DevWorkflowStage, string> = {
    analysis:
        '分析需求 {{reqKey}}：{{title}}\n\n{{description}}\n\n' +
        '本任务必须先调用 grilling 与 to-spec skill 并遵循其流程理解需求、产出结构化规格；若需要澄清，一次只问一个问题。',
    split:
        '规格确认后，本任务必须调用 to-tickets skill 并遵循其流程，把规格拆解为一组按执行顺序排列、可独立验证的实现卡片。',
    implement:
        '实现卡片 {{reqKey}}：{{title}}\n\n{{description}}\n\n' +
        '本任务必须先调用 implement skill 并遵循其流程；若需要澄清或做出只有人类才能决定的选择，调用 ask_user 工具向人类提问。',
};

/** 固定协议要求后缀，不受 DB 覆盖模板影响（保证解析器始终认识输出格式） */
const PROTOCOL_FOOTER =
    '\n\n完成或需要提问时按以下协议输出：需要提问时在回复末尾输出一个 ```cmaster:questions``` ' +
    '代码块（JSON: {"questions": [...]}）；阶段或任务完成时输出 ```cmaster:done``` 代码块（携带阶段产物）。';

export interface DevWorkflowPromptVars {
    reqKey: string;
    title: string;
    description?: string | null;
}

/** DB 覆盖层的最小读接口，供 buildStagePrompt 注入（解耦具体 repository 实现，便于测试） */
export interface DevWorkflowPromptOverrides {
    get(key: string): string | undefined;
}

function interpolate(template: string, vars: DevWorkflowPromptVars): string {
    return template
        .replaceAll('{{reqKey}}', vars.reqKey)
        .replaceAll('{{title}}', vars.title)
        .replaceAll('{{description}}', vars.description ?? '');
}

function renderStageBody(stage: DevWorkflowStage, vars: DevWorkflowPromptVars, overrides?: DevWorkflowPromptOverrides): string {
    const key = DEV_WORKFLOW_PROMPT_KEYS[stage];
    const template = overrides?.get(key) ?? DEFAULT_TEMPLATES[stage];
    return interpolate(template, vars);
}

/**
 * 组装某阶段的调度层 prompt：DB 覆盖模板优先，否则用代码内置默认；插值需求上下文变量后，
 * 追加固定的协议要求后缀。
 */
export function buildStagePrompt(
    stage: DevWorkflowStage,
    vars: DevWorkflowPromptVars,
    overrides?: DevWorkflowPromptOverrides
): string {
    return renderStageBody(stage, vars, overrides) + PROTOCOL_FOOTER;
}

/**
 * 分析阶段 = analysis + split 两段模板拼接（同一次 agent 运行里先理解、再拆卡），
 * 协议要求后缀只追加一次。
 */
export function buildAnalysisPrompt(vars: DevWorkflowPromptVars, overrides?: DevWorkflowPromptOverrides): string {
    const analysis = renderStageBody('analysis', vars, overrides);
    const split = renderStageBody('split', vars, overrides);
    return `${analysis}\n\n${split}${PROTOCOL_FOOTER}`;
}

export function buildImplementPrompt(vars: DevWorkflowPromptVars, overrides?: DevWorkflowPromptOverrides): string {
    return buildStagePrompt('implement', vars, overrides);
}
