import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import type { Logger, SkillContext } from '../types.js';
import { SkillRegistry } from '../skills/registry.js';

export interface RunbookStep {
    tool?: string;
    command?: string;
    prompt?: string;
    template?: string;
    condition?: string;
    params?: Record<string, unknown>;
    onError?: 'continue' | 'abort';
    description?: string;
}

export interface RunbookTrigger {
    type: 'webhook' | 'cron' | 'manual';
    condition?: string;
    cronExpr?: string;
}

export interface Runbook {
    name: string;
    description?: string;
    trigger?: RunbookTrigger;
    variables?: Record<string, string>;
    steps: RunbookStep[];
}

export interface RunbookExecutionResult {
    runbookName: string;
    sessionId: string;
    steps: Array<{
        index: number;
        tool?: string;
        result?: unknown;
        error?: string;
        skipped?: boolean;
    }>;
    success: boolean;
    duration: number;
}

/**
 * YAML Runbook engine: parses declarative Runbook → DAG → executes steps.
 * Reuses existing SkillRegistry for tool execution.
 */
export class RunbookEngine {
    private logger: Logger;
    private skillRegistry: SkillRegistry;
    private runbooksDir: string;

    constructor(skillRegistry: SkillRegistry, logger: Logger, runbooksDir?: string) {
        this.skillRegistry = skillRegistry;
        this.logger = logger;
        this.runbooksDir = runbooksDir || join(process.cwd(), 'runbooks');
    }

    /**
     * Parse a simple YAML Runbook file.
     * Supports a simplified YAML subset for Runbook definitions.
     */
    parseRunbook(yamlContent: string): Runbook {
        // Use a line-by-line YAML parser for our specific Runbook schema
        const lines = yamlContent.split('\n');
        const runbook: Runbook = { name: '', steps: [] };

        let currentStep: RunbookStep | null = null;
        let inSteps = false;
        let inVariables = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith('#') || trimmed === '') continue;

            // Top-level fields
            const topMatch = line.match(/^(\w+):\s*(.*)$/);
            if (topMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
                const [, key, val] = topMatch;
                if (key === 'name') runbook.name = val.trim();
                if (key === 'description') runbook.description = val.trim();
                if (key === 'steps') { inSteps = true; inVariables = false; }
                if (key === 'variables') { inVariables = true; inSteps = false; }
                if (key === 'trigger') {
                    runbook.trigger = runbook.trigger || { type: 'manual' };
                }
                continue;
            }

            // Step list item
            if (inSteps && trimmed.startsWith('- ')) {
                if (currentStep) runbook.steps.push(currentStep);
                currentStep = {};
                const rest = trimmed.slice(2).trim();
                const stepFieldMatch = rest.match(/^(\w+):\s*(.*)$/);
                if (stepFieldMatch) {
                    const [, k, v] = stepFieldMatch;
                    (currentStep as any)[k] = this.interpolateValue(v.trim());
                }
                continue;
            }

            // Step fields (indented)
            if (inSteps && currentStep && line.match(/^\s+\w+:/)) {
                const fieldMatch = trimmed.match(/^(\w+):\s*(.*)$/);
                if (fieldMatch) {
                    const [, k, v] = fieldMatch;
                    (currentStep as any)[k] = this.interpolateValue(v.trim());
                }
                continue;
            }

            // Variables
            if (inVariables && topMatch) {
                if (!runbook.variables) runbook.variables = {};
                runbook.variables[topMatch[1]] = topMatch[2].trim();
            }
        }

        if (currentStep) runbook.steps.push(currentStep);
        return runbook;
    }

    private interpolateValue(val: string): unknown {
        // Remove quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            return val.slice(1, -1);
        }
        if (val === 'true') return true;
        if (val === 'false') return false;
        if (!isNaN(Number(val)) && val !== '') return Number(val);
        return val;
    }

    /**
     * List all Runbook files
     */
    listRunbooks(): Array<{ name: string; filename: string; description?: string }> {
        if (!existsSync(this.runbooksDir)) return [];

        return readdirSync(this.runbooksDir)
            .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
            .map(f => {
                try {
                    const content = readFileSync(join(this.runbooksDir, f), 'utf-8');
                    const rb = this.parseRunbook(content);
                    return { name: rb.name || f, filename: f, description: rb.description };
                } catch {
                    return { name: f, filename: f };
                }
            });
    }

    /**
     * Load and parse a Runbook by filename
     */
    loadRunbook(filename: string): Runbook {
        const filePath = join(this.runbooksDir, filename);
        if (!existsSync(filePath)) {
            throw new Error(`Runbook not found: ${filename}`);
        }
        return this.parseRunbook(readFileSync(filePath, 'utf-8'));
    }

    /**
     * Execute a Runbook with given context variables
     */
    async execute(
        runbook: Runbook,
        context: { sessionId?: string; variables?: Record<string, unknown>; skillContext?: SkillContext }
    ): Promise<RunbookExecutionResult> {
        const sessionId = context.sessionId || nanoid();
        const startTime = Date.now();

        this.logger.info(`[runbook] Executing "${runbook.name}" (${runbook.steps.length} steps)`);

        const execContext = {
            ...runbook.variables,
            ...context.variables,
        };

        const stepResults: RunbookExecutionResult['steps'] = [];
        let success = true;

        for (let i = 0; i < runbook.steps.length; i++) {
            const step = runbook.steps[i];

            // Evaluate condition
            if (step.condition) {
                const condResult = this.evaluateCondition(step.condition, execContext);
                if (!condResult) {
                    stepResults.push({ index: i, skipped: true, tool: step.tool });
                    continue;
                }
            }

            try {
                const result = await this.executeStep(step, execContext, context.skillContext);
                stepResults.push({ index: i, tool: step.tool, result });

                // Store output for use in subsequent steps
                if (result !== undefined) {
                    (execContext as any)['previous_output'] = typeof result === 'string' ? result : JSON.stringify(result);
                    (execContext as any)[`step_${i}_output`] = (execContext as any)['previous_output'];
                }
            } catch (err: any) {
                this.logger.error(`[runbook] Step ${i} failed: ${err.message}`);
                stepResults.push({ index: i, tool: step.tool, error: err.message });

                if (step.onError !== 'continue') {
                    success = false;
                    break;
                }
            }
        }

        return {
            runbookName: runbook.name,
            sessionId,
            steps: stepResults,
            success,
            duration: Date.now() - startTime,
        };
    }

    private async executeStep(
        step: RunbookStep,
        ctx: Record<string, unknown>,
        skillContext?: SkillContext
    ): Promise<unknown> {
        // Interpolate template variables in all string fields
        const interpolated = this.interpolateStep(step, ctx);

        if (interpolated.tool && skillContext) {
            const params = interpolated.params || {};
            if (interpolated.command) (params as any)['command'] = interpolated.command;
            if (interpolated.prompt) (params as any)['prompt'] = interpolated.prompt;

            this.logger.info(`[runbook] Executing tool: ${interpolated.tool}`);
            return this.skillRegistry.executeAction(interpolated.tool, params, skillContext);
        }

        if (interpolated.command && !interpolated.tool) {
            // Default to shell.execute
            if (skillContext) {
                return this.skillRegistry.executeAction('shell.execute', { command: interpolated.command }, skillContext);
            }
        }

        this.logger.warn(`[runbook] Step has no executable action: ${JSON.stringify(step)}`);
        return null;
    }

    private interpolateStep(step: RunbookStep, ctx: Record<string, unknown>): RunbookStep {
        const stepStr = JSON.stringify(step);
        const interpolated = stepStr.replace(/\{\{(\w+)\}\}/g, (_, key) => {
            const val = ctx[key];
            return val !== undefined ? String(val) : `{{${key}}}`;
        });
        return JSON.parse(interpolated);
    }

    private evaluateCondition(condition: string, ctx: Record<string, unknown>): boolean {
        // Simple condition evaluator: supports "field contains 'value'" and "field == 'value'"
        const containsMatch = condition.match(/^(\w+)\s+contains\s+'([^']*)'$/i);
        if (containsMatch) {
            const [, field, value] = containsMatch;
            const fieldVal = String(ctx[field] || '');
            return fieldVal.toLowerCase().includes(value.toLowerCase());
        }

        const eqMatch = condition.match(/^(\w+)\s*==\s*['"]?([^'"]+)['"]?$/);
        if (eqMatch) {
            const [, field, value] = eqMatch;
            return String(ctx[field] || '') === value;
        }

        const boolMatch = condition.match(/^(\w+(?:\.\w+)*)$/);
        if (boolMatch) {
            const parts = boolMatch[1].split('.');
            let val: unknown = ctx;
            for (const part of parts) {
                val = (val as any)?.[part];
            }
            return Boolean(val);
        }

        // Default: unknown condition → true (don't skip)
        return true;
    }
}
