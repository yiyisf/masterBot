import type { SkillContext } from '../../../src/types.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Golden few-shot examples: 5 canonical patterns (~1000 tokens), injected every call
// Full schema (conductor-schema.md, ~3000 tokens) only loaded when explicitly requested
let goldenExamples = '';
try {
    goldenExamples = readFileSync(join(__dirname, 'conductor-golden-examples.md'), 'utf-8');
} catch {
    goldenExamples = '(Golden examples file not found)';
}

const SYSTEM_PROMPT = `你是 Conductor OSS 工作流编排专家。你的职责是基于用户的自然语言描述，生成、分析或修改符合 Conductor OSS v3.21.20 标准的 WorkflowDef JSON。

## 核心约束
1. **严格遵守 Conductor OSS v3.21.20 Schema**，输出必须可被 Conductor 服务端直接导入
2. 使用标准任务类型: SIMPLE, HTTP, SWITCH, FORK_JOIN, JOIN, DO_WHILE, SUB_WORKFLOW, EVENT, WAIT, HUMAN, TERMINATE, SET_VARIABLE, JSON_JQ_TRANSFORM, INLINE, KAFKA_PUBLISH
3. 每个任务的 taskReferenceName 在工作流内必须唯一，使用 snake_case
4. SWITCH 替代 DECISION（DECISION 已废弃），需包含 evaluatorType、expression、decisionCases、defaultCase
5. FORK_JOIN 后必须紧跟 JOIN 任务，joinOn 列出每个分支最后一个任务的 taskReferenceName
6. 使用 JSONPath 引用变量: \${workflow.input.xxx}, \${taskRef.output.xxx}
7. 复杂业务（超过 15 个任务）应拆解为多个 SUB_WORKFLOW 组合编排
8. 生成的 JSON 用 \`\`\`json 代码块包裹

## 输出格式
- 先给出简要的流程说明
- 然后输出完整的 WorkflowDef JSON（用 \`\`\`json 代码块包裹）
- 如果拆解为多个子工作流，每个子工作流单独一个 JSON 代码块，主工作流放在最后

## Golden Examples（5 种典型模式，直接复用结构）

${goldenExamples}`;

/**
 * 按需加载完整 Schema 参考（仅当 generate_workflow 设置 loadSchema: true 时）
 * 使用场景：生成高度复杂的工作流时需要完整字段参考
 */
function loadFullSchema(): string {
    try {
        return readFileSync(join(__dirname, 'conductor-schema.md'), 'utf-8');
    } catch {
        return '';
    }
}

/**
 * 从 LLM 响应中提取 JSON 代码块
 */
function extractJsonBlocks(text: string): string[] {
    const blocks: string[] = [];
    const regex = /```json\s*\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        blocks.push(match[1].trim());
    }
    // Fallback: try to find raw JSON object
    if (blocks.length === 0) {
        const rawMatch = text.match(/\{[\s\S]*"tasks"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
        if (rawMatch) {
            blocks.push(rawMatch[0]);
        }
    }
    return blocks;
}

/**
 * 校验 WorkflowDef 必要字段
 */
function validateWorkflowDef(obj: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!obj || typeof obj !== 'object') {
        return { valid: false, errors: ['Response is not a valid JSON object'] };
    }
    if (!obj.name || typeof obj.name !== 'string') {
        errors.push('Missing or invalid "name" field');
    }
    if (!Array.isArray(obj.tasks)) {
        errors.push('Missing or invalid "tasks" array');
    } else {
        const refNames = new Set<string>();
        const validateTasks = (tasks: any[], path: string) => {
            for (let i = 0; i < tasks.length; i++) {
                const task = tasks[i];
                const taskPath = `${path}[${i}]`;
                if (!task.taskReferenceName) {
                    errors.push(`${taskPath}: missing taskReferenceName`);
                } else {
                    if (refNames.has(task.taskReferenceName)) {
                        errors.push(`${taskPath}: duplicate taskReferenceName "${task.taskReferenceName}"`);
                    }
                    refNames.add(task.taskReferenceName);
                }
                if (!task.type) {
                    errors.push(`${taskPath}: missing type`);
                }
                // Validate FORK_JOIN has subsequent JOIN
                if (task.type === 'FORK_JOIN') {
                    if (task.forkTasks && Array.isArray(task.forkTasks)) {
                        for (let b = 0; b < task.forkTasks.length; b++) {
                            validateTasks(task.forkTasks[b], `${taskPath}.forkTasks[${b}]`);
                        }
                    }
                    const nextTask = tasks[i + 1];
                    if (!nextTask || nextTask.type !== 'JOIN') {
                        errors.push(`${taskPath}: FORK_JOIN must be followed by a JOIN task`);
                    }
                }
                // Validate SWITCH/DECISION cases
                if (task.type === 'SWITCH' || task.type === 'DECISION') {
                    if (task.decisionCases) {
                        for (const [caseName, caseTasks] of Object.entries(task.decisionCases)) {
                            if (Array.isArray(caseTasks)) {
                                validateTasks(caseTasks as any[], `${taskPath}.decisionCases.${caseName}`);
                            }
                        }
                    }
                    if (task.defaultCase && Array.isArray(task.defaultCase)) {
                        validateTasks(task.defaultCase, `${taskPath}.defaultCase`);
                    }
                }
                // Validate DO_WHILE loop body
                if (task.type === 'DO_WHILE' && task.loopOver && Array.isArray(task.loopOver)) {
                    validateTasks(task.loopOver, `${taskPath}.loopOver`);
                }
            }
        };
        validateTasks(obj.tasks, 'tasks');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 调用 LLM 生成响应
 * @param withFullSchema 是否追加完整 Schema 参考（默认 false，按需启用）
 */
async function callLLM(ctx: SkillContext, userPrompt: string, withFullSchema = false): Promise<string> {
    const llm = ctx.llm as any;
    if (!llm) {
        throw new Error('LLM adapter not available in skill context');
    }

    let systemPrompt = SYSTEM_PROMPT;
    if (withFullSchema) {
        const fullSchema = loadFullSchema();
        if (fullSchema) {
            systemPrompt += `\n\n## 完整 Schema 参考（按需）\n\n${fullSchema}`;
        }
    }

    const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt },
    ];

    const response = await llm.chat(messages, { temperature: 0.3, maxTokens: 8000 });
    return typeof response.content === 'string'
        ? response.content
        : (response.content as any[]).map((p: any) => p.text || '').join('');
}

export async function generate_workflow(ctx: SkillContext, params: Record<string, unknown>) {
            const { description, name, load_schema } = params as {
                description: string;
                name?: string;
                /** 设为 true 时追加完整 Schema 参考（默认 false，生成简单工作流不需要） */
                load_schema?: boolean;
            };
            ctx.logger.info(`[conductor-workflow] Generating workflow: ${description.slice(0, 100)}... (schema=${load_schema ?? false})`);

            const nameHint = name ? `\n工作流名称要求: "${name}"` : '';
            const userPrompt = `请根据以下业务逻辑描述生成 Conductor 工作流定义 JSON：\n\n${description}${nameHint}\n\n要求:\n1. 输出完整可运行的 WorkflowDef JSON\n2. 合理使用任务类型和参数配置\n3. 如果流程复杂（超过15个任务），请拆解为多个子工作流并通过 SUB_WORKFLOW 编排\n4. 配置合理的错误处理和超时策略`;

            const llmResponse = await callLLM(ctx, userPrompt, load_schema === true);
            const jsonBlocks = extractJsonBlocks(llmResponse);

            if (jsonBlocks.length === 0) {
                return {
                    success: false,
                    error: '未能从生成结果中提取到有效的 JSON',
                    rawResponse: llmResponse,
                };
            }

            const workflows: any[] = [];
            const validationResults: any[] = [];

            for (const block of jsonBlocks) {
                try {
                    const parsed = JSON.parse(block);
                    const validation = validateWorkflowDef(parsed);
                    workflows.push(parsed);
                    validationResults.push(validation);
                } catch (e: any) {
                    validationResults.push({ valid: false, errors: [`JSON parse error: ${e.message}`] });
                }
            }

            const mainWorkflow = workflows.length > 0 ? workflows[workflows.length - 1] : null;
            const subWorkflows = workflows.length > 1 ? workflows.slice(0, -1) : [];
            const allValid = validationResults.every((v: any) => v.valid);

            ctx.logger.info(`[conductor-workflow] Generated ${workflows.length} workflow(s), all valid: ${allValid}`);

            return {
                success: true,
                workflow: mainWorkflow,
                subWorkflows: subWorkflows.length > 0 ? subWorkflows : undefined,
                validation: validationResults,
                allValid,
                explanation: llmResponse.split('```')[0].trim(),
                type: 'workflow_generated',
            };
}

export async function analyze_workflow(ctx: SkillContext, params: Record<string, unknown>) {
            const { workflow_json } = params as { workflow_json: string };
            ctx.logger.info(`[conductor-workflow] Analyzing workflow...`);

            let parsed: any;
            try {
                parsed = JSON.parse(workflow_json);
            } catch (e: any) {
                return { success: false, error: `Invalid JSON: ${e.message}` };
            }

            const validation = validateWorkflowDef(parsed);

            const userPrompt = `请分析以下 Conductor 工作流定义，输出：
1. **流程概述**: 用自然语言描述这个工作流的业务逻辑
2. **结构分析**: 任务类型分布、执行路径、并行/分支结构
3. **潜在问题**: 缺少错误处理、缺少超时配置、命名不规范等
4. **优化建议**: 提升可靠性和性能的具体建议

工作流 JSON：
\`\`\`json
${workflow_json}
\`\`\``;

            const analysis = await callLLM(ctx, userPrompt);

            return {
                success: true,
                analysis,
                validation,
                workflowName: parsed.name,
                taskCount: parsed.tasks?.length ?? 0,
            };
}

export async function update_workflow(ctx: SkillContext, params: Record<string, unknown>) {
            const { workflow_json, instruction } = params as { workflow_json: string; instruction: string };
            ctx.logger.info(`[conductor-workflow] Updating workflow: ${instruction.slice(0, 100)}...`);

            let parsed: any;
            try {
                parsed = JSON.parse(workflow_json);
            } catch (e: any) {
                return { success: false, error: `Invalid JSON: ${e.message}` };
            }

            const userPrompt = `以下是一个已有的 Conductor 工作流定义：

\`\`\`json
${workflow_json}
\`\`\`

请根据以下要求修改此工作流，并输出完整的更新后 WorkflowDef JSON：

修改要求: ${instruction}

注意:
1. 返回完整的修改后 JSON（不是增量 patch）
2. 保持原有合理的配置不变
3. 确保修改后的 taskReferenceName 唯一性
4. 如果修改涉及 FORK_JOIN，确保 JOIN 的 joinOn 正确更新`;

            const llmResponse = await callLLM(ctx, userPrompt);
            const jsonBlocks = extractJsonBlocks(llmResponse);

            if (jsonBlocks.length === 0) {
                return {
                    success: false,
                    error: '未能从更新结果中提取到有效的 JSON',
                    rawResponse: llmResponse,
                };
            }

            try {
                const updated = JSON.parse(jsonBlocks[jsonBlocks.length - 1]);
                const validation = validateWorkflowDef(updated);

                return {
                    success: true,
                    workflow: updated,
                    validation,
                    explanation: llmResponse.split('```')[0].trim(),
                    type: 'workflow_generated',
                };
            } catch (e: any) {
                return {
                    success: false,
                    error: `JSON parse error: ${e.message}`,
                    rawResponse: llmResponse,
                };
            }
}

export default { generate_workflow, analyze_workflow, update_workflow };
